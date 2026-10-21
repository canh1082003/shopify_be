import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import {
  connectDatabase,
  disconnectDatabase,
  Shop as ShopModel,
  ShopifySession as SessionModel,
  Order as OrderModel,
  Alert as AlertModel,
  Settings as SettingsModel,
  NotificationLog as NotificationLogModel,
} from '../databases';
import { repository } from '../db/repository';

async function initDatabase() {
  console.log('📡 Connecting to MongoDB Atlas via connectDatabase()...');

  try {
    const connected = await connectDatabase();
    if (!connected) {
      console.error('❌ No valid MongoDB URI found or connection failed');
      process.exit(1);
    }
    console.log('✅ Connected to MongoDB Atlas successfully!');

    // Initialize collections and create indexes
    console.log('🛠️ Creating collections and performance indexes...');
    await ShopModel.createIndexes();
    await SessionModel.createIndexes();
    await OrderModel.createIndexes();
    await AlertModel.createIndexes();
    await SettingsModel.createIndexes();
    await NotificationLogModel.createIndexes();

    console.log('📦 Seeding initial data (Shops, Orders, Alerts, Settings, Logs)...');
    await repository.syncWithMongo();

    const counts = {
      shops: await ShopModel.countDocuments(),
      sessions: await SessionModel.countDocuments(),
      orders: await OrderModel.countDocuments(),
      alerts: await AlertModel.countDocuments(),
      settings: await SettingsModel.countDocuments(),
      notification_logs: await NotificationLogModel.countDocuments(),
    };

    console.log('\n======================================================');
    console.log('🎉 TẠO DATABASE VÀ COLLECTIONS MONGODB THÀNH CÔNG!');
    console.log('======================================================');
    console.log(`📁 Database: shopify_order_watchdog`);
    console.log(`📋 Collections (Tables):`);
    console.log(`   - shops:             ${counts.shops} documents`);
    console.log(`   - shopify_sessions:  ${counts.sessions} documents`);
    console.log(`   - orders:            ${counts.orders} documents`);
    console.log(`   - alerts:            ${counts.alerts} documents`);
    console.log(`   - settings:          ${counts.settings} documents`);
    console.log(`   - notification_logs: ${counts.notification_logs} documents`);
    console.log('======================================================\n');

    await disconnectDatabase();
    console.log('🔒 Closed MongoDB connection.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to initialize MongoDB:', error);
    process.exit(1);
  }
}

initDatabase();
