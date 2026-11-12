import crypto from 'crypto';
import { getDb } from '../db/drizzle.js';
import { companies, company_policies } from '../models/company.js';
import { chatbot_api_keys } from '../models/chatbotApiKey.js';
import { api_keys } from '../models/apiKey.js';
import { eq, and, desc } from 'drizzle-orm';
import { generateEmbeddings } from '../services/embeddingService.js';
import { querySimilarPolicyChunks } from '../services/pineconeService.js';

/**
 * Public Chatbot Query Endpoint
 * Called by client websites or embeddable widget via x-api-key
 */
export const queryChatbot = async (req, res, next) => {
  try {
    const apiKey =
      req.headers['x-api-key'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
      req.query.api_key ||
      req.body.api_key;

    const { message, history = [] } = req.body;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Missing API key. Provide "x-api-key" header with your company API key.',
      });
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message string is required.',
      });
    }

    const db = getDb();

    // 1. Authenticate API Key and find Company (Checks company primary key OR generated chatbot_api_keys)
    let company = null;

    const [foundCompany] = await db
      .select()
      .from(companies)
      .where(eq(companies.api_key, apiKey.trim()))
      .limit(1);

    if (foundCompany) {
      company = foundCompany;
    } else {
      const [foundKey] = await db
        .select()
        .from(chatbot_api_keys)
        .where(and(eq(chatbot_api_keys.api_key, apiKey.trim()), eq(chatbot_api_keys.is_active, true)))
        .limit(1);

      if (foundKey) {
        const [comp] = await db
          .select()
          .from(companies)
          .where(eq(companies.id, foundKey.company_id))
          .limit(1);
        company = comp;

        // Update last_used_at timestamp in background
        db.update(chatbot_api_keys)
          .set({ last_used_at: new Date() })
          .where(eq(chatbot_api_keys.id, foundKey.id))
          .catch(() => {});
      }
    }

    if (!company) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or revoked company API key.',
      });
    }

    // 2. Resolve LLM API Key (User-stored Key or system env)
    const [userGemini] = await db
      .select()
      .from(api_keys)
      .where(and(eq(api_keys.user_id, company.user_id), eq(api_keys.provider, 'gemini')))
      .orderBy(desc(api_keys.created_at))
      .limit(1);

    const [userOpenAI] = await db
      .select()
      .from(api_keys)
      .where(and(eq(api_keys.user_id, company.user_id), eq(api_keys.provider, 'openai')))
      .orderBy(desc(api_keys.created_at))
      .limit(1);

    const geminiKey = userGemini?.encrypted_key || process.env.GEMINI_API_KEY;
    const openaiKey = userOpenAI?.encrypted_key || process.env.OPENAI_API_KEY;

    if (!geminiKey && !openaiKey) {
      return res.status(503).json({
        success: false,
        error: 'AI service unavailable: No Gemini or OpenAI API Key configured in .env or your Integrations tab.',
      });
    }

    const activeProvider = geminiKey ? 'gemini' : 'openai';
    const activeKey = geminiKey || openaiKey;

    // 3. Generate Vector Embedding for User's Question
    let matches = [];
    try {
      const [queryVector] = await generateEmbeddings([message.trim()], activeKey, activeProvider);
      if (queryVector) {
        matches = await querySimilarPolicyChunks({
          companyId: company.id,
          queryVector,
          topK: 4,
        });
      }
    } catch (embErr) {
      console.warn('[Chatbot] Embedding lookup note:', embErr.message);
    }

    // 4. Construct Context-Aware Prompt
    const contextText =
      matches.length > 0
        ? matches
            .map((m, idx) => `[Source ${idx + 1}: ${m.title || m.file_name}]\n${m.text}`)
            .join('\n\n---\n\n')
        : 'No specific policy document matches were found in the knowledge base.';

    const systemPrompt = `You are the official AI representative and customer support assistant for "${company.name}".
Your job is to assist users accurately, politely, and authoritatively based on the company's verified policy documents.

Guidelines:
1. Always maintain a professional, helpful, and courteous tone.
2. Ground your answers in the provided policy documentation context below.
3. If the answer is clearly provided in the context, synthesize a concise, structured response.
4. If the documentation does not contain enough information to answer the question, politely explain that the specific detail is not covered in current policy and offer to connect them to the support team.
5. Do NOT fabricate internal company details not present in the context.

--- OFFICIAL COMPANY CONTEXT ---
${contextText}
--- END CONTEXT ---`;

    // 5. Call LLM (Gemini 2.0 Flash or OpenAI GPT-4o-mini)
    let answer = '';
    const startTime = Date.now();

    if (activeProvider === 'gemini') {
      const contents = [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nCustomer Question: ${message.trim()}` }],
        },
      ];

      const headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey,
      };

      const candidateModels = [
        'gemini-1.5-flash',
        'gemini-2.5-flash',
        'gemini-1.5-pro',
        'gemini-2.0-flash',
      ];

      let lastError = null;

      for (const modelName of candidateModels) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
          const geminiRes = await fetch(geminiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ contents }),
          });

          const geminiData = await geminiRes.json();

          if (geminiRes.ok && geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
            answer = geminiData.candidates[0].content.parts[0].text;
            console.log(`[Chatbot] Successfully generated answer using Gemini model: ${modelName}`);
            break;
          } else {
            lastError = geminiData.error?.message || `Model ${modelName} returned no candidate text.`;
            console.warn(`[Chatbot] Model ${modelName} note:`, lastError);
          }
        } catch (modelErr) {
          lastError = modelErr.message;
          console.warn(`[Chatbot] Model ${modelName} network error:`, modelErr.message);
        }
      }

      if (!answer) {
        return res.status(502).json({
          success: false,
          error: lastError || 'Failed to generate response from available Gemini models.',
        });
      }
    } else {
      const openaiUrl = 'https://api.openai.com/v1/chat/completions';
      const openaiRes = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message.trim() },
          ],
          temperature: 0.3,
        }),
      });

      const openaiData = await openaiRes.json();
      if (!openaiRes.ok) {
        return res.status(502).json({
          success: false,
          error: openaiData.error?.message || 'Failed to generate response from OpenAI model.',
        });
      }
      answer = openaiData.choices?.[0]?.message?.content || '';
    }

    if (!answer) {
      answer = 'I apologize, but I could not formulate an answer at this moment.';
    }

    const durationMs = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      company: company.name,
      response: answer,
      sources: matches.map((m) => ({ title: m.title, file_name: m.file_name, score: m.score })),
      durationMs,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get all Chatbot API Keys for user's company
 */
export const getChatbotKeys = async (req, res, next) => {
  try {
    const db = getDb();
    const companyId = req.query.company_id;

    let company = null;
    if (companyId) {
      const [found] = await db
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.user_id, req.user.id)))
        .limit(1);
      company = found;
    } else {
      const [found] = await db
        .select()
        .from(companies)
        .where(eq(companies.user_id, req.user.id))
        .orderBy(desc(companies.created_at))
        .limit(1);
      company = found;
    }

    if (!company) {
      return res.status(200).json({
        success: true,
        keys: [],
        primaryKey: null,
      });
    }

    // Fetch all generated keys from chatbot_api_keys
    const generatedKeys = await db
      .select()
      .from(chatbot_api_keys)
      .where(eq(chatbot_api_keys.company_id, company.id))
      .orderBy(desc(chatbot_api_keys.created_at));

    return res.status(200).json({
      success: true,
      companyId: company.id,
      companyName: company.name,
      primaryKey: company.api_key,
      keys: generatedKeys,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Generate a new Chatbot API Key for client websites
 */
export const createChatbotKey = async (req, res, next) => {
  try {
    const { name = 'Website Chatbot Key', company_id } = req.body;
    const db = getDb();

    let company = null;
    if (company_id) {
      const [found] = await db
        .select()
        .from(companies)
        .where(and(eq(companies.id, company_id), eq(companies.user_id, req.user.id)))
        .limit(1);
      company = found;
    } else {
      const [found] = await db
        .select()
        .from(companies)
        .where(eq(companies.user_id, req.user.id))
        .orderBy(desc(companies.created_at))
        .limit(1);
      company = found;
    }

    if (!company) {
      return res.status(400).json({
        success: false,
        error: 'You must set up a company profile before generating chatbot API keys.',
      });
    }

    const randomBytes = crypto.randomBytes(16).toString('hex');
    const apiKey = `af_live_${randomBytes}`;
    const keyHint = `af_live_...${apiKey.slice(-6)}`;

    const [newKey] = await db
      .insert(chatbot_api_keys)
      .values({
        company_id: company.id,
        user_id: req.user.id,
        name: name.trim() || 'Website Chatbot Key',
        api_key: apiKey,
        key_hint: keyHint,
        is_active: true,
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: 'New Chatbot API key generated successfully.',
      key: newKey,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Revoke/Delete a Chatbot API Key
 */
export const deleteChatbotKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    await db
      .delete(chatbot_api_keys)
      .where(and(eq(chatbot_api_keys.id, id), eq(chatbot_api_keys.user_id, req.user.id)));

    return res.status(200).json({
      success: true,
      message: 'Chatbot API key revoked successfully.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Regenerate Company API Key for Website Chatbot Integration
 */
export const regenerateCompanyKey = async (req, res, next) => {
  try {
    const { company_id } = req.body || {};
    const db = getDb();
    const crypto = await import('crypto');
    const newKey = `af_live_${crypto.randomBytes(16).toString('hex')}`;

    let condition = eq(companies.user_id, req.user.id);
    if (company_id) {
      condition = and(eq(companies.id, company_id), eq(companies.user_id, req.user.id));
    }

    const [updated] = await db
      .update(companies)
      .set({ api_key: newKey, updated_at: new Date() })
      .where(condition)
      .returning();

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Company not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'New company API key generated.',
      api_key: newKey,
    });
  } catch (err) {
    next(err);
  }
};

