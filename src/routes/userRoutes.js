import express from 'express';
import {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  deactivateUser,
} from '../controllers/userController.js';

const router = express.Router();

// User CRUD endpoints
router.post('/', createUser);
router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.patch('/:id', updateUser);
router.delete('/:id', deleteUser);
router.patch('/:id/deactivate', deactivateUser);

export default router;
