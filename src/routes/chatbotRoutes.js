import express from 'express';
import {
  queryChatbot,
  getChatbotKeys,
  createChatbotKey,
  deleteChatbotKey,
  regenerateCompanyKey,
} from '../controllers/chatbotController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { requireSubscription } from '../middleware/subscriptionMiddleware.js';

const router = express.Router();

// Public endpoint for websites & chatbot widgets (authenticated via x-api-key)
router.post('/query', queryChatbot);

// Protected endpoints to manage Chatbot Client API Keys (Gated by subscription)
router.use(verifyToken);
router.get('/keys', getChatbotKeys);
router.post('/keys', requireSubscription, createChatbotKey);
router.delete('/keys/:id', deleteChatbotKey);
router.post('/regenerate-key', requireSubscription, regenerateCompanyKey);

export default router;

