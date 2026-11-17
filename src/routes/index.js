import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import apiKeyRoutes from './apiKeyRoutes.js';
import aiModelRoutes from './aiModelRoutes.js';
import aiRoutes from './aiRoutes.js';
import companyRoutes from './companyRoutes.js';
import emailRoutes from './emailRoutes.js';
import campaignRoutes from './campaignRoutes.js';
import chatbotRoutes from './chatbotRoutes.js';
import billingRoutes from './billingRoutes.js';

const router = express.Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/ai-models', aiModelRoutes);
router.use('/ai', aiRoutes);
router.use('/companies', companyRoutes);
router.use('/email', emailRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/chatbot', chatbotRoutes);
router.use('/billing', billingRoutes);

export default router;
