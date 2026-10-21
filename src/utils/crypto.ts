import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a plaintext string using AES-256-GCM
 */
export function encryptToken(plaintext: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const key = Buffer.from(config.encryptionKey, 'hex');
  const iv = crypto.randomBytes(12); // 96-bit IV standard for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

/**
 * Decrypt an AES-256-GCM encrypted string
 */
export function decryptToken(encrypted: string, ivHex: string, authTagHex: string): string {
  const key = Buffer.from(config.encryptionKey, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Verify Shopify Webhook HMAC-SHA256 signature
 */
export function verifyShopifyWebhookHmac(
  rawBody: string | Buffer,
  hmacHeader: string,
  secret: string
): boolean {
  if (!hmacHeader || !secret) return false;

  const generatedHmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  try {
    const generatedBuffer = Buffer.from(generatedHmac, 'utf8');
    const headerBuffer = Buffer.from(hmacHeader, 'utf8');

    if (generatedBuffer.length !== headerBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(generatedBuffer, headerBuffer);
  } catch {
    return false;
  }
}
