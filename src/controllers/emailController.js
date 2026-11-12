import { getDb } from '../db/drizzle.js';
import { email_integrations } from '../models/emailIntegration.js';
import { eq, and } from 'drizzle-orm';

/**
 * Email & Unipile Integration Controller
 */
export const getUnipileSettings = async (req, res, next) => {
  try {
    const db = getDb();

    const [settings] = await db
      .select()
      .from(email_integrations)
      .where(and(eq(email_integrations.user_id, req.user.id), eq(email_integrations.provider, 'unipile')))
      .limit(1);

    if (!settings) {
      return res.status(200).json({
        success: true,
        settings: null,
      });
    }

    // Mask key for safety
    const maskedKey = settings.api_key.length > 8
      ? `${settings.api_key.slice(0, 4)}••••${settings.api_key.slice(-4)}`
      : '••••••••';

    return res.status(200).json({
      success: true,
      settings: {
        id: settings.id,
        provider: settings.provider,
        api_key_masked: maskedKey,
        webhook_url: settings.webhook_url,
        account_id: settings.account_id,
        is_active: settings.is_active,
        created_at: settings.created_at,
        updated_at: settings.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const saveUnipileSettings = async (req, res, next) => {
  try {
    const { api_key, webhook_url = '', account_id = '' } = req.body;
    const db = getDb();

    if (!api_key || typeof api_key !== 'string' || api_key.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Unipile API key is required.' });
    }

    const trimmedKey = api_key.trim();
    const trimmedWebhook = webhook_url.trim();

    // Check if settings record exists
    const [existing] = await db
      .select()
      .from(email_integrations)
      .where(and(eq(email_integrations.user_id, req.user.id), eq(email_integrations.provider, 'unipile')))
      .limit(1);

    let savedRecord;

    if (existing) {
      const [updated] = await db
        .update(email_integrations)
        .set({
          api_key: trimmedKey,
          webhook_url: trimmedWebhook || existing.webhook_url,
          account_id: account_id.trim() || existing.account_id,
          updated_at: new Date(),
        })
        .where(eq(email_integrations.id, existing.id))
        .returning();
      savedRecord = updated;
    } else {
      const [created] = await db
        .insert(email_integrations)
        .values({
          user_id: req.user.id,
          provider: 'unipile',
          api_key: trimmedKey,
          webhook_url: trimmedWebhook,
          account_id: account_id.trim() || null,
        })
        .returning();
      savedRecord = created;
    }

    const maskedKey = savedRecord.api_key.length > 8
      ? `${savedRecord.api_key.slice(0, 4)}••••${savedRecord.api_key.slice(-4)}`
      : '••••••••';

    return res.status(200).json({
      success: true,
      message: 'Unipile settings saved successfully.',
      settings: {
        id: savedRecord.id,
        provider: savedRecord.provider,
        api_key_masked: maskedKey,
        webhook_url: savedRecord.webhook_url,
        account_id: savedRecord.account_id,
        is_active: savedRecord.is_active,
        updated_at: savedRecord.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Inbound Webhook Listener for Unipile events
 */
export const handleWebhook = async (req, res) => {
  try {
    const payload = req.body;
    if (process.env.NODE_ENV === 'development') {
      console.log('[Unipile Webhook Received]:', JSON.stringify(payload, null, 2));
    }
    return res.status(200).json({ success: true, received: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export default {
  getUnipileSettings,
  saveUnipileSettings,
  handleWebhook,
};

