import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'file:./order_watchdog.db',

  // Shopify App Store Credentials
  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY || '',
    apiSecret: process.env.SHOPIFY_API_SECRET || '',
    scopes: (process.env.SHOPIFY_SCOPES || 'read_orders,read_fulfillments,write_orders').split(','),
    appUrl: process.env.APP_URL || 'http://localhost:5000',
    apiVersion: '2025-01',
    isConfigured: Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET),
  },

  // Security & Encryption
  // Default 32-byte key for AES-256-GCM (overridden by env in production)
  encryptionKey:
    process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  jwtSecret:
    process.env.JWT_SECRET || 'order_watchdog_auth_secret_key_2026_production_grade_hmac',
  jwtExpiresInSeconds: parseInt(process.env.JWT_EXPIRES_IN_SECONDS || '86400', 10), // 24 hours

  // Email Notification Credentials
  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.NOTIFICATION_FROM_EMAIL || 'alerts@orderwatchdog.app',
    isConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
  },

  // Monitoring Service
  monitoring: {
    intervalMs: parseInt(process.env.MONITORING_INTERVAL_MS || '30000', 10), // Every 30s
    defaultThresholdHours: 24,
    defaultWarningLeadHours: 4,
  },
};
