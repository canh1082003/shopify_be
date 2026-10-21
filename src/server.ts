import app from './app';
import { config } from './config';
import { monitorService } from './services/monitor.service';
import { repository } from './db/repository';

import { connectMongo } from './db/mongo';

const PORT = config.port;

let monitoringTimer: NodeJS.Timeout | null = null;

// Start server
const server = app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🛡️  ORDER WATCHDOG — SHOPIFY SAAS BACKEND`);
  console.log(`   "Never Miss an Overdue Order Again"`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📊 Dashboard API: http://localhost:${PORT}/api/dashboard/summary`);
  console.log(`📦 Orders API: http://localhost:${PORT}/api/orders`);
  console.log(`🚨 Alerts API: http://localhost:${PORT}/api/alerts`);
  console.log(`⚙️  Settings API: http://localhost:${PORT}/api/settings`);
  console.log(`🌐 Shopify Integration: http://localhost:${PORT}/api/integrations/shopify/status`);
  console.log(`🌐 Allowed Client: ${config.clientOrigin}`);
  console.log(`======================================================\n`);

  // Connect to MongoDB Atlas if MONGODB_URI is provided
  try {
    const mongoConnected = await connectMongo();
    if (mongoConnected) {
      await repository.syncWithMongo();
    }
  } catch (err) {
    console.error('[MongoDB] Initialization error:', err);
  }

  // Initial evaluation pass
  try {
    const primaryShop = await repository.getPrimaryShop();
    const result = await monitorService.evaluateShopOrders(primaryShop.id);
    console.log(
      `[Monitor Engine] Initial pass complete: evaluated ${result.evaluatedCount} orders, detected ${result.newOverdueCount} overdue.`
    );
  } catch (err) {
    console.error('[Monitor Engine] Initial pass failed:', err);
  }

  // Start background monitoring scheduler
  monitoringTimer = setInterval(async () => {
    try {
      const primaryShop = await repository.getPrimaryShop();
      await monitorService.evaluateShopOrders(primaryShop.id);
    } catch (err) {
      console.error('[Monitor Engine] Periodic pass error:', err);
    }
  }, config.monitoring.intervalMs);
});

// Graceful shutdown
const handleShutdown = (signal: string) => {
  console.log(`\n[${signal}] Received. Shutting down gracefully...`);
  if (monitoringTimer) {
    clearInterval(monitoringTimer);
  }
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after 10s.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
