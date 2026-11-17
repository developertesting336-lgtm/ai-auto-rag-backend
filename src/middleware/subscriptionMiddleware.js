import { getDb } from '../db/drizzle.js';
import { subscriptions } from '../models/billing.js';
import { users } from '../models/user.js';
import { eq } from 'drizzle-orm';

const TRIAL_DURATION_DAYS = 7;
const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Checks whether the given user has an active, valid paid subscription or is within their 1-week (7-day) free trial
 */
export async function getUserSubscriptionStatus(userId) {
  if (!userId) {
    return {
      hasActiveSubscription: false,
      isTrialActive: false,
      isTrialExpired: true,
      trialDaysRemaining: 0,
      trialEndsAt: null,
      isPaid: false,
      status: 'unpaid',
      subscription: null,
    };
  }

  const db = getDb();

  // 1. Fetch user to check registration date
  const [user] = await db
    .select({ id: users.id, created_at: users.created_at })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // 2. Fetch subscription if exists
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.user_id, userId))
    .limit(1);

  const now = new Date();

  // 3. Check for real active paid subscription (requires real Stripe customer/subscription and real payment)
  const isRealStripePaid =
    Boolean(sub && sub.status === 'active' && sub.stripe_customer_id && !sub.stripe_customer_id.startsWith('cus_sim_') && (sub.amount || 0) > 0);

  if (isRealStripePaid) {
    const isPeriodExpired = sub.current_period_end && new Date(sub.current_period_end) < now;
    if (!isPeriodExpired) {
      return {
        hasActiveSubscription: true,
        isTrialActive: false,
        isTrialExpired: false,
        isPaid: true,
        trialDaysRemaining: 0,
        trialEndsAt: null,
        status: 'active',
        subscription: sub,
      };
    }
  }

  // 4. Calculate 7-Day Free Trial Window
  let trialEndsAt;
  if (sub?.trial_ends_at) {
    trialEndsAt = new Date(sub.trial_ends_at);
  } else {
    // If account was created within the last 7 days, use created_at + 7 days
    const accountTrialTarget = user?.created_at ? new Date(new Date(user.created_at).getTime() + TRIAL_DURATION_MS) : null;
    if (accountTrialTarget && accountTrialTarget > now) {
      trialEndsAt = accountTrialTarget;
    } else {
      // Grant full 7 days from now for users entering the trial
      trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_MS);
    }

    // Persist this trial_ends_at so it remains pinned and accurate
    if (sub) {
      db.update(subscriptions)
        .set({ trial_ends_at: trialEndsAt, status: 'trialing', updated_at: now })
        .where(eq(subscriptions.id, sub.id))
        .catch(() => {});
    } else {
      db.insert(subscriptions)
        .values({
          user_id: userId,
          plan_id: 'starter',
          plan_name: '7-Day Free Trial',
          amount: 0,
          currency: 'usd',
          status: 'trialing',
          trial_ends_at: trialEndsAt,
        })
        .catch(() => {});
    }
  }

  const msRemaining = trialEndsAt.getTime() - now.getTime();
  const isTrialActive = msRemaining > 0;
  const trialDaysRemaining = isTrialActive ? Math.ceil(msRemaining / (24 * 60 * 60 * 1000)) : 0;

  if (isTrialActive) {
    return {
      hasActiveSubscription: true, // For 1 week user enjoys all services!
      isTrialActive: true,
      isTrialExpired: false,
      isPaid: false, // NO payment made! Pure trial
      trialDaysRemaining,
      trialEndsAt: trialEndsAt.toISOString(),
      status: 'trialing',
      subscription: sub || null,
    };
  }

  // 5. After 1 week: Trial has expired and user has not paid!
  return {
    hasActiveSubscription: false, // After 1 week, features are locked!
    isTrialActive: false,
    isTrialExpired: true,
    isPaid: false,
    trialDaysRemaining: 0,
    trialEndsAt: trialEndsAt.toISOString(),
    status: 'trial_expired',
    subscription: sub || null,
  };
}

/**
 * Express middleware to gate protected features until payment/subscription or 7-day trial is active
 */
export async function requireSubscription(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required.' });
    }

    const statusObj = await getUserSubscriptionStatus(req.user.id);

    if (!statusObj.hasActiveSubscription) {
      const isTrialExp = statusObj.isTrialExpired;
      return res.status(402).json({
        success: false,
        error: isTrialExp
          ? 'Free Trial Expired: Your 7-day free trial has ended. Please subscribe to a plan to continue using Unipile email automation, custom chatbots, and vector knowledge bases.'
          : 'Payment Required: An active paid plan is required to add Unipile email automation, custom chatbots, and vector knowledge bases.',
        code: isTrialExp ? 'TRIAL_EXPIRED' : 'SUBSCRIPTION_REQUIRED',
        status: statusObj.status,
        trialEndsAt: statusObj.trialEndsAt,
        isTrialExpired: statusObj.isTrialExpired,
        subscription: statusObj.subscription,
      });
    }

    req.subscription = statusObj.subscription;
    req.subscriptionStatus = statusObj;
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
