import crypto from 'crypto';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

/**
 * Standard Subscription Plans Configuration
 */
export const AVAILABLE_PLANS = [
  {
    id: 'starter',
    name: 'Starter Plan',
    price: 19,
    amount: 1900, // cents
    currency: 'usd',
    interval: 'month',
    description: 'Perfect for solo founders launching their first automated customer chatbot.',
    features: [
      '1 Company profile',
      'Up to 10 Policy Documents in Pinecone DB',
      'Website Chatbot 1-Line Embed Script',
      'Dedicated Unipile Webhook Listener',
      'Basic Inbound Email Ingest',
      'Standard Gemini 1.5 Flash Model',
    ],
    popular: false,
  },
  {
    id: 'pro',
    name: 'Pro Automation',
    price: 49,
    amount: 4900, // cents
    currency: 'usd',
    interval: 'month',
    description: 'For growing teams requiring robust email automation and multi-company chatbots.',
    features: [
      'Unlimited Company Profiles',
      'Unlimited PDF Knowledge Base Vector Storage',
      'Custom Multi-Tenant Chatbot API Keys',
      'AI Email Auto-Responder with Rule Engine',
      'Live Unipile API Synchronization & Viewer',
      'High-Speed Gemini 2.0 Flash Inference',
      'Priority Email Support',
    ],
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise Scale',
    price: 99,
    amount: 9900, // cents
    currency: 'usd',
    interval: 'month',
    description: 'High throughput, guaranteed SLAs, and dedicated webhook processing pipelines.',
    features: [
      'Everything in Pro, without usage caps',
      'Dedicated Webhook Concurrency & Resilient Retries',
      'Multi-Model Fallbacks & Custom Timeout Logic',
      '99.9% Uptime SLA Guarantee',
      'Custom Knowledge Base Partitioning',
      '24/7 Dedicated Support',
    ],
    popular: false,
  },
];

/**
 * Helper to encode nested objects into Stripe's application/x-www-form-urlencoded syntax
 */
function serializeStripeParams(obj, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(serializeStripeParams(value, paramKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object') {
          parts.push(serializeStripeParams(item, `${paramKey}[${index}]`));
        } else {
          parts.push(`${encodeURIComponent(`${paramKey}[${index}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(paramKey)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

/**
 * Native REST call to Stripe API without external npm dependency
 */
async function stripeRequest(endpoint, method = 'POST', bodyParams = null) {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured in backend .env.');
  }

  const url = `https://api.stripe.com/v1${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY.trim()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
  };

  if (bodyParams && (method === 'POST' || method === 'PUT')) {
    options.body = typeof bodyParams === 'string' ? bodyParams : serializeStripeParams(bodyParams);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data?.error?.message || `Stripe API error (${response.status})`;
    const err = new Error(errorMsg);
    err.stripeData = data?.error;
    err.status = response.status;
    throw err;
  }

  return data;
}

/**
 * Create a Stripe Checkout Session for subscription plans
 */
export async function createCheckoutSession({
  userId,
  userEmail,
  userName,
  planId,
  successUrl,
  cancelUrl,
}) {
  const plan = AVAILABLE_PLANS.find((p) => p.id === planId) || AVAILABLE_PLANS[1]; // default to Pro

  const params = {
    mode: 'subscription',
    client_reference_id: userId,
    customer_email: userEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        price_data: {
          currency: plan.currency,
          unit_amount: plan.amount,
          recurring: {
            interval: plan.interval,
          },
          product_data: {
            name: `${plan.name} - AI Automation SaaS`,
            description: plan.description,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      userId,
      planId: plan.id,
      planName: plan.name,
      userEmail,
    },
    subscription_data: {
      metadata: {
        userId,
        planId: plan.id,
      },
    },
  };

  return await stripeRequest('/checkout/sessions', 'POST', params);
}

/**
 * Create a Stripe Customer Portal session so user can manage payment methods / cancel
 */
export async function createCustomerPortalSession({ customerId, returnUrl }) {
  return await stripeRequest('/billing_portal/sessions', 'POST', {
    customer: customerId,
    return_url: returnUrl,
  });
}

/**
 * Retrieve a Subscription object from Stripe
 */
export async function getStripeSubscription(subscriptionId) {
  return await stripeRequest(`/subscriptions/${subscriptionId}`, 'GET');
}

/**
 * Verify Stripe Webhook Signature via HMAC-SHA256
 */
export function verifyStripeWebhookSignature(rawBody, signatureHeader, secret = STRIPE_WEBHOOK_SECRET) {
  if (!signatureHeader) {
    throw new Error('Missing stripe-signature header.');
  }
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured in backend .env.');
  }

  // Parse t=... and v1=...
  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [key, val] = part.trim().split('=');
    if (key && val) acc[key] = val;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    throw new Error('Malformed stripe-signature header.');
  }

  // Reject signatures older than 10 minutes to prevent replay attacks
  const ageSeconds = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (ageSeconds > 600) {
    throw new Error('Stripe webhook signature has expired (timestamp too old).');
  }

  const payloadToSign = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');

  const bufExpected = Buffer.from(expectedSignature, 'utf8');
  const bufActual = Buffer.from(signature, 'utf8');

  if (bufExpected.length !== bufActual.length || !crypto.timingSafeEqual(bufExpected, bufActual)) {
    throw new Error('Invalid Stripe webhook signature.');
  }

  return JSON.parse(rawBody);
}

export default {
  AVAILABLE_PLANS,
  createCheckoutSession,
  createCustomerPortalSession,
  getStripeSubscription,
  verifyStripeWebhookSignature,
};
