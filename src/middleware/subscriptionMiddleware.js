import { getDb } from '../db/drizzle.js';
import { subscriptions } from '../models/billing.js';
import { eq } from 'drizzle-orm';

/**
 * Checks whether the given user has an active, valid paid subscription
 */
export async function getUserSubscriptionStatus(userId) {
  if (!userId) {
    return { hasActiveSubscription: false, status: 'unpaid', subscription: null };
  }

  const db = getDb();
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.user_id, userId))
    .limit(1);

  if (!sub) {
    return { hasActiveSubscription: false, status: 'unpaid', subscription: null };
  }

  const isExpired = sub.current_period_end && new Date(sub.current_period_end) < new Date();
  const isActive = (sub.status === 'active' || sub.status === 'trialing') && !isExpired;

  return {
    hasActiveSubscription: Boolean(isActive),
    status: isExpired ? 'past_due' : sub.status,
    subscription: sub,
  };
}

/**
 * Express middleware to gate protected features until payment/subscription is active
 */
export async function requireSubscription(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required.' });
    }

    const { hasActiveSubscription, status, subscription } = await getUserSubscriptionStatus(req.user.id);

    if (!hasActiveSubscription) {
      return res.status(402).json({
        success: false,
        error: 'Payment Required: An active paid plan is required to add Unipile email automation, custom chatbots, and vector knowledge bases.',
        code: 'SUBSCRIPTION_REQUIRED',
        status,
        subscription,
      });
    }

    req.subscription = subscription;
    next();
  } catch (err) {
    console.error('[Subscription Middleware Error]:', err);
    next(err);
  }
}

export default {
  getUserSubscriptionStatus,
  requireSubscription,
};
