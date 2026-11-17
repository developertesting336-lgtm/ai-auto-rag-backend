import crypto from 'crypto';
import { getDb } from '../db/drizzle.js';
import { email_integrations, inbound_emails } from '../models/emailIntegration.js';
import { eq, and, desc } from 'drizzle-orm';
import { getUserSubscriptionStatus } from '../middleware/subscriptionMiddleware.js';

/**
 * Generate a cryptographically secure unique webhook token
 */
function generateWebhookToken() {
  return `whk_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Email & Unipile Integration Controller
 */
export const getUnipileSettings = async (req, res, next) => {
  try {
    const db = getDb();
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const baseUrl = `${protocol}://${host}`;

    let [settings] = await db
      .select()
      .from(email_integrations)
      .where(and(eq(email_integrations.user_id, req.user.id), eq(email_integrations.provider, 'unipile')))
      .limit(1);

    // If user has no record or missing webhook_token, auto-generate one
    if (!settings) {
      const token = generateWebhookToken();
      const [created] = await db
        .insert(email_integrations)
        .values({
          user_id: req.user.id,
          provider: 'unipile',
          api_key: '',
          webhook_token: token,
          is_active: true,
        })
        .returning();
      settings = created;
    } else if (!settings.webhook_token) {
      const token = generateWebhookToken();
      const [updated] = await db
        .update(email_integrations)
        .set({ webhook_token: token })
        .where(eq(email_integrations.id, settings.id))
        .returning();
      settings = updated;
    }

    // Mask key for safety
    const maskedKey = settings.api_key && settings.api_key.length > 8
      ? `${settings.api_key.slice(0, 4)}••••${settings.api_key.slice(-4)}`
      : (settings.api_key ? '••••••••' : '');

    const dedicatedWebhookUrl = `${baseUrl}/api/email/webhook/${settings.webhook_token}`;

    return res.status(200).json({
      success: true,
      settings: {
        id: settings.id,
        provider: settings.provider,
        api_key_masked: maskedKey,
        webhook_token: settings.webhook_token,
        webhook_url: dedicatedWebhookUrl,
        account_id: settings.account_id,
        ai_prompt: settings.ai_prompt || '',
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
    const { api_key, account_id, ai_prompt } = req.body;
    const db = getDb();
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const baseUrl = `${protocol}://${host}`;

    // Check if settings record exists
    const [existing] = await db
      .select()
      .from(email_integrations)
      .where(and(eq(email_integrations.user_id, req.user.id), eq(email_integrations.provider, 'unipile')))
      .limit(1);

    const trimmedKey = typeof api_key === 'string' ? api_key.trim() : '';
    const finalKey = trimmedKey || existing?.api_key || '';

    // If new integration and no key provided
    if (!existing && !finalKey) {
      return res.status(400).json({ success: false, error: 'Unipile API key is required.' });
    }

    const trimmedAccountId = account_id !== undefined ? String(account_id).trim() : (existing?.account_id || null);
    const finalPrompt = ai_prompt !== undefined ? String(ai_prompt).trim() : (existing?.ai_prompt || null);

    let savedRecord;

    if (existing) {
      const token = existing.webhook_token || generateWebhookToken();
      const updateData = {
        updated_at: new Date(),
      };
      if (trimmedKey) updateData.api_key = trimmedKey;
      if (account_id !== undefined) updateData.account_id = trimmedAccountId;
      if (ai_prompt !== undefined) updateData.ai_prompt = finalPrompt;
      if (!existing.webhook_token) updateData.webhook_token = token;

      const [updated] = await db
        .update(email_integrations)
        .set(updateData)
        .where(eq(email_integrations.id, existing.id))
        .returning();
      savedRecord = updated;
    } else {
      const token = generateWebhookToken();
      const [created] = await db
        .insert(email_integrations)
        .values({
          user_id: req.user.id,
          provider: 'unipile',
          api_key: finalKey,
          webhook_token: token,
          account_id: trimmedAccountId || null,
          ai_prompt: finalPrompt || null,
        })
        .returning();
      savedRecord = created;
    }

    const maskedKey = savedRecord.api_key && savedRecord.api_key.length > 8
      ? `${savedRecord.api_key.slice(0, 4)}••••${savedRecord.api_key.slice(-4)}`
      : (savedRecord.api_key ? '••••••••' : '');

const dedicatedWebhookUrl = `${baseUrl}/api/email/webhook/${savedRecord.webhook_token}`;

return res.status(200).json({
  success: true,
  message: 'Unipile configuration updated successfully.',
  settings: {
    id: savedRecord.id,
    provider: savedRecord.provider,
    api_key_masked: maskedKey,
    webhook_token: savedRecord.webhook_token,
    webhook_url: dedicatedWebhookUrl,
    account_id: savedRecord.account_id,
    ai_prompt: savedRecord.ai_prompt || '',
    is_active: savedRecord.is_active,
    updated_at: savedRecord.updated_at,
  },
});
  } catch (err) {
  next(err);
}
};

/**
 * Dedicated endpoint to update AI Email Automation Prompt & Instructions
 */
export const saveEmailPrompt = async (req, res, next) => {
  try {
    const { prompt } = req.body;
    const db = getDb();

    if (prompt === undefined || typeof prompt !== 'string') {
      return res.status(400).json({ success: false, error: 'Prompt string is required.' });
    }

    const trimmedPrompt = prompt.trim();

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
          ai_prompt: trimmedPrompt,
          updated_at: new Date(),
        })
        .where(eq(email_integrations.id, existing.id))
        .returning();
      savedRecord = updated;
    } else {
      const token = generateWebhookToken();
      const [created] = await db
        .insert(email_integrations)
        .values({
          user_id: req.user.id,
          provider: 'unipile',
          api_key: '',
          webhook_token: token,
          ai_prompt: trimmedPrompt,
          is_active: true,
        })
        .returning();
      savedRecord = created;
    }

    return res.status(200).json({
      success: true,
      message: 'AI email prompt instructions saved successfully.',
      ai_prompt: savedRecord.ai_prompt || '',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Inbound Webhook Listener for Unipile events
 * High-scale multi-tenant identification:
 * 1. Primary: Unique URL token (/api/email/webhook/:token)
 * 2. Secondary: Unipile account_id matching from payload
 */
export const handleWebhook = async (req, res) => {
  try {
    const db = getDb();
    const token = req.params.token || req.query.token;
    const payload = req.body || {};

    const accountId =
      payload.account_id ||
      payload.data?.account_id ||
      payload.accountId ||
      payload.data?.accountId;

    let integration = null;

    // Strategy 1: URL Token (Guaranteed O(1) multi-tenant lookup)
    if (token) {
      const [found] = await db
        .select()
        .from(email_integrations)
        .where(eq(email_integrations.webhook_token, token.trim()))
        .limit(1);
      integration = found;
    }

    // Strategy 2: Unipile Account ID matching (Indexed lookup)
    if (!integration && accountId) {
      const [found] = await db
        .select()
        .from(email_integrations)
        .where(eq(email_integrations.account_id, String(accountId).trim()))
        .limit(1);
      integration = found;
    }

    if (!integration) {
      console.warn('[Unipile Webhook] Unidentified event: No matching token or account_id found.');
      // Return 200 so Unipile does not aggressively retry invalid endpoints
      return res.status(200).json({
        success: false,
        warning: 'Unrecognized webhook token or account_id. Please verify your integration setup.',
      });
    }

    // Subscription & 7-Day Trial Check: After 1 week, email automation halts unless paid
    const subStatus = await getUserSubscriptionStatus(integration.user_id);
    if (!subStatus.hasActiveSubscription) {
      console.warn(`[Unipile Webhook] User ${integration.user_id} 7-day trial expired or unpaid. Halting automation.`);
      return res.status(200).json({
        success: false,
        warning: 'Email automation halted: 7-day free trial expired. An active subscription is required to process and automate emails.',
        trialExpired: subStatus.isTrialExpired,
      });
    }

    // Extract email data from Unipile mail_received event
    const emailData = payload.data || payload;
    let fromEmail = '';
    let fromName = '';

    if (typeof emailData.from === 'object' && emailData.from !== null) {
      fromEmail = emailData.from.email || emailData.from.identifier || emailData.from.address || '';
      fromName = emailData.from.name || emailData.from.display_name || '';
    } else if (typeof emailData.from === 'string') {
      const match = emailData.from.match(/^(.*?)\s*<(.+?)>$/);
      if (match) {
        fromName = match[1].trim();
        fromEmail = match[2].trim();
      } else {
        fromEmail = emailData.from.trim();
      }
    }

    const toEmail = Array.isArray(emailData.to)
      ? emailData.to.map((t) => (typeof t === 'object' && t !== null ? t.email || t.identifier || t.address : t)).join(', ')
      : (emailData.to || '');

    const subject = emailData.subject || 'No Subject';
    const body = emailData.body || emailData.body_plain || emailData.body_html || emailData.text || emailData.snippet || '';
    const plainText = body.replace(/<[^>]*>?/gm, '').trim();
    const snippet = emailData.snippet || (plainText ? plainText.slice(0, 180) : '');
    const messageId = emailData.id || emailData.message_id || payload.id || null;

    // Store inbound email event in database
    const [savedInbound] = await db
      .insert(inbound_emails)
      .values({
        user_id: integration.user_id,
        account_id: accountId || integration.account_id || null,
        message_id: messageId,
        from_email: fromEmail,
        from_name: fromName,
        to_email: toEmail,
        subject: subject,
        snippet: snippet,
        body: body,
        reply_status: 'received',
        raw_payload: payload,
      })
      .returning();

    console.log(`[Unipile Webhook] Stored inbound email from "${fromEmail}" (Subject: "${subject}") for user ${integration.user_id}`);

    return res.status(200).json({
      success: true,
      received: true,
      emailId: savedInbound.id,
      userId: integration.user_id,
    });
  } catch (err) {
    console.error('[Unipile Webhook Error]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Fetch inbound emails for the logged-in user
 */
export const getInboundEmails = async (req, res, next) => {
  try {
    const db = getDb();
    const emails = await db
      .select()
      .from(inbound_emails)
      .where(eq(inbound_emails.user_id, req.user.id))
      .orderBy(desc(inbound_emails.created_at))
      .limit(100);

    return res.status(200).json({
      success: true,
      emails,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Fetch a single inbound email by ID, and if possible fetch live details from Unipile
 */
export const getInboundEmailById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    // Look up email by DB uuid
    const [email] = await db
      .select()
      .from(inbound_emails)
      .where(and(eq(inbound_emails.user_id, req.user.id), eq(inbound_emails.id, id)))
      .limit(1);

    if (!email) {
      return res.status(404).json({ success: false, error: 'Email record not found.' });
    }

    // Check if user has an active Unipile integration
    const [integration] = await db
      .select()
      .from(email_integrations)
      .where(and(eq(email_integrations.user_id, req.user.id), eq(email_integrations.provider, 'unipile')))
      .limit(1);

    let unipileLive = null;
    let unipileNote = null;

    // If email has Unipile message ID and user has API key, fetch live from Unipile
    if (email.message_id && integration?.api_key && !email.message_id.startsWith('msg_sim_')) {
      try {
        const unipileEndpoints = [
          `https://api.unipile.com/api/v1/emails/${email.message_id}`,
          `https://api.unipile.com/api/v1/messages/${email.message_id}`,
        ];

        for (const endpoint of unipileEndpoints) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const uniRes = await fetch(endpoint, {
              headers: {
                'X-API-KEY': integration.api_key,
                Accept: 'application/json',
              },
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (uniRes.ok) {
              const data = await uniRes.json();
              if (data && (data.id || data.subject || data.body)) {
                unipileLive = data;
                break;
              }
            }
          } catch (fetchErr) {
            unipileNote = `Unipile fetch note: ${fetchErr.message}`;
          }
        }
      } catch (err) {
        unipileNote = err.message;
      }
    }

    return res.status(200).json({
      success: true,
      email,
      unipileLive,
      unipileNote,
      source: unipileLive ? 'unipile_live' : 'database',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Simulate an inbound email arrival for testing the webhook pipeline
 */
export const simulateInboundEmail = async (req, res, next) => {
  try {
    const {
      from_name = 'Jane Doe',
      from_email = 'jane.doe@acmecorp.com',
      to_email = 'support@yourdomain.com',
      subject = 'Question regarding enterprise refund & SLA policies',
      body = 'Hi Team,\n\nI reviewed your published documentation and wanted to verify your cancellation policy and standard response SLAs for enterprise accounts.\n\nCould you also share your security protocols?\n\nThank you,\nJane Doe\nVP of Operations, Acme Corp',
    } = req.body || {};

    const db = getDb();

    const [integration] = await db
      .select()
      .from(email_integrations)
      .where(and(eq(email_integrations.user_id, req.user.id), eq(email_integrations.provider, 'unipile')))
      .limit(1);

    const mockMessageId = `msg_sim_${crypto.randomBytes(8).toString('hex')}`;
    const plainSnippet = body.replace(/<[^>]*>?/gm, '').slice(0, 180);

    const [saved] = await db
      .insert(inbound_emails)
      .values({
        user_id: req.user.id,
        account_id: integration?.account_id || 'acc_unipile_demo',
        message_id: mockMessageId,
        from_email,
        from_name,
        to_email,
        subject,
        snippet: plainSnippet,
        body,
        reply_status: 'received',
        raw_payload: {
          event: 'mail_received',
          simulated: true,
          id: mockMessageId,
          account_id: integration?.account_id || 'acc_unipile_demo',
          date: new Date().toISOString(),
          from: { name: from_name, email: from_email },
          to: [{ email: to_email }],
          subject,
          snippet: plainSnippet,
          body,
        },
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: 'Simulated inbound webhook email created and saved to database.',
      email: saved,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getUnipileSettings,
  saveUnipileSettings,
  saveEmailPrompt,
  handleWebhook,
  getInboundEmails,
  getInboundEmailById,
  simulateInboundEmail,
};

