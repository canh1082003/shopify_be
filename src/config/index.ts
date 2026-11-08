import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Guarantee database credentials remain scrubbed in test isolation
if (process.env.STOCKPILOT_TEST_ENV === 'true' || process.env.NODE_ENV === 'test') {
  delete process.env.MONGODB_URL;
  delete process.env.mongodb_url;
  delete process.env.MONGODB_URI;
  delete process.env.DATABASE_URL;
}

export const DEFAULT_DEV_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const DEFAULT_DEV_JWT_SECRET =
  'stockpilot_auth_secret_key_2026_production_grade_hmac';
export const DEFAULT_JWT_EXPIRES_IN_SECONDS = 900; // 15 minutes default access token lifetime

/**
 * Validates that a configured expiration is a positive finite integer.
 */
export function parseJwtExpiresInSeconds(val: string | undefined): number {
  if (!val) return DEFAULT_JWT_EXPIRES_IN_SECONDS;
  const parsed = Number(val);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid configuration: JWT_EXPIRES_IN_SECONDS must be a positive integer, got '${val}'`);
  }
  return parsed;
}

/**
 * Validates that production environments fail closed if required secrets are missing,
 * too short (< 32 chars), or matching known development fallback keys.
 * Validates that ENCRYPTION_KEY is exactly 64 hexadecimal characters representing a 32-byte key for AES-256-GCM.
 * Never prints secret values in error messages.
 */
export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const isProd = env.NODE_ENV === 'production';
  if (!isProd) {
    return;
  }

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error('Production startup failed: JWT_SECRET environment variable is missing.');
  }
  if (jwtSecret === DEFAULT_DEV_JWT_SECRET || jwtSecret.length < 32) {
    throw new Error('Production startup failed: JWT_SECRET is unsafe or using default development secret.');
  }

  const encryptionKey = env.ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    throw new Error('Production startup failed: ENCRYPTION_KEY environment variable is missing.');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error('Production startup failed: ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).');
  }
  if (encryptionKey.toLowerCase() === DEFAULT_DEV_ENCRYPTION_KEY.toLowerCase()) {
    throw new Error('Production startup failed: ENCRYPTION_KEY is unsafe or using default development secret.');
  }

  if (env.JWT_EXPIRES_IN_SECONDS !== undefined) {
    parseJwtExpiresInSeconds(env.JWT_EXPIRES_IN_SECONDS);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'https://shopify-fe-chi.vercel.app',
  isProduction: process.env.NODE_ENV === 'production',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'file:./stockpilot.db',

  // Shopify App Store Credentials
  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_API_ID || '',
    apiSecret: process.env.SHOPIFY_API_SECRET || '',
    scopes: (process.env.SHOPIFY_SCOPES || 'read_products,read_inventory,read_orders,read_locations').split(','),
    appUrl: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://shopify-be-3jd9.onrender.com',
    appHandle: process.env.SHOPIFY_APP_HANDLE || 'stockpilot',
    apiVersion: '2025-01',
    isConfigured: Boolean(
      (process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_API_ID) && process.env.SHOPIFY_API_SECRET
    ),
  },

  // Security & Encryption
  // Default 32-byte key for AES-256-GCM (overridden by env in production)
  encryptionKey:
    process.env.ENCRYPTION_KEY || DEFAULT_DEV_ENCRYPTION_KEY,
  jwtSecret:
    process.env.JWT_SECRET || DEFAULT_DEV_JWT_SECRET,
  jwtExpiresInSeconds: parseJwtExpiresInSeconds(process.env.JWT_EXPIRES_IN_SECONDS),

  // Email Notification Credentials
  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.NOTIFICATION_FROM_EMAIL || 'alerts@stockpilot.io',
    isConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
  },

  // Monitoring Service
  monitoring: {
    intervalMs: parseInt(process.env.MONITORING_INTERVAL_MS || '30000', 10), // Every 30s
    defaultThresholdHours: 24,
    defaultWarningLeadHours: 4,
  },
};

// Automatically enforce in production when config module is loaded (outside isolated test suite)
if (process.env.NODE_ENV === 'production' && process.env.STOCKPILOT_TEST_ENV !== 'true') {
  validateProductionConfig(process.env);
}
