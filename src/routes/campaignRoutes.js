import express from 'express';
import {
  getCampaigns,
  createCampaign,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  handleCampaignWebhook,
  simulateCampaignTrigger,
  getCampaignLogs,
} from '../controllers/campaignController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Webhook receiver for Unipile events (multi-tenant routed by :token)
router.post('/webhook/:token', handleCampaignWebhook);
router.all('/webhook', handleCampaignWebhook);

// Protected routes (dashboard user actions)
router.get('/', verifyToken, getCampaigns);
router.post('/', verifyToken, createCampaign);
router.get('/:id', verifyToken, getCampaignById);
router.put('/:id', verifyToken, updateCampaign);
router.delete('/:id', verifyToken, deleteCampaign);
router.post('/:id/simulate', verifyToken, simulateCampaignTrigger);
router.get('/:id/logs', verifyToken, getCampaignLogs);

export default router;
