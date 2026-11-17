import crypto from 'crypto';
import { getDb } from '../db/drizzle.js';
import { email_campaigns, campaign_email_logs } from '../models/campaign.js';
import { ai_models } from '../models/aiModel.js';
import { eq, and, desc } from 'drizzle-orm';
import { encryptKey, decryptKey, maskApiKey } from '../utils/crypto.js';
import { executeAiModelInference } from '../services/aiInferenceService.js';
import { getUserSubscriptionStatus } from '../middleware/subscriptionMiddleware.js';

function generateCampaignWebhookToken() {
  return `cmp_${crypto.randomBytes(16).toString('hex')}`;
}

function getBaseUrl(req) {
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${protocol}://${host}`;
}

/**
 * Fetch all campaigns for the logged-in user
 */
export const getCampaigns = async (req, res, next) => {
  try {
    const db = getDb();
    const baseUrl = getBaseUrl(req);

    const campaigns = await db
      .select({
        id: email_campaigns.id,
        user_id: email_campaigns.user_id,
        name: email_campaigns.name,
        description: email_campaigns.description,
        webhook_token: email_campaigns.webhook_token,
        unipile_key_hint: email_campaigns.unipile_key_hint,
        unipile_account_id: email_campaigns.unipile_account_id,
        unipile_dsn: email_campaigns.unipile_dsn,
        ai_model_id: email_campaigns.ai_model_id,
        ai_model_name: email_campaigns.ai_model_name,
        ai_provider: email_campaigns.ai_provider,
        ai_prompt: email_campaigns.ai_prompt,
        status: email_campaigns.status,
        total_received: email_campaigns.total_received,
        total_replied: email_campaigns.total_replied,
        created_at: email_campaigns.created_at,
        updated_at: email_campaigns.updated_at,
      })
      .from(email_campaigns)
      .where(eq(email_campaigns.user_id, req.user.id))
      .orderBy(desc(email_campaigns.created_at));

    const enriched = campaigns.map((c) => ({
      ...c,
      webhook_url: `${baseUrl}/api/campaigns/webhook/${c.webhook_token}`,
    }));

    return res.status(200).json({
      success: true,
      campaigns: enriched,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new email campaign
 */
export const createCampaign = async (req, res, next) => {
  try {
    const {
      name,
      description = '',
      unipile_api_key = '',
      unipile_account_id = '',
      unipile_dsn = '',
      ai_model_id = null,
      ai_prompt,
      status = 'active',
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Campaign name is required.' });
    }
    if (!ai_prompt || !ai_prompt.trim()) {
      return res.status(400).json({ success: false, error: 'AI prompt instructions are required.' });
    }

    const db = getDb();
    const baseUrl = getBaseUrl(req);
    const token = generateCampaignWebhookToken();

    // Look up AI model details if provided
    let modelName = 'gemini-2.0-flash';
    let modelProvider = 'gemini';

    if (ai_model_id) {
      const [foundModel] = await db
        .select()
        .from(ai_models)
        .where(and(eq(ai_models.id, ai_model_id), eq(ai_models.user_id, req.user.id)))
        .limit(1);

      if (foundModel) {
        modelName = foundModel.model_name;
        modelProvider = foundModel.provider;
      }
    }

    const trimmedUnipileKey = (unipile_api_key || '').trim();
    const encryptedUnipileKey = trimmedUnipileKey ? encryptKey(trimmedUnipileKey) : null;
    const unipileKeyHint = trimmedUnipileKey ? maskApiKey(trimmedUnipileKey) : null;

    const [created] = await db
      .insert(email_campaigns)
      .values({
        user_id: req.user.id,
        name: name.trim(),
        description: description ? description.trim() : '',
        webhook_token: token,
        unipile_api_key_encrypted: encryptedUnipileKey,
        unipile_key_hint: unipileKeyHint,
        unipile_account_id: unipile_account_id ? unipile_account_id.trim() : null,
        unipile_dsn: unipile_dsn ? unipile_dsn.trim() : null,
        ai_model_id: ai_model_id || null,
        ai_model_name: modelName,
        ai_provider: modelProvider,
        ai_prompt: ai_prompt.trim(),
        status: status === 'paused' ? 'paused' : 'active',
        total_received: 0,
        total_replied: 0,
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: 'Email Campaign created successfully.',
      campaign: {
        ...created,
        webhook_url: `${baseUrl}/api/campaigns/webhook/${created.webhook_token}`,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get single campaign with recent activity logs
 */
export const getCampaignById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const baseUrl = getBaseUrl(req);

    const [campaign] = await db
      .select()
      .from(email_campaigns)
      .where(and(eq(email_campaigns.id, id), eq(email_campaigns.user_id, req.user.id)))
      .limit(1);

    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found.' });
    }

    const logs = await db
      .select()
      .from(campaign_email_logs)
      .where(eq(campaign_email_logs.campaign_id, campaign.id))
      .orderBy(desc(campaign_email_logs.created_at))
      .limit(50);

    return res.status(200).json({
      success: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        webhook_token: campaign.webhook_token,
        webhook_url: `${baseUrl}/api/campaigns/webhook/${campaign.webhook_token}`,
        unipile_key_hint: campaign.unipile_key_hint,
        unipile_account_id: campaign.unipile_account_id,
        unipile_dsn: campaign.unipile_dsn,
        ai_model_id: campaign.ai_model_id,
        ai_model_name: campaign.ai_model_name,
        ai_provider: campaign.ai_provider,
        ai_prompt: campaign.ai_prompt,
        status: campaign.status,
        total_received: campaign.total_received,
        total_replied: campaign.total_replied,
        created_at: campaign.created_at,
        updated_at: campaign.updated_at,
        logs,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update an existing campaign
 */
export const updateCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      unipile_api_key,
      unipile_account_id,
      unipile_dsn,
      ai_model_id,
      ai_prompt,
      status,
    } = req.body;

    const db = getDb();
    const baseUrl = getBaseUrl(req);

    const [existing] = await db
      .select()
      .from(email_campaigns)
      .where(and(eq(email_campaigns.id, id), eq(email_campaigns.user_id, req.user.id)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Campaign not found.' });
    }

    const updates = {
      updated_at: new Date(),
    };

    if (name) updates.name = name.trim();
    if (description !== undefined) updates.description = description.trim();
    if (unipile_account_id !== undefined) updates.unipile_account_id = unipile_account_id.trim();
    if (unipile_dsn !== undefined) updates.unipile_dsn = unipile_dsn.trim();
    if (ai_prompt) updates.ai_prompt = ai_prompt.trim();
    if (status) updates.status = status;

    if (unipile_api_key && unipile_api_key.trim()) {
      const trimmed = unipile_api_key.trim();
      updates.unipile_api_key_encrypted = encryptKey(trimmed);
      updates.unipile_key_hint = maskApiKey(trimmed);
    }

    if (ai_model_id) {
      const [foundModel] = await db
        .select()
        .from(ai_models)
        .where(and(eq(ai_models.id, ai_model_id), eq(ai_models.user_id, req.user.id)))
        .limit(1);

      if (foundModel) {
        updates.ai_model_id = foundModel.id;
        updates.ai_model_name = foundModel.model_name;
        updates.ai_provider = foundModel.provider;
      }
    }

    const [updated] = await db
      .update(email_campaigns)
      .set(updates)
      .where(and(eq(email_campaigns.id, id), eq(email_campaigns.user_id, req.user.id)))
      .returning();

    return res.status(200).json({
      success: true,
      message: 'Campaign updated successfully.',
      campaign: {
        ...updated,
        webhook_url: `${baseUrl}/api/campaigns/webhook/${updated.webhook_token}`,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a campaign
 */
export const deleteCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const [deleted] = await db
      .delete(email_campaigns)
      .where(and(eq(email_campaigns.id, id), eq(email_campaigns.user_id, req.user.id)))
      .returning({ id: email_campaigns.id });

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Campaign not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Campaign deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Webhook Listener for Unipile events routing into Campaign
 * Endpoint: POST /api/campaigns/webhook/:token
 */
export const handleCampaignWebhook = async (req, res) => {
  try {
    const db = getDb();
    const token = req.params.token || req.query.token;
    const payload = req.body || {};

    if (!token) {
      return res.status(400).json({ success: false, error: 'Missing campaign webhook token in URL.' });
    }

    // Look up campaign by webhook_token
    const [campaign] = await db
      .select()
      .from(email_campaigns)
      .where(eq(email_campaigns.webhook_token, token.trim()))
      .limit(1);

    if (!campaign) {
      console.warn(`[Campaign Webhook] No campaign matched token: ${token}`);
      return res.status(200).json({ success: false, warning: 'Unrecognized campaign webhook token.' });
    }

    if (campaign.status === 'paused') {
      return res.status(200).json({ success: true, message: 'Campaign is paused. Webhook logged without action.' });
    }

    // Subscription & 7-Day Free Trial Gating Check
    const subStatus = await getUserSubscriptionStatus(campaign.user_id);
    if (!subStatus.hasActiveSubscription) {
      console.warn(`[Campaign Webhook] User ${campaign.user_id} trial expired or unpaid. Halting automation.`);
      return res.status(200).json({
        success: false,
        warning: 'Campaign automation halted: 7-day free trial expired. An active subscription is required to send emails.',
        trialExpired: subStatus.isTrialExpired,
      });
    }

    // Extract email data
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
      ? emailData.to.map((t) => (typeof t === 'object' && t !== null ? t.email || t.identifier : t)).join(', ')
      : (emailData.to || '');

    const subject = emailData.subject || 'No Subject';
    const rawBody = emailData.body || emailData.body_plain || emailData.body_html || emailData.text || emailData.snippet || '';
    const plainText = rawBody.replace(/<[^>]*>?/gm, '').trim();
    const snippet = plainText ? plainText.slice(0, 180) : '';
    const messageId = emailData.id || emailData.message_id || payload.id || null;

    // Increment received counter
    await db
      .update(email_campaigns)
      .set({
        total_received: (campaign.total_received || 0) + 1,
        updated_at: new Date(),
      })
      .where(eq(email_campaigns.id, campaign.id));

    // Resolve AI Model & Key
    let aiKey = process.env.GEMINI_API_KEY;
    let provider = campaign.ai_provider || 'gemini';
    let modelName = campaign.ai_model_name || 'gemini-2.0-flash';
    let baseUrl = null;

    if (campaign.ai_model_id) {
      const [aiModelRec] = await db
        .select()
        .from(ai_models)
        .where(eq(ai_models.id, campaign.ai_model_id))
        .limit(1);

      if (aiModelRec) {
        aiKey = decryptKey(aiModelRec.api_key_encrypted);
        provider = aiModelRec.provider;
        modelName = aiModelRec.model_name;
        baseUrl = aiModelRec.base_url;
      }
    }

    // Generate AI Reply using campaign prompt
    let aiGeneratedReply = '';
    let replyStatus = 'received';
    let errorMessage = null;

    try {
      const promptInput = `INCOMING EMAIL TO PROCESS:
From: ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}
Subject: ${subject}

Email Content:
${plainText || 'No email body provided.'}

Based on the campaign instructions, formulate an email reply:`;

      const aiResult = await executeAiModelInference({
        provider,
        model: modelName,
        apiKey: aiKey,
        baseUrl,
        systemPrompt: campaign.ai_prompt,
        prompt: promptInput,
      });

      aiGeneratedReply = aiResult.text;

      // Send reply via Unipile API if credentials are configured
      const plainUnipileKey = decryptKey(campaign.unipile_api_key_encrypted);
      const unipileAccountId = campaign.unipile_account_id;

      if (plainUnipileKey && unipileAccountId && fromEmail) {
        const dsn = campaign.unipile_dsn || 'https://api.unipile.com';
        const sendEndpoint = `${dsn.replace(/\/$/, '')}/api/v1/emails`;

        const sendRes = await fetch(sendEndpoint, {
          method: 'POST',
          headers: {
            'X-API-KEY': plainUnipileKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            account_id: unipileAccountId,
            to: [{ email: fromEmail, name: fromName || fromEmail }],
            subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
            body: aiGeneratedReply,
            in_reply_to: messageId,
          }),
        });

        if (sendRes.ok) {
          replyStatus = 'replied';
          await db
            .update(email_campaigns)
            .set({
              total_replied: (campaign.total_replied || 0) + 1,
            })
            .where(eq(email_campaigns.id, campaign.id));
        } else {
          const errData = await sendRes.json().catch(() => ({}));
          errorMessage = `Unipile send returned HTTP ${sendRes.status}: ${JSON.stringify(errData)}`;
          replyStatus = 'failed';
        }
      } else {
        replyStatus = 'generated'; // AI drafted response, ready or pending sending
      }
    } catch (aiErr) {
      console.error('[Campaign Webhook AI Error]:', aiErr);
      errorMessage = aiErr.message;
      replyStatus = 'failed';
    }

    // Save log entry in campaign_email_logs
    await db.insert(campaign_email_logs).values({
      campaign_id: campaign.id,
      user_id: campaign.user_id,
      message_id: messageId,
      account_id: campaign.unipile_account_id,
      from_email: fromEmail,
      from_name: fromName,
      to_email: toEmail,
      subject,
      snippet,
      body: plainText,
      reply_status: replyStatus,
      ai_generated_reply: aiGeneratedReply,
      ai_model_used: `${provider}/${modelName}`,
      error_message: errorMessage,
      raw_payload: payload,
    });

    return res.status(200).json({
      success: true,
      message: 'Campaign webhook processed successfully.',
      replyStatus,
      aiGeneratedReply,
    });
  } catch (err) {
    console.error('[handleCampaignWebhook Error]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Simulate or Test run a campaign directly from dashboard
 */
export const simulateCampaignTrigger = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      from_email = 'prospect@enterprise-client.com',
      from_name = 'Sarah Connor',
      subject = 'Pricing question for enterprise plan',
      body = 'Hello, We are reviewing your automation SAS solution for our team of 25. Could you share your enterprise pricing and SLA terms?',
    } = req.body;

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(email_campaigns)
      .where(and(eq(email_campaigns.id, id), eq(email_campaigns.user_id, req.user.id)))
      .limit(1);

    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found.' });
    }

    // Resolve AI Model & Key
    let aiKey = process.env.GEMINI_API_KEY;
    let provider = campaign.ai_provider || 'gemini';
    let modelName = campaign.ai_model_name || 'gemini-2.0-flash';
    let baseUrl = null;

    if (campaign.ai_model_id) {
      const [aiModelRec] = await db
        .select()
        .from(ai_models)
        .where(eq(ai_models.id, campaign.ai_model_id))
        .limit(1);

      if (aiModelRec) {
        aiKey = decryptKey(aiModelRec.api_key_encrypted);
        provider = aiModelRec.provider;
        modelName = aiModelRec.model_name;
        baseUrl = aiModelRec.base_url;
      }
    }

    const promptInput = `INCOMING EMAIL TO PROCESS:
From: ${from_name} <${from_email}>
Subject: ${subject}

Email Content:
${body}

Based on the campaign instructions, formulate an email reply:`;

    const startTime = Date.now();
    const aiResult = await executeAiModelInference({
      provider,
      model: modelName,
      apiKey: aiKey,
      baseUrl,
      systemPrompt: campaign.ai_prompt,
      prompt: promptInput,
    });

    const aiReply = aiResult.text;
    const durationMs = Date.now() - startTime;

    // Record simulation in campaign logs
    const [log] = await db
      .insert(campaign_email_logs)
      .values({
        campaign_id: campaign.id,
        user_id: req.user.id,
        message_id: `sim_${Date.now()}`,
        account_id: campaign.unipile_account_id,
        from_email,
        from_name,
        to_email: 'you@yourcompany.com',
        subject,
        snippet: body.slice(0, 160),
        body,
        reply_status: 'replied',
        ai_generated_reply: aiReply,
        ai_model_used: `${provider}/${modelName}`,
        raw_payload: { simulated: true },
      })
      .returning();

    // Increment counter
    await db
      .update(email_campaigns)
      .set({
        total_received: (campaign.total_received || 0) + 1,
        total_replied: (campaign.total_replied || 0) + 1,
        updated_at: new Date(),
      })
      .where(eq(email_campaigns.id, campaign.id));

    return res.status(200).json({
      success: true,
      message: 'Campaign simulated successfully.',
      reply: aiReply,
      durationMs,
      modelUsed: `${provider}/${modelName}`,
      log,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Simulation failed.',
    });
  }
};

/**
 * Fetch logs for a specific campaign
 */
export const getCampaignLogs = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(email_campaigns)
      .where(and(eq(email_campaigns.id, id), eq(email_campaigns.user_id, req.user.id)))
      .limit(1);

    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found.' });
    }

    const logs = await db
      .select()
      .from(campaign_email_logs)
      .where(eq(campaign_email_logs.campaign_id, campaign.id))
      .orderBy(desc(campaign_email_logs.created_at))
      .limit(100);

    return res.status(200).json({
      success: true,
      logs,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getCampaigns,
  createCampaign,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  handleCampaignWebhook,
  simulateCampaignTrigger,
  getCampaignLogs,
};
