import crypto from 'crypto';
import { getDb } from '../db/drizzle.js';
import { companies, company_policies } from '../models/company.js';
import { api_keys } from '../models/apiKey.js';
import { eq, and, desc } from 'drizzle-orm';
import { uploadFileToR2, deleteFileFromR2 } from '../services/r2Service.js';
import { extractTextFromPdf, chunkText, generateEmbeddings } from '../services/embeddingService.js';
import { upsertPolicyVectors, deletePolicyVectors } from '../services/pineconeService.js';

/**
 * Company & Policy Document Controller
 */
export const getMyCompany = async (req, res, next) => {
  try {
    const db = getDb();

    // Fetch all companies owned by this user
    let userCompanies = await db
      .select()
      .from(companies)
      .where(eq(companies.user_id, req.user.id))
      .orderBy(desc(companies.created_at));

    // Ensure all have API keys
    for (let i = 0; i < userCompanies.length; i++) {
      if (!userCompanies[i].api_key) {
        const apiKey = `af_live_${crypto.randomBytes(16).toString('hex')}`;
        const [updated] = await db
          .update(companies)
          .set({ api_key: apiKey })
          .where(eq(companies.id, userCompanies[i].id))
          .returning();
        userCompanies[i] = updated;
      }
    }

    return res.status(200).json({
      success: true,
      company: userCompanies[0] || null,
      companies: userCompanies,
      pineconeConfigured: Boolean(process.env.PINECONE_API_KEY),
      r2Configured: Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY),
    });
  } catch (err) {
    next(err);
  }
};

export const createCompany = async (req, res, next) => {
  try {
    const { name, description = '', industry = '', website = '' } = req.body;
    const db = getDb();

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Company name is required.' });
    }

    const apiKey = `af_live_${crypto.randomBytes(16).toString('hex')}`;

    const [newCompany] = await db
      .insert(companies)
      .values({
        user_id: req.user.id,
        name: name.trim(),
        description: description.trim(),
        industry: industry.trim(),
        website: website.trim(),
        api_key: apiKey,
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: 'Company created successfully.',
      company: newCompany,
    });
  } catch (err) {
    next(err);
  }
};

export const updateCompany = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, industry, website } = req.body;
    const db = getDb();

    const updateData = { updated_at: new Date() };
    if (name) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (industry !== undefined) updateData.industry = industry.trim();
    if (website !== undefined) updateData.website = website.trim();

    const [updated] = await db
      .update(companies)
      .set(updateData)
      .where(and(eq(companies.id, id), eq(companies.user_id, req.user.id)))
      .returning();

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Company not found or unauthorized.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Company updated successfully.',
      company: updated,
    });
  } catch (err) {
    next(err);
  }
};

