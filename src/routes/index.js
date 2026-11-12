import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import apiKeyRoutes from './apiKeyRoutes.js';
import aiRoutes from './aiRoutes.js';
import companyRoutes from './companyRoutes.js';
import emailRoutes from './emailRoutes.js';
import chatbotRoutes from './chatbotRoutes.js';

const router = express.Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/ai', aiRoutes);
router.use('/companies', companyRoutes);
router.use('/email', emailRoutes);
router.use('/chatbot', chatbotRoutes);

export default router;
