import express from 'express';
import {
  getAiModels,
  createAiModel,
  updateAiModel,
  deleteAiModel,
  testAiModel,
} from '../controllers/aiModelController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.get('/', getAiModels);
router.post('/', createAiModel);
router.put('/:id', updateAiModel);
router.delete('/:id', deleteAiModel);
router.post('/:id/test', testAiModel);

export default router;