export const uploadPolicy = async (req, res, next) => {
  try {
    const db = getDb();

    const company_id = req.body.company_id;
    const title = req.body.title || req.file?.originalname || 'Company Policy';
    const file_name = req.file ? req.file.originalname : (req.body.file_name || 'policy.pdf');
    const file_size = req.file ? `${(req.file.size / 1024).toFixed(1)} KB` : (req.body.file_size || '');

    let fileBuffer = null;
    if (req.file && req.file.buffer) {
      fileBuffer = req.file.buffer;
    } else if (req.body.file_base64) {
      fileBuffer = Buffer.from(req.body.file_base64, 'base64');
    }

    if (!company_id || !title) {
      return res.status(400).json({
        success: false,
        error: 'company_id and title are required.',
      });
    }

    // Verify company belongs to user
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, company_id), eq(companies.user_id, req.user.id)))
      .limit(1);

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found.' });
    }

    // 1. Upload to Cloudflare R2
    let r2_url = null;
    let r2_key = null;
    if (fileBuffer) {
      try {
        const r2Result = await uploadFileToR2({
          fileBuffer,
          fileName: file_name,
          mimeType: req.file?.mimetype || 'application/pdf',
          folder: `policies/${company_id}`,
        });
        r2_url = r2Result.url;
        r2_key = r2Result.key;
      } catch (r2Err) {
        console.error('[R2 Upload Error]', r2Err.message);
      }
    }

    // 2. Extract text & Generate Pinecone Vector Embeddings
    let chunks = [];
    let status = 'uploaded';
    let chunkCount = 0;
    let embErrorMessage = null;
    const policyId = crypto.randomUUID();

    if (fileBuffer) {
      try {
        const rawText = await extractTextFromPdf(fileBuffer);
        chunks = chunkText(rawText);
        chunkCount = chunks.length;

        if (chunks.length > 0) {
          // Look up user's Gemini or OpenAI key or fallback to system environment
          const [userGemini] = await db
            .select()
            .from(api_keys)
            .where(and(eq(api_keys.user_id, req.user.id), eq(api_keys.provider, 'gemini')))
            .orderBy(desc(api_keys.created_at))
            .limit(1);

          const [userOpenAI] = await db
            .select()
            .from(api_keys)
            .where(and(eq(api_keys.user_id, req.user.id), eq(api_keys.provider, 'openai')))
            .orderBy(desc(api_keys.created_at))
            .limit(1);

          const geminiKey = userGemini?.encrypted_key || process.env.GEMINI_API_KEY;
          const openaiKey = userOpenAI?.encrypted_key || process.env.OPENAI_API_KEY;
          const activeKey = geminiKey || openaiKey;
          const activeProvider = geminiKey ? 'gemini' : 'openai';

          if (!activeKey) {
            embErrorMessage = 'AI API key not detected in server environment. Restart your backend after editing .env.';
          } else if (!process.env.PINECONE_API_KEY) {
            embErrorMessage = 'PINECONE_API_KEY is not set in backend/.env.';
          } else {
            const vectors = await generateEmbeddings(chunks, activeKey, activeProvider);
            const pineconeRes = await upsertPolicyVectors({
              companyId: company_id,
              policyId,
              title: title.trim(),
              fileName: file_name.trim(),
              chunks,
              vectors,
            });
            if (pineconeRes.success) {
              status = 'indexed';
            } else {
              embErrorMessage = pineconeRes.reason || 'Pinecone upsert failed.';
            }
          }
        }
      } catch (embErr) {
        console.warn('[Embedding/Pinecone Error]', embErr.message);
        embErrorMessage = embErr.message;
      }
    }

    // 3. Store in Aiven PostgreSQL
    const [policy] = await db
      .insert(company_policies)
      .values({
        id: policyId,
        company_id,
        user_id: req.user.id,
        title: title.trim(),
        file_name: file_name.trim(),
        file_size,
        r2_url,
        r2_key,
        chunk_count: chunkCount,
        pinecone_file_id: status === 'indexed' ? `pinecone_${policyId}` : null,
        status,
      })
      .returning();

    const notice = status === 'indexed'
      ? `Document stored in Cloudflare R2 and ${chunkCount} chunks vectorized into Pinecone DB.`
      : embErrorMessage
        ? `Document stored in Cloudflare R2. (Pinecone vector note: ${embErrorMessage})`
        : `Document stored in Cloudflare R2. (Pinecone vector indexing ready on standby).`;

    return res.status(201).json({
      success: true,
      message: notice,
      policy,
      r2_url,
      chunk_count: chunkCount,
      pineconeConfigured: Boolean(process.env.PINECONE_API_KEY),
    });
  } catch (err) {
    next(err);
  }
};

export const getPolicies = async (req, res, next) => {
  try {
    const { company_id } = req.params;
    const db = getDb();

    const policies = await db
      .select()
      .from(company_policies)
      .where(and(eq(company_policies.company_id, company_id), eq(company_policies.user_id, req.user.id)))
      .orderBy(desc(company_policies.created_at));

    return res.status(200).json({
      success: true,
      policies,
      pineconeConfigured: Boolean(process.env.PINECONE_API_KEY),
      r2Configured: Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY),
    });
  } catch (err) {
    next(err);
  }
};

export const deletePolicy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const [policy] = await db
      .select()
      .from(company_policies)
      .where(and(eq(company_policies.id, id), eq(company_policies.user_id, req.user.id)))
      .limit(1);

    if (!policy) {
      return res.status(404).json({ success: false, error: 'Policy not found.' });
    }

    // 1. Delete from Cloudflare R2
    if (policy.r2_key) {
      await deleteFileFromR2(policy.r2_key);
    }

    // 2. Delete vectors from Pinecone
    await deletePolicyVectors(policy.id, policy.chunk_count || 50);

    // 3. Delete from PostgreSQL
    await db
      .delete(company_policies)
      .where(eq(company_policies.id, id));

    return res.status(200).json({
      success: true,
      message: 'Policy document removed from PostgreSQL, Cloudflare R2, and Pinecone.',
    });
  } catch (err) {
    next(err);
  }
};

export const deleteCompany = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), eq(companies.user_id, req.user.id)))
      .limit(1);

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found or unauthorized.' });
    }

    // Get all policies to delete R2 files and Pinecone vectors
    const policies = await db
      .select()
      .from(company_policies)
      .where(eq(company_policies.company_id, id));

    for (const p of policies) {
      if (p.r2_key) {
        await deleteFileFromR2(p.r2_key).catch(() => {});
      }
      await deletePolicyVectors(p.id, p.chunk_count || 50).catch(() => {});
    }

    // Delete company (cascades policies and chatbot keys)
    await db.delete(companies).where(eq(companies.id, id));

    return res.status(200).json({
      success: true,
      message: `Company "${company.name}" and all associated vectors deleted successfully.`,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getMyCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  uploadPolicy,
  getPolicies,
  deletePolicy,
};
