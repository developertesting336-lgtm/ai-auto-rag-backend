import express from 'express';
import { saveKey, getKeys, deleteKey } from '../controllers/apiKeyController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.post('/', saveKey);
router.get('/', getKeys);
router.delete('/:id', deleteKey);

export default router;
