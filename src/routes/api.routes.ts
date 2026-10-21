import { Router } from 'express';
import authRoutes from './auth.routes';
import healthRoutes from './health.routes';
import dashboardRoutes from './dashboard.routes';
import orderRoutes from './order.routes';
import alertRoutes from './alert.routes';
import settingsRoutes from './settings.routes';
import integrationRoutes from './integration.routes';
import notificationRoutes from './notification.routes';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// 1. Public Unauthenticated Endpoints
router.use('/auth', authRoutes);
router.use('/health', healthRoutes);

// 2. Protected Endpoints (Bearer JWT Token Required)
router.use('/dashboard', authenticateToken, dashboardRoutes);
router.use('/orders', authenticateToken, orderRoutes);
router.use('/alerts', authenticateToken, alertRoutes);
router.use('/settings', authenticateToken, settingsRoutes);
router.use('/notifications', authenticateToken, notificationRoutes);
router.use('/integrations', integrationRoutes); // Integration handles webhook HMAC & OAuth separately, sync is protected inside integration.routes

// API Root Index
router.get('/', (_req, res) => {
  res.json({
    name: 'Order Watchdog - Shopify SaaS API',
    version: '1.0.0',
    tagline: 'Never Miss an Overdue Order Again.',
    authentication: {
      type: 'Bearer JWT (HMAC-SHA256)',
      tokenEndpoint: '/api/auth/token',
      headerFormat: 'Authorization: Bearer <token>',
    },
    endpoints: {
      auth: '/api/auth/token',
      health: '/api/health',
      dashboardSummary: '/api/dashboard/summary',
      dashboardTrends: '/api/dashboard/trends',
      orders: '/api/orders',
      alerts: '/api/alerts',
      alertsSummary: '/api/alerts/summary',
      settings: '/api/settings',
      shopifyStatus: '/api/integrations/shopify/status',
      notificationsTest: '/api/notifications/test',
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
