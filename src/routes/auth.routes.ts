import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Public token issuance
router.post('/token', (req, res, next) => authController.issueToken(req, res, next));
router.post('/login', (req, res, next) => authController.issueToken(req, res, next));

// Refresh token endpoint
router.post('/refresh', (req, res, next) => authController.refreshToken(req, res, next));

// Explicit token status check endpoint
router.get('/verify', (req, res, next) => authController.verifyTokenStatus(req, res, next));

// Protected current user profile
router.get('/me', authenticateToken, (req, res, next) => authController.getMe(req, res, next));

export default router;
