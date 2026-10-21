import { Router } from 'express';
import { integrationController } from '../controllers/integration.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Protected endpoints
router.get('/shopify/status', authenticateToken, (req, res, next) =>
  integrationController.getStatus(req, res, next)
);
router.post('/shopify/sync', authenticateToken, (req, res, next) =>
  integrationController.triggerSync(req, res, next)
);

// Public Shopify Handshake & Webhooks
router.get('/shopify/auth', (req, res, next) =>
  integrationController.getAuthUrl(req, res, next)
);
router.get('/shopify/callback', (req, res, next) =>
  integrationController.handleOAuthCallback(req, res, next)
);
router.post('/shopify/webhooks', (req, res, next) =>
  integrationController.handleWebhook(req, res, next)
);

export default router;
