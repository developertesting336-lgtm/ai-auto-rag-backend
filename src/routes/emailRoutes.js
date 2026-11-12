import express from 'express';
import {
  getUnipileSettings,
  saveUnipileSettings,
  handleWebhook,
} from '../controllers/emailController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public webhook endpoint for Unipile inbound events
router.post('/webhook', handleWebhook);

// Protected routes for managing Unipile credentials
router.use(verifyToken);
router.get('/settings', getUnipileSettings);
router.post('/settings', saveUnipileSettings);

export default router;

