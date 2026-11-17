import express from 'express';
import {
  getBillingStatus,
  getPaymentHistory,
  createCheckout,
  createPortal,
  handleStripeWebhook,
  simulatePayment,
  adjustTrial,
} from '../controllers/billingController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Stripe Webhook Endpoint (Must be public, verified via Stripe signature)
router.post('/webhook', handleStripeWebhook);

// Protected routes (Require logged in user)
router.use(verifyToken);
router.get('/status', getBillingStatus);
router.get('/history', getPaymentHistory);
router.post('/create-checkout-session', createCheckout);
router.post('/create-portal-session', createPortal);
router.post('/simulate-payment', simulatePayment);
router.post('/adjust-trial', adjustTrial);

export default router;
