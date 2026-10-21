import crypto from 'crypto';
import { config } from '../config';

export interface JwtPayload {
  shopId: string;
  shopDomain: string;
  role?: string;
  iat?: number;
  exp?: number;
}

/**
 * Base64URL encoding according to RFC 7515 / RFC 7519
 */
function base64UrlEncode(strOrBuffer: string | Buffer): string {
  const buf = typeof strOrBuffer === 'string' ? Buffer.from(strOrBuffer, 'utf8') : strOrBuffer;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64URL decoding
 */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Generate a cryptographically signed HMAC-SHA256 JWT Token
 */
export function generateToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  expiresInSeconds = config.jwtExpiresInSeconds
): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const message = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(message)
    .digest();

  const encodedSignature = base64UrlEncode(signature);
  return `${message}.${encodedSignature}`;
}

/**
 * Verify and decode an HMAC-SHA256 JWT Token
 */
export function verifyToken(token: string): JwtPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('No token provided');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT token structure');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const message = `${encodedHeader}.${encodedPayload}`;

  // 1. Verify Signature
  const expectedSignature = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(message)
    .digest();

  const providedSignature = Buffer.from(
    encodedSignature.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  );

  if (
    providedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error('Invalid token signature');
  }

  // 2. Decode Payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw new Error('Invalid token payload encoding');
  }

  // 3. Verify Expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token has expired');
  }

  return payload;
}
