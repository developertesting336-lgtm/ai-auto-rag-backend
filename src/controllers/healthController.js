import { getDb } from '../db/drizzle.js';
import { ai_models } from '../models/aiModel.js';
import { ai_model_health_logs } from '../models/healthLog.js';
import { user_notifications } from '../models/notification.js';
import { eq, desc, and } from 'drizzle-orm';
import {
  runAllModelsHealthCheck,
  checkSingleModelHealth,
  getLastHourlyCheckTime,
} from '../services/modelHealthService.js';

/**
 * Get comprehensive system & model health telemetry
 */
export const getHealthOverview = async (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    // 1. Fetch user's AI models
    const userModels = await db
      .select({
        id: ai_models.id,
        name: ai_models.name,
        provider: ai_models.provider,
        model_name: ai_models.model_name,
        key_hint: ai_models.key_hint,
        temperature: ai_models.temperature,
        is_active: ai_models.is_active,
        created_at: ai_models.created_at,
      })
      .from(ai_models)
      .where(eq(ai_models.user_id, userId))
      .orderBy(desc(ai_models.created_at));

    // 2. Fetch latest health check log for each model
    const modelsWithHealth = [];
    let healthyCount = 0;
    let failingCount = 0;

    for (const model of userModels) {
      const [latestLog] = await db
        .select()
        .from(ai_model_health_logs)
        .where(eq(ai_model_health_logs.model_id, model.id))
        .orderBy(desc(ai_model_health_logs.created_at))
        .limit(1);

      const status = latestLog ? latestLog.status : 'untested';
      if (status === 'healthy') healthyCount++;
      if (status === 'error') failingCount++;

      modelsWithHealth.push({
        ...model,
        health: {
          status: status, // 'healthy', 'error', 'untested'
          latency_ms: latestLog ? latestLog.latency_ms : null,
          error_message: latestLog ? latestLog.error_message : null,
          check_type: latestLog ? latestLog.check_type : null,
          last_checked: latestLog ? latestLog.created_at : null,
        },
      });
    }

    // 3. Fetch recent 20 logs for telemetry timeline
    const recentLogs = await db
      .select({
        id: ai_model_health_logs.id,
        model_id: ai_model_health_logs.model_id,
        status: ai_model_health_logs.status,
        latency_ms: ai_model_health_logs.latency_ms,
        error_message: ai_model_health_logs.error_message,
        check_type: ai_model_health_logs.check_type,
        created_at: ai_model_health_logs.created_at,
      })
      .from(ai_model_health_logs)
      .where(eq(ai_model_health_logs.user_id, userId))
      .orderBy(desc(ai_model_health_logs.created_at))
      .limit(20);

    // 4. Fetch unread notifications count
    const unreadNotifications = await db
      .select({ id: user_notifications.id })
      .from(user_notifications)
      .where(and(eq(user_notifications.user_id, userId), eq(user_notifications.is_read, false)));

    const overallStatus = failingCount > 0 ? 'degraded' : 'operational';
    const lastCheck = getLastHourlyCheckTime() || (recentLogs[0]?.created_at ?? null);

    return res.status(200).json({
      success: true,
      data: {
        overall_status: overallStatus,
        total_models: userModels.length,
        healthy_count: healthyCount,
        failing_count: failingCount,
        untested_count: userModels.length - healthyCount - failingCount,
        last_check_time: lastCheck,
        interval_hours: 1,
        models: modelsWithHealth,
        recent_logs: recentLogs,
        unread_alerts_count: unreadNotifications.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Manually trigger a fresh health check for all models belonging to current user
 */
export const runHealthCheckNow = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const outcome = await runAllModelsHealthCheck({
      checkType: 'manual_dashboard',
      userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Health check completed across your AI models.',
      outcome,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Run health check for a specific AI model
 */
export const checkSingleModel = async (req, res, next) => {
  try {
    const { modelId } = req.params;
    const db = getDb();

    const [model] = await db
      .select()
      .from(ai_models)
      .where(and(eq(ai_models.id, modelId), eq(ai_models.user_id, req.user.id)))
      .limit(1);

    if (!model) {
      return res.status(404).json({ success: false, error: 'AI Model not found.' });
    }

    const outcome = await checkSingleModelHealth(model);

    // Record in health logs
    const [log] = await db
      .insert(ai_model_health_logs)
      .values({
        model_id: model.id,
        user_id: req.user.id,
        status: outcome.status,
        latency_ms: outcome.latency_ms,
        error_message: outcome.error_message,
        check_type: 'single_test',
      })
      .returning();

    // If failed, create notification
    if (!outcome.success) {
      await db.insert(user_notifications).values({
        user_id: req.user.id,
        title: `⚠️ AI Model Alert: ${model.name}`,
        message: `Health check error for "${model.name}": ${outcome.error_message}`,
        type: 'health_alert',
        severity: 'critical',
        data: {
          model_id: model.id,
          model_name: model.name,
          error: outcome.error_message,
        },
      });
    }

    return res.status(200).json({
      success: true,
      model_id: model.id,
      outcome,
      log_id: log?.id,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get notifications for the authenticated user
 */
export const getNotifications = async (req, res, next) => {
  try {
    const db = getDb();
    const notifications = await db
      .select()
      .from(user_notifications)
      .where(eq(user_notifications.user_id, req.user.id))
      .orderBy(desc(user_notifications.created_at))
      .limit(50);

    return res.status(200).json({
      success: true,
      notifications,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Mark notifications as read
 */
export const markNotificationsAsRead = async (req, res, next) => {
  try {
    const db = getDb();
    const { id } = req.body;

    if (id) {
      await db
        .update(user_notifications)
        .set({ is_read: true })
        .where(and(eq(user_notifications.id, id), eq(user_notifications.user_id, req.user.id)));
    } else {
      await db
        .update(user_notifications)
        .set({ is_read: true })
        .where(eq(user_notifications.user_id, req.user.id));
    }

    return res.status(200).json({
      success: true,
      message: 'Notifications marked as read.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Send a test push notification / alert
 */
export const sendTestNotification = async (req, res, next) => {
  try {
    const db = getDb();
    const [created] = await db
      .insert(user_notifications)
      .values({
        user_id: req.user.id,
        title: '🔔 Push Notification Test',
        message: 'Push notification system active! You will be alerted whenever an AI model health check fails.',
        type: 'info',
        severity: 'info',
        data: { test: true, sent_at: new Date().toISOString() },
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: 'Test notification created.',
      notification: created,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getHealthOverview,
  runHealthCheckNow,
  checkSingleModel,
  getNotifications,
  markNotificationsAsRead,
  sendTestNotification,
};
