import { getDb } from '../db/drizzle.js';
import { subscriptions, payments } from '../models/billing.js';
import { users } from '../models/user.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import {
  AVAILABLE_PLANS,
  createCheckoutSession,
  createCustomerPortalSession,
  verifyStripeWebhookSignature,
} from '../services/stripeService.js';
import { getUserSubscriptionStatus } from '../middleware/subscriptionMiddleware.js';

/**
 * Get current user's subscription status, active plan, payment due, and available plans
 */
export const getBillingStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    // Clean up any old simulated payments so the user's trial is clean and real payments only
    await db.delete(payments).where(and(eq(payments.user_id, userId), sql`${payments.stripe_payment_intent_id} LIKE 'pi_sim_%'`)).catch(() => {});

    // Clean up simulated subscription customer ID if any so it doesn't masquerade as paid
    const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.user_id, userId)).limit(1);
    if (existingSub) {
      const isSimulated = !existingSub.stripe_customer_id || existingSub.stripe_customer_id.startsWith('cus_sim_');
      if (isSimulated) {
        const now = new Date();
        const needsFreshTrial = !existingSub.trial_ends_at || (new Date(existingSub.trial_ends_at) < now && existingSub.status !== 'inactive');
        const trialEnd = needsFreshTrial
          ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
          : existingSub.trial_ends_at;

        await db.update(subscriptions).set({
          stripe_customer_id: null,
          stripe_subscription_id: null,
          status: existingSub.status === 'inactive' ? 'inactive' : 'trialing',
          amount: 0,
          plan_name: '7-Day Free Trial',
          trial_ends_at: trialEnd,
          updated_at: now,
        }).where(eq(subscriptions.id, existingSub.id)).catch(() => {});
      }
    }

    const subStatus = await getUserSubscriptionStatus(userId);

    const isPastDue = Boolean(
      subStatus.subscription &&
      (subStatus.status === 'past_due' || (subStatus.subscription.current_period_end && new Date(subStatus.subscription.current_period_end) < new Date()))
    );

    return res.status(200).json({
      success: true,
      hasActiveSubscription: subStatus.hasActiveSubscription,
      isTrialActive: subStatus.isTrialActive,
      isTrialExpired: subStatus.isTrialExpired,
      isPaid: subStatus.isPaid,
      trialDaysRemaining: subStatus.trialDaysRemaining,
      trialEndsAt: subStatus.trialEndsAt,
      status: subStatus.status,
      subscription: subStatus.subscription,
      isPastDue,
      paymentDue: subStatus.subscription?.current_period_end || subStatus.trialEndsAt || null,
      plans: AVAILABLE_PLANS,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Fetch past payments and invoices for logged-in user
 */
export const getPaymentHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    // Clean up any dummy test payments
    await db.delete(payments).where(and(eq(payments.user_id, userId), sql`${payments.stripe_payment_intent_id} LIKE 'pi_sim_%'`)).catch(() => {});

    const paymentRecords = await db
      .select()
      .from(payments)
      .where(and(eq(payments.user_id, userId), sql`${payments.stripe_payment_intent_id} NOT LIKE 'pi_sim_%'`))
      .orderBy(desc(payments.created_at))
      .limit(50);

    return res.status(200).json({
      success: true,
      payments: paymentRecords,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Empty payments table for user
 */
export const clearAllPayments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    await db.delete(payments).where(eq(payments.user_id, userId));

    return res.status(200).json({
      success: true,
      message: 'Payment history deleted and table is now completely empty.',
      payments: [],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a Stripe Checkout Session
 */
export const createCheckout = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const { planId = 'pro' } = req.body;
    const plan = AVAILABLE_PLANS.find((p) => p.id === planId) || AVAILABLE_PLANS[1];

    const origin = req.headers.origin || req.get('referer') || 'http://localhost:3000';
    const cleanOrigin = origin.replace(/\/+$/, '');
    const successUrl = `${cleanOrigin}/dashboard?payment=success&plan=${plan.id}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${cleanOrigin}/dashboard?payment=cancelled`;

    const session = await createCheckoutSession({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      planId: plan.id,
      successUrl,
      cancelUrl,
    });

    return res.status(200).json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('[Stripe Checkout Error]:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to initialize Stripe checkout session.',
    });
  }
};

/**
 * Create a Stripe Customer Portal Session
 */
export const createPortal = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const db = getDb();
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.user_id, userId)).limit(1);

    if (!sub || !sub.stripe_customer_id) {
      return res.status(400).json({
        success: false,
        error: 'No active Stripe customer found. Please subscribe to a plan first.',
      });
    }

    const origin = req.headers.origin || 'http://localhost:3000';
    const returnUrl = `${origin.replace(/\/+$/, '')}/dashboard`;

    const portal = await createCustomerPortalSession({
      customerId: sub.stripe_customer_id,
      returnUrl,
    });

    return res.status(200).json({
      success: true,
      url: portal.url,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Handle Stripe Webhook Events
 */
export const handleStripeWebhook = async (req, res) => {
  try {
    const sigHeader = req.headers['stripe-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    let event;
    try {
      event = verifyStripeWebhookSignature(rawBody, sigHeader);
    } catch (err) {
      console.warn('[Stripe Webhook Signature Verification Warning]:', err.message);
      // Fallback: If in development without webhook secret, accept payload for testing
      if (process.env.NODE_ENV === 'development' || !process.env.STRIPE_WEBHOOK_SECRET) {
        event = req.body;
      } else {
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
      }
    }

    const db = getDb();
    const eventType = event.type;
    const dataObject = event.data?.object || {};

    console.log(`[Stripe Webhook] Received event: ${eventType}`);

    switch (eventType) {
      case 'checkout.session.completed': {
        const userId = dataObject.client_reference_id || dataObject.metadata?.userId;
        const planId = dataObject.metadata?.planId || 'pro';
        const plan = AVAILABLE_PLANS.find((p) => p.id === planId) || AVAILABLE_PLANS[1];

        if (userId) {
          const now = new Date();
          const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

          // Check if subscription record already exists
          const [existingSub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.user_id, userId))
            .limit(1);

          if (existingSub) {
            await db
              .update(subscriptions)
              .set({
                stripe_customer_id: dataObject.customer || existingSub.stripe_customer_id,
                stripe_subscription_id: dataObject.subscription || existingSub.stripe_subscription_id,
                plan_id: plan.id,
                plan_name: plan.name,
                amount: dataObject.amount_total || plan.amount,
                currency: dataObject.currency || 'usd',
                status: 'active',
                current_period_start: now,
                current_period_end: periodEnd,
                updated_at: now,
              })
              .where(eq(subscriptions.id, existingSub.id));
          } else {
            await db.insert(subscriptions).values({
              user_id: userId,
              stripe_customer_id: dataObject.customer || null,
              stripe_subscription_id: dataObject.subscription || null,
              plan_id: plan.id,
              plan_name: plan.name,
              amount: dataObject.amount_total || plan.amount,
              currency: dataObject.currency || 'usd',
              interval: 'month',
              status: 'active',
              current_period_start: now,
              current_period_end: periodEnd,
            });
          }

          // Log payment transaction
          await db.insert(payments).values({
            user_id: userId,
            stripe_payment_intent_id: dataObject.payment_intent || dataObject.id,
            amount: dataObject.amount_total || plan.amount,
            currency: dataObject.currency || 'usd',
            status: 'paid',
            plan_id: plan.id,
            plan_name: plan.name,
            receipt_url: dataObject.hosted_invoice_url || null,
            paid_at: now,
          });

          console.log(`[Stripe Webhook] Successfully activated subscription for user ${userId} on plan "${plan.name}".`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const subId = dataObject.subscription;
        const customerId = dataObject.customer;

        if (subId || customerId) {
          const now = new Date();
          const periodEnd = dataObject.lines?.data?.[0]?.period?.end
            ? new Date(dataObject.lines.data[0].period.end * 1000)
            : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

          // Find subscription by stripe_subscription_id or stripe_customer_id
          const [foundSub] = await db
            .select()
            .from(subscriptions)
            .where(
              subId
                ? eq(subscriptions.stripe_subscription_id, subId)
                : eq(subscriptions.stripe_customer_id, customerId)
            )
            .limit(1);

          if (foundSub) {
            await db
              .update(subscriptions)
              .set({
                status: 'active',
                current_period_end: periodEnd,
                updated_at: now,
              })
              .where(eq(subscriptions.id, foundSub.id));

            // Log invoice payment
            await db.insert(payments).values({
              user_id: foundSub.user_id,
              stripe_payment_intent_id: dataObject.payment_intent || null,
              stripe_invoice_id: dataObject.id,
              amount: dataObject.amount_paid || foundSub.amount,
              currency: dataObject.currency || 'usd',
              status: 'paid',
              plan_id: foundSub.plan_id,
              plan_name: foundSub.plan_name,
              receipt_url: dataObject.hosted_invoice_url || null,
              invoice_pdf: dataObject.invoice_pdf || null,
              paid_at: now,
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const subId = dataObject.subscription;
        if (subId) {
          const [foundSub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.stripe_subscription_id, subId))
            .limit(1);

          if (foundSub) {
            await db
              .update(subscriptions)
              .set({ status: 'past_due', updated_at: new Date() })
              .where(eq(subscriptions.id, foundSub.id));

            await db.insert(payments).values({
              user_id: foundSub.user_id,
              stripe_invoice_id: dataObject.id,
              amount: dataObject.amount_due || foundSub.amount,
              currency: dataObject.currency || 'usd',
              status: 'failed',
              plan_id: foundSub.plan_id,
              plan_name: foundSub.plan_name,
              failure_reason: dataObject.last_finalization_error?.message || 'Invoice payment failed',
              paid_at: null,
            });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subId = dataObject.id;
        if (subId) {
          await db
            .update(subscriptions)
            .set({ status: 'canceled', updated_at: new Date() })
            .where(eq(subscriptions.stripe_subscription_id, subId));
        }
        break;
      }

      default:
        // Ignore unhandled event types gracefully
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Stripe Webhook Handler Error]:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Trial activation helper: grants 7-day free trial ($0.00) without fake paid receipts
 */
export const simulatePayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const db = getDb();
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 full days ahead

    // Clean up any simulated payments so no fake "PAID" receipts show up
    await db.delete(payments).where(and(eq(payments.user_id, userId), sql`${payments.stripe_payment_intent_id} LIKE 'pi_sim_%'`)).catch(() => {});

    const [existingSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.user_id, userId))
      .limit(1);

    let savedSub;
    if (existingSub) {
      const [updated] = await db
        .update(subscriptions)
        .set({
          plan_id: 'starter',
          plan_name: '7-Day Free Trial',
          amount: 0,
          currency: 'usd',
          interval: 'week',
          status: 'trialing',
          stripe_customer_id: null,
          stripe_subscription_id: null,
          trial_ends_at: trialEnd,
          updated_at: now,
        })
        .where(eq(subscriptions.id, existingSub.id))
        .returning();
      savedSub = updated;
    } else {
      const [created] = await db
        .insert(subscriptions)
        .values({
          user_id: userId,
          plan_id: 'starter',
          plan_name: '7-Day Free Trial',
          amount: 0,
          currency: 'usd',
          interval: 'week',
          status: 'trialing',
          trial_ends_at: trialEnd,
        })
        .returning();
      savedSub = created;
    }

    return res.status(200).json({
      success: true,
      message: `7-Day Free Trial activated ($0.00). Unipile email automation and custom chatbots are unlocked for 1 week.`,
      subscription: savedSub,
      trialEndsAt: trialEnd.toISOString(),
      isTrialActive: true,
      isPaid: false,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Developer helper: adjust trial between Active 7-day trial and Expired trial
 */
export const adjustTrial = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { action } = req.body; // 'reset' (7 days remaining) or 'expire' (trial expired)
    const db = getDb();
    const now = new Date();

    const targetTrialEnd =
      action === 'expire'
        ? new Date(now.getTime() - 24 * 60 * 60 * 1000) // Expired yesterday
        : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days ahead

    const [existingSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.user_id, userId))
      .limit(1);

    // Clear any simulated payments
    await db.delete(payments).where(and(eq(payments.user_id, userId), sql`${payments.stripe_payment_intent_id} LIKE 'pi_sim_%'`)).catch(() => {});

    if (existingSub) {
      await db
        .update(subscriptions)
        .set({
          status: action === 'expire' ? 'inactive' : 'trialing',
          stripe_customer_id: null,
          stripe_subscription_id: null,
          plan_id: 'starter',
          plan_name: '7-Day Free Trial',
          amount: 0,
          trial_ends_at: targetTrialEnd,
          updated_at: now,
        })
        .where(eq(subscriptions.id, existingSub.id));
    } else {
      await db.insert(subscriptions).values({
        user_id: userId,
        plan_id: 'starter',
        plan_name: '7-Day Free Trial',
        amount: 0,
        currency: 'usd',
        status: action === 'expire' ? 'inactive' : 'trialing',
        trial_ends_at: targetTrialEnd,
      });
    }

    const updatedStatus = await getUserSubscriptionStatus(userId);
    return res.status(200).json({
      success: true,
      message:
        action === 'expire'
          ? 'Trial expired (Day 8+ simulated). Chatbot & automation locked.'
          : 'Trial reset to 7 active days! All features unlocked.',
      ...updatedStatus,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getBillingStatus,
  getPaymentHistory,
  clearAllPayments,
  createCheckout,
  createPortal,
  handleStripeWebhook,
  simulatePayment,
  adjustTrial,
};
