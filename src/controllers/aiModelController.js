import { getDb } from '../db/drizzle.js';
import { ai_models } from '../models/aiModel.js';
import { api_keys } from '../models/apiKey.js';
import { ai_model_health_logs } from '../models/healthLog.js';
import { eq, and, desc } from 'drizzle-orm';
import { encryptKey, decryptKey, maskApiKey } from '../utils/crypto.js';
import { executeAiModelInference } from '../services/aiInferenceService.js';

const DEFAULT_MODELS = {
  gemini: 'gemini-3.1-flash-lite',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  groq: 'llama-3.3-70b-versatile',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-large-latest',
  openrouter: 'openai/gpt-4o',
  custom: 'default',
};

/**
 * Get all AI models configured by the user
 */
export const getAiModels = async (req, res, next) => {
  try {
    const db = getDb();
    const models = await db
      .select({
        id: ai_models.id,
        user_id: ai_models.user_id,
        name: ai_models.name,
        provider: ai_models.provider,
        model_name: ai_models.model_name,
        key_hint: ai_models.key_hint,
        base_url: ai_models.base_url,
        temperature: ai_models.temperature,
        max_tokens: ai_models.max_tokens,
        is_active: ai_models.is_active,
        created_at: ai_models.created_at,
        updated_at: ai_models.updated_at,
      })
      .from(ai_models)
      .where(eq(ai_models.user_id, req.user.id))
      .orderBy(desc(ai_models.created_at));

    return res.status(200).json({
      success: true,
      models,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new AI model configuration
 * Supports any AI model and provider without requiring model_name or max_tokens
 */
export const createAiModel = async (req, res, next) => {
  try {
    const {
      name,
      provider = 'gemini',
      model_name,
      api_key,
      base_url,
      temperature = 0.7,
      max_tokens = 4096,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Model display name is required.' });
    }
    if (!api_key || !api_key.trim()) {
      return res.status(400).json({ success: false, error: 'API Key is required.' });
    }

    const trimmedKey = api_key.trim();
    const encryptedKey = encryptKey(trimmedKey);
    const keyHint = maskApiKey(trimmedKey);
    const prov = (provider || 'gemini').toLowerCase().trim();

    // Universal model resolution: use provided model_name, provider default, or the display name
    const resolvedModel = (model_name && model_name.trim()) || DEFAULT_MODELS[prov] || name.trim() || 'default';

    const db = getDb();

    const [created] = await db
      .insert(ai_models)
      .values({
        user_id: req.user.id,
        name: name.trim(),
        provider: prov,
        model_name: resolvedModel,
        api_key_encrypted: encryptedKey,
        key_hint: keyHint,
        base_url: base_url ? base_url.trim() : null,
        temperature: String(temperature ?? 0.7),
        max_tokens: Number(max_tokens) || 4096,
        is_active: true,
      })
      .returning();

    // Mirror key to api_keys table so chatbot and other modules can use it
    try {
      const [existingKey] = await db
        .select()
        .from(api_keys)
        .where(and(eq(api_keys.user_id, req.user.id), eq(api_keys.provider, prov)))
        .limit(1);

      if (!existingKey) {
        await db.insert(api_keys).values({
          user_id: req.user.id,
          provider: prov,
          name: name.trim(),
          key_hint: keyHint,
          encrypted_key: encryptedKey,
        });
      }
    } catch (mirrorErr) {
      console.warn('[createAiModel] Key mirror warning:', mirrorErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'AI Model added successfully.',
      model: {
        id: created.id,
        name: created.name,
        provider: created.provider,
        model_name: created.model_name,
        key_hint: created.key_hint,
        base_url: created.base_url,
        temperature: created.temperature,
        max_tokens: created.max_tokens,
        is_active: created.is_active,
        created_at: created.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update an existing AI model
 */
export const updateAiModel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, provider, model_name, api_key, base_url, temperature, max_tokens, is_active } = req.body;

    const db = getDb();
    const [existing] = await db
      .select()
      .from(ai_models)
      .where(and(eq(ai_models.id, id), eq(ai_models.user_id, req.user.id)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'AI model configuration not found.' });
    }

    const updates = {
      updated_at: new Date(),
    };

    if (name) updates.name = name.trim();
    if (provider) updates.provider = provider.toLowerCase().trim();
    if (model_name) updates.model_name = model_name.trim();
    if (base_url !== undefined) updates.base_url = base_url ? base_url.trim() : null;
    if (temperature !== undefined) updates.temperature = String(temperature);
    if (max_tokens !== undefined) updates.max_tokens = Number(max_tokens) || 4096;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);

    if (api_key && api_key.trim()) {
      const trimmed = api_key.trim();
      updates.api_key_encrypted = encryptKey(trimmed);
      updates.key_hint = maskApiKey(trimmed);
    }

    const [updated] = await db
      .update(ai_models)
      .set(updates)
      .where(and(eq(ai_models.id, id), eq(ai_models.user_id, req.user.id)))
      .returning();

    return res.status(200).json({
      success: true,
      message: 'AI model updated successfully.',
      model: {
        id: updated.id,
        name: updated.name,
        provider: updated.provider,
        model_name: updated.model_name,
        key_hint: updated.key_hint,
        base_url: updated.base_url,
        temperature: updated.temperature,
        max_tokens: updated.max_tokens,
        is_active: updated.is_active,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete an AI model
 */
export const deleteAiModel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    // Clean up any health logs referencing this model first
    try {
      await db
        .delete(ai_model_health_logs)
        .where(eq(ai_model_health_logs.model_id, id));
    } catch (logErr) {
      console.warn('[deleteAiModel] Notice cleaning health logs:', logErr.message);
    }

    const [deleted] = await db
      .delete(ai_models)
      .where(and(eq(ai_models.id, id), eq(ai_models.user_id, req.user.id)))
      .returning({ id: ai_models.id });

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'AI model not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'AI model deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Ping test an AI model to verify API key and model connectivity
 */
export const testAiModel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { prompt = 'Reply with "Connected: AI model operational" in under 10 words.' } = req.body;

    const db = getDb();
    const [model] = await db
      .select()
      .from(ai_models)
      .where(and(eq(ai_models.id, id), eq(ai_models.user_id, req.user.id)))
      .limit(1);

    if (!model) {
      return res.status(404).json({ success: false, error: 'AI model not found.' });
    }

    const plainKey = decryptKey(model.api_key_encrypted);
    const result = await executeAiModelInference({
      provider: model.provider,
      model: model.model_name,
      apiKey: plainKey,
      baseUrl: model.base_url,
      temperature: Number(model.temperature) || 0.7,
      prompt,
    });

    return res.status(200).json({
      success: true,
      message: `Successfully connected to ${model.name}`,
      reply: result.text,
      durationMs: result.durationMs,
      tokens: result.tokens,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to ping AI model API.',
    });
  }
};

export default {
  getAiModels,
  createAiModel,
  updateAiModel,
  deleteAiModel,
  testAiModel,
};
