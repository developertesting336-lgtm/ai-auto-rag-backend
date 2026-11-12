import { getDb } from '../db/drizzle.js';
import { api_keys } from '../models/apiKey.js';
import { eq, and, desc } from 'drizzle-orm';

export const generateText = async (req, res, next) => {
  try {
    const { prompt, provider = 'gemini', model = 'gemini-1.5-flash' } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required.',
      });
    }

    const db = getDb();

    // Look up user's active API key for this provider
    const [userKey] = await db
      .select()
      .from(api_keys)
      .where(and(eq(api_keys.user_id, req.user.id), eq(api_keys.provider, provider.toLowerCase().trim())))
      .orderBy(desc(api_keys.created_at))
      .limit(1);

    const apiKey = userKey?.encrypted_key || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: `No API key found for provider "${provider}". Please add one in your Integrations tab.`,
      });
    }

    const startTime = Date.now();

    // 1. Google Gemini API Call
    if (provider.toLowerCase() === 'gemini') {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      };

      const apiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      });

      const data = await apiResponse.json();

      if (!apiResponse.ok) {
        return res.status(apiResponse.status).json({
          success: false,
          error: data.error?.message || 'Google Gemini API request failed.',
        });
      }

      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const durationMs = Date.now() - startTime;
      const totalTokens = data.usageMetadata?.totalTokenCount || 0;

      return res.status(200).json({
        success: true,
        provider: 'gemini',
        model,
        response: generatedText,
        tokens: totalTokens,
        durationMs,
      });
    }

    // 2. OpenAI API Call
    if (provider.toLowerCase() === 'openai') {
      const openaiUrl = 'https://api.openai.com/v1/chat/completions';

      const apiResponse = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await apiResponse.json();

      if (!apiResponse.ok) {
        return res.status(apiResponse.status).json({
          success: false,
          error: data.error?.message || 'OpenAI API request failed.',
        });
      }

      const generatedText = data.choices?.[0]?.message?.content || '';
      const durationMs = Date.now() - startTime;

      return res.status(200).json({
        success: true,
        provider: 'openai',
        model: model || 'gpt-4o-mini',
        response: generatedText,
        tokens: data.usage?.total_tokens || 0,
        durationMs,
      });
    }

    return res.status(400).json({
      success: false,
      error: `Provider "${provider}" is not directly supported for completions yet.`,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  generateText,
};
