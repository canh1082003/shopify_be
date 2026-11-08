import './bootstrap';
import crypto from 'crypto';
import { config } from '../config';
import { setTestDatabaseIsolation } from '../databases';
import { repository } from '../db/repository';

/**
 * Initializes and enforces complete test isolation:
 * 1. Sets environment flags preventing disk persistence and production database access.
 * 2. Explicitly blocks MongoDB connection attempts.
 * 3. Switches the singleton repository and any new instances to in-memory only mode.
 */
export function setupIsolatedTestEnvironment(): void {
  process.env.STOCKPILOT_TEST_ENV = 'true';
  process.env.STOCKPILOT_ISOLATE_STORAGE = 'true';
  process.env.NODE_ENV = 'test';
  setTestDatabaseIsolation(true);
  repository.enableTestIsolation();
}

// Automatically enforce isolation whenever test utilities are imported
setupIsolatedTestEnvironment();

/**
 * Base64URL encoding helper strictly for test utilities
 */
function base64UrlEncode(strOrBuffer: string | Buffer): string {
  const buf = typeof strOrBuffer === 'string' ? Buffer.from(strOrBuffer, 'utf8') : strOrBuffer;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export interface TestShopifyTokenOptions {
  shopDomain?: string;
  apiKey?: string;
  apiSecret?: string;
  userId?: string;
  expiresInSeconds?: number;
  nbfOffsetSeconds?: number;
  customClaims?: Record<string, any>;
  tamperSignature?: boolean;
}

/**
 * Generates a signed Shopify App Bridge Session Token for testing purposes ONLY.
 * Uses the Shopify Session Token JWT specification (HS256 with SHOPIFY_API_SECRET).
 */
export function generateTestShopifySessionToken(options: TestShopifyTokenOptions = {}): string {
  const shopDomain = options.shopDomain || 'conganh-test-lab.myshopify.com';
  const apiKey = options.apiKey !== undefined ? options.apiKey : config.shopify.apiKey;
  const apiSecret = options.apiSecret !== undefined ? options.apiSecret : config.shopify.apiSecret;
  const userId = options.userId || '12345678';
  const expiresInSeconds = options.expiresInSeconds !== undefined ? options.expiresInSeconds : 60; // 60s standard
  const nbfOffsetSeconds = options.nbfOffsetSeconds !== undefined ? options.nbfOffsetSeconds : 0;

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const dest = `https://${shopDomain}`;
  const iss = `${dest}/admin`;

  const payload: Record<string, any> = {
    iss,
    dest,
    aud: apiKey,
    sub: userId,
    exp: now + expiresInSeconds,
    nbf: now + nbfOffsetSeconds,
    iat: now,
    jti: `jti-${crypto.randomBytes(8).toString('hex')}`,
    sid: `sid-${crypto.randomBytes(8).toString('hex')}`,
    ...(options.customClaims || {}),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const message = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(message)
    .digest();

  let encodedSignature = base64UrlEncode(signature);
  if (options.tamperSignature) {
    // Modify the first character of the signature to ensure byte-level corruption
    const firstChar = encodedSignature[0];
    const replacement = firstChar === 'a' ? 'b' : 'a';
    encodedSignature = replacement + encodedSignature.slice(1);
  }

  return `${message}.${encodedSignature}`;
}

