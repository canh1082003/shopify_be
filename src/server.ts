import app from './app';
import { config } from './config';
import { monitorService } from './services/monitor.service';
import { repository } from './db/repository';
import { connectDatabase } from './databases';

const PORT = config.port;

let monitoringTimer: NodeJS.Timeout | null = null;

// Start server
const server = app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 STOCKPILOT — SHOPIFY INVENTORY & ORDER MANAGEMENT SAAS`);
  console.log(`   "Smarter Inventory. Better Decisions."`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📊 Dashboard API: http://localhost:${PORT}/api/dashboard/summary`);
  console.log(`📦 Inventory API: http://localhost:${PORT}/api/inventory`);
  console.log(`🛒 Orders API: http://localhost:${PORT}/api/orders`);
  console.log(`🚨 Stock Alerts API: http://localhost:${PORT}/api/alerts`);
  console.log(`📈 Analytics API: http://localhost:${PORT}/api/analytics/sales-velocity`);
  console.log(`⚙️  Settings API: http://localhost:${PORT}/api/settings`);
  console.log(`🌐 Shopify Integration: http://localhost:${PORT}/api/integrations/shopify/status`);
  console.log(`🌐 Allowed Client: ${config.clientOrigin}`);
  console.log(`======================================================\n`);

  // Connect to MongoDB Atlas (if configured)
  try {
    const isConnected = await connectDatabase();
    if (isConnected) {
      await repository.syncWithMongo();
    }
  } catch (err) {
    console.error('[Database] Initialization error:', err);
  }

  // Initial inventory & order evaluation pass
  try {
    const primaryShop = await repository.getPrimaryShop();
    await repository.recalculateStockLevels(primaryShop.id);
    const result = await monitorService.evaluateShopOrders(primaryShop.id);
    console.log(
      `[StockPilot Engine] Initial pass complete: evaluated ${result.evaluatedCount} orders, recalculated stock status & alerts.`
    );
  } catch (err) {
    console.error('[StockPilot Engine] Initial pass failed:', err);
  }

  // Start background periodic reconciliation scheduler
  monitoringTimer = setInterval(async () => {
    try {
      const primaryShop = await repository.getPrimaryShop();
      await repository.recalculateStockLevels(primaryShop.id);
      await monitorService.evaluateShopOrders(primaryShop.id);
    } catch (err) {
      console.error('[StockPilot Engine] Periodic pass error:', err);
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
