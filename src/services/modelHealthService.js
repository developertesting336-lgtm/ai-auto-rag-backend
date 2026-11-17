import { getDb } from '../db/drizzle.js';
import { ai_models } from '../models/aiModel.js';
import { ai_model_health_logs } from '../models/healthLog.js';
import { user_notifications } from '../models/notification.js';
import { eq, desc, and } from 'drizzle-orm';
import { decryptKey } from '../utils/crypto.js';
import { executeAiModelInference } from './aiInferenceService.js';

let lastHourlyCheckTime = null;
let isCheckingHealth = false;

/**
 * Check health of a single AI model
 */
export async function checkSingleModelHealth(model) {
  const startTime = Date.now();
  try {
    const plainKey = decryptKey(model.api_key_encrypted);
    if (!plainKey) {
      throw new Error(`Unable to decrypt API key for "${model.name}".`);
    }

    const testPrompt = 'Health ping: respond "OK" in 1 word.';
    const result = await executeAiModelInference({
      provider: model.provider,
      model: model.model_name,
      apiKey: plainKey,
      baseUrl: model.base_url,
      temperature: 0.1,
      prompt: testPrompt,
    });

    const latency = result.durationMs || (Date.now() - startTime);
    return {
      success: true,
      status: 'healthy',
      latency_ms: latency,
      error_message: null,
      reply: result.text?.trim()?.slice(0, 30),
    };
  } catch (err) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      status: 'error',
      latency_ms: latency,
      error_message: err.message || 'Unknown health check failure',
    };
  }
}

/**
 * Check health of all active AI models (or filtered by userId)
 * Records logs into ai_model_health_logs and creates user_notifications on failure
 */
export async function runAllModelsHealthCheck({ checkType = 'hourly_cron', userId = null } = {}) {
  if (isCheckingHealth) {
    console.log('[ModelHealthService] Health check already in progress, skipping overlapping run.');
    return { skipped: true, reason: 'Already in progress' };
  }

  isCheckingHealth = true;
  lastHourlyCheckTime = new Date();
  console.log(`🕒 [ModelHealthService] Starting ${checkType} health check...`);

  try {
    const db = getDb();
    let queryBuilder = db.select().from(ai_models).where(eq(ai_models.is_active, true));
    if (userId) {
      queryBuilder = db.select().from(ai_models).where(and(eq(ai_models.is_active, true), eq(ai_models.user_id, userId)));
    }

    const models = await queryBuilder;
    console.log(`[ModelHealthService] Evaluating ${models.length} active AI model(s)...`);

    const results = [];

    for (const model of models) {
      const outcome = await checkSingleModelHealth(model);

      // Record in ai_model_health_logs
      try {
        const [logRecord] = await db
          .insert(ai_model_health_logs)
          .values({
            model_id: model.id,
            user_id: model.user_id,
            status: outcome.status,
            latency_ms: outcome.latency_ms,
            error_message: outcome.error_message,
            check_type: checkType,
          })
          .returning();

        // If error, generate a user notification
        if (!outcome.success) {
          console.warn(`⚠️ [ModelHealthService] Model "${model.name}" failed: ${outcome.error_message}`);
          await db.insert(user_notifications).values({
            user_id: model.user_id,
            title: `⚠️ AI Model Failure: ${model.name}`,
            message: `Hourly health check failed for "${model.name}" (${model.provider.toUpperCase()}): ${outcome.error_message}`,
            type: 'health_alert',
            severity: 'critical',
            data: {
              model_id: model.id,
              model_name: model.name,
              provider: model.provider,
              latency_ms: outcome.latency_ms,
              error: outcome.error_message,
              checked_at: new Date().toISOString(),
            },
          });
        }

        results.push({
          model_id: model.id,
          model_name: model.name,
          provider: model.provider,
          ...outcome,
          log_id: logRecord?.id,
        });
      } catch (logErr) {
        console.error('[ModelHealthService] Failed to record log:', logErr.message);
      }
    }

    console.log(`✅ [ModelHealthService] Finished health check. Evaluated ${results.length} model(s).`);
    return {
      success: true,
      timestamp: lastHourlyCheckTime,
      total_checked: results.length,
      healthy_count: results.filter((r) => r.success).length,
      error_count: results.filter((r) => !r.success).length,
      results,
    };
  } catch (err) {
    console.error('❌ [ModelHealthService] Critical error in health checker:', err);
    return {
      success: false,
      error: err.message,
    };
  } finally {
    isCheckingHealth = false;
  }
}

/**
 * Start the recurring 1-Hour Health Check Cron Scheduler
 */
let schedulerInterval = null;

export function startHourlyHealthScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour

  console.log('⏰ [ModelHealthService] Initializing 1-Hour Automated AI Model Health Cron...');

  // Run initial check 30 seconds after server starts
  setTimeout(() => {
    runAllModelsHealthCheck({ checkType: 'startup_ping' }).catch((e) =>
      console.warn('[ModelHealthService] Startup ping caught error:', e.message)
    );
  }, 30 * 1000);

  // Set recurring 1-hour interval
  schedulerInterval = setInterval(() => {
    console.log('⏰ [ModelHealthService] 1-Hour cron timer triggered.');
    runAllModelsHealthCheck({ checkType: 'hourly_cron' }).catch((e) =>
      console.error('[ModelHealthService] Hourly cron caught error:', e.message)
    );
  }, ONE_HOUR_MS);

  return schedulerInterval;
}

export function getLastHourlyCheckTime() {
  return lastHourlyCheckTime;
}

export default {
  checkSingleModelHealth,
  runAllModelsHealthCheck,
  startHourlyHealthScheduler,
  getLastHourlyCheckTime,
};
