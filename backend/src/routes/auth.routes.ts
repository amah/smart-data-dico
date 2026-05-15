import { Router } from 'express';
import { getCurrentUser, login } from '../controllers/authController.js';
import { verifyToken } from '../middleware/jwtAuth.js';

const router: Router = Router();
router.post('/api/auth/login', login);
router.get('/api/auth/me', verifyToken, getCurrentUser);
export default router;
