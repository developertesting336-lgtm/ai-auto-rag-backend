import express from 'express';
import {
  getMyCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  uploadPolicy,
  getPolicies,
  deletePolicy,
} from '../controllers/companyController.js';
import { regenerateCompanyKey } from '../controllers/chatbotController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { requireSubscription } from '../middleware/subscriptionMiddleware.js';

let upload = { single: () => (req, res, next) => next() };

try {
  const multerMod = await import('multer');
  const multer = multerMod.default || multerMod;
  const storage = multer.memoryStorage();
  upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });
} catch (err) {
  console.warn('[Multer] Multer not initialized yet. Run npm install in backend.');
}

const router = express.Router();

router.use(verifyToken);

router.get('/my', getMyCompany);
router.post('/', createCompany);
router.put('/:id', updateCompany);
router.delete('/:id', deleteCompany);
router.post('/regenerate-key', requireSubscription, regenerateCompanyKey);

// Policies (Handles both multipart file upload and JSON) - requires paid plan to index into Pinecone
router.post('/policies', requireSubscription, upload.single('file'), uploadPolicy);
router.get('/:company_id/policies', getPolicies);
router.delete('/policies/:id', deletePolicy);

export default router;
