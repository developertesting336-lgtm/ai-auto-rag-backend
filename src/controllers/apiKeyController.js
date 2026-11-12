import { getDb } from '../db/drizzle.js';
import { api_keys } from '../models/apiKey.js';
import { eq, and, desc } from 'drizzle-orm';

export const saveKey = async (req, res, next) => {
  try {
    const { provider, name, api_key } = req.body;
    const db = getDb();

    if (!provider || !name || !api_key) {
      return res.status(400).json({
        success: false,
        error: 'Provider, name, and api_key are required.',
      });
    }

    const trimmed = api_key.trim();
    const key_hint = trimmed.length > 8
      ? `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
      : '••••••••';

    const [keyRecord] = await db
      .insert(api_keys)
      .values({
        user_id: req.user.id,
        provider: provider.toLowerCase().trim(),
        name: name.trim(),
        key_hint,
        encrypted_key: trimmed,
      })
      .returning({
        id: api_keys.id,
        user_id: api_keys.user_id,
        provider: api_keys.provider,
        name: api_keys.name,
        key_hint: api_keys.key_hint,
        is_active: api_keys.is_active,
        created_at: api_keys.created_at,
      });

    return res.status(201).json({
      success: true,
      message: 'API Key added successfully.',
      data: keyRecord,
    });
  } catch (err) {
    next(err);
  }
};

export const getKeys = async (req, res, next) => {
  try {
    const db = getDb();
    const keys = await db
      .select({
        id: api_keys.id,
        provider: api_keys.provider,
        name: api_keys.name,
        key_hint: api_keys.key_hint,
        is_active: api_keys.is_active,
        created_at: api_keys.created_at,
      })
      .from(api_keys)
      .where(eq(api_keys.user_id, req.user.id))
      .orderBy(desc(api_keys.created_at));

    return res.status(200).json({
      success: true,
      data: keys,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const [deleted] = await db
      .delete(api_keys)
      .where(and(eq(api_keys.id, id), eq(api_keys.user_id, req.user.id)))
      .returning({ id: api_keys.id });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'API Key not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'API Key deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};

export default {
  saveKey,
  getKeys,
  deleteKey,
};
