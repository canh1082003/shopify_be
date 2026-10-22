import { Router } from 'express';
import authRoutes from './auth.routes';
import healthRoutes from './health.routes';
import dashboardRoutes from './dashboard.routes';
import inventoryRoutes from './inventory.routes';
import orderRoutes from './order.routes';
import alertRoutes from './alert.routes';
import analyticsRoutes from './analytics.routes';
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
router.use('/inventory', authenticateToken, inventoryRoutes);
router.use('/orders', authenticateToken, orderRoutes);
router.use('/alerts', authenticateToken, alertRoutes);
router.use('/analytics', authenticateToken, analyticsRoutes);
router.use('/settings', authenticateToken, settingsRoutes);
router.use('/notifications', authenticateToken, notificationRoutes);
router.use('/integrations', integrationRoutes);

// API Root Index
router.get('/', (_req, res) => {
  res.json({
    name: 'StockPilot — Shopify Inventory & Order Management API',
    tagline: 'Smarter Inventory. Better Decisions.',
    version: '1.0.0',
    authentication: {
      type: 'Bearer JWT (HMAC-SHA256)',
      tokenEndpoint: '/api/auth/token',
      headerFormat: 'Authorization: Bearer <token>',
    },
    endpoints: {
      auth: '/api/auth/token',
      health: '/api/health',
      dashboardSummary: '/api/dashboard/summary',
      dashboardSalesTrend: '/api/dashboard/sales-trend',
      inventory: '/api/inventory',
      orders: '/api/orders',
      alerts: '/api/alerts',
      alertsSummary: '/api/alerts/summary',
      analyticsSalesVelocity: '/api/analytics/sales-velocity',
      analyticsStockoutRisk: '/api/analytics/stockout-risk',
      analyticsRestock: '/api/analytics/restock',
      settings: '/api/settings',
      shopifyStatus: '/api/integrations/shopify/status',
      shopifySync: '/api/integrations/shopify/sync',
      notificationsTest: '/api/notifications/test',
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
