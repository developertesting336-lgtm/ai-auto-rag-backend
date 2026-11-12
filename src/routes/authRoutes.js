import express from 'express';
import {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
} from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public authentication routes
router.post('/register', register);
router.post('/login', login);

// Protected routes (requires Bearer token)
router.get('/me', verifyToken, getMe);
router.put('/profile', verifyToken, updateProfile);
router.put('/change-password', verifyToken, changePassword);

export default router;
