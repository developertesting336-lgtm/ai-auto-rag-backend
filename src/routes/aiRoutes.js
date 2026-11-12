import express from 'express';
import { generateText } from '../controllers/aiController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.post('/generate', generateText);

export default router;
