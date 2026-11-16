import express from 'express';
import {
  getUnipileSettings,
  saveUnipileSettings,
  saveEmailPrompt,
  handleWebhook,
  getInboundEmails,
  getInboundEmailById,
  simulateInboundEmail,
} from '../controllers/emailController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { requireSubscription } from '../middleware/subscriptionMiddleware.js';

const router = express.Router();

// Public webhook endpoints for Unipile inbound events
// 1. Dedicated user endpoint (O(1) multi-tenant identification)
router.post('/webhook/:token', handleWebhook);
// 2. Generic endpoint (Account ID matching from payload)
router.post('/webhook', handleWebhook);

// Protected routes for managing Unipile credentials & viewing received emails
router.use(verifyToken);
router.get('/settings', getUnipileSettings);
router.post('/settings', requireSubscription, saveUnipileSettings);
router.put('/prompt', requireSubscription, saveEmailPrompt);
router.post('/prompt', requireSubscription, saveEmailPrompt);
router.get('/inbound', getInboundEmails);
router.get('/inbound/:id', getInboundEmailById);
router.post('/simulate', requireSubscription, simulateInboundEmail);

export default router;

