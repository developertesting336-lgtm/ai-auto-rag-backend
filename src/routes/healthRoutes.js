import express from 'express';
import {
  getHealthOverview,
  runHealthCheckNow,
  checkSingleModel,
  getNotifications,
  markNotificationsAsRead,
  sendTestNotification,
} from '../controllers/healthController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.get('/overview', getHealthOverview);
router.post('/run-check', runHealthCheckNow);
router.post('/check/:modelId', checkSingleModel);
router.get('/notifications', getNotifications);
router.post('/notifications/mark-read', markNotificationsAsRead);
router.post('/notifications/test', sendTestNotification);

export default router;
