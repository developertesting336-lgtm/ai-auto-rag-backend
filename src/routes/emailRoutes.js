import express from 'express';
import {
  getUnipileSettings,
  saveUnipileSettings,
  saveEmailPrompt,
  handleWebhook,
  getInboundEmails,
} from '../controllers/emailController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public webhook endpoints for Unipile inbound events
// 1. Dedicated user endpoint (O(1) multi-tenant identification)
router.post('/webhook/:token', handleWebhook);
// 2. Generic endpoint (Account ID matching from payload)
router.post('/webhook', handleWebhook);

// Protected routes for managing Unipile credentials & viewing received emails
router.use(verifyToken);
router.get('/settings', getUnipileSettings);
router.post('/settings', saveUnipileSettings);
router.put('/prompt', saveEmailPrompt);
router.post('/prompt', saveEmailPrompt);
router.get('/inbound', getInboundEmails);

export default router;

