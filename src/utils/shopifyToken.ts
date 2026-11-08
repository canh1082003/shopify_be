import crypto from 'crypto';
import { config } from '../config';

export interface ShopifySessionTokenPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti?: string;
  sid?: string;
  shopDomain: string;
}

/**
 * Base64URL decoding helper
 */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Verifies a Shopify App Bridge Session Token according to Shopify official specification:
 * - HMAC-SHA256 signature signed with SHOPIFY_API_SECRET
 * - Constant-time signature comparison
 * - Mandatory claims: iss, dest, aud, sub, exp, nbf, iat
 * - Audience strictly matches app client ID (SHOPIFY_API_KEY)
 * - Issuer matches ${dest}/admin
 * - Destination protocol is https and hostname is a valid myshopify domain
 * - Token lifespan conforms to Shopify limits (standard 60s, max 120s with clock skew)
 */
export function verifyShopifySessionToken(
  token: string,
  apiSecret = config.shopify.apiSecret,
  apiKey = config.shopify.apiKey
): ShopifySessionTokenPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing Shopify session token');
  }

  if (!apiSecret) {
    throw new Error('Shopify API secret is not configured on the server');
  }

  if (!apiKey) {
    throw new Error('Shopify API key is not configured on the server');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Shopify session token: expected 3 JWT segments');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const message = `${encodedHeader}.${encodedPayload}`;

  // 1. Verify Signature using constant-time comparison
  const expectedSignature = crypto
    .createHmac('sha256', apiSecret)
    .update(message)
    .digest();

  let providedSignature: Buffer;
  try {
    let base64Sig = encodedSignature.replace(/-/g, '+').replace(/_/g, '/');
    while (base64Sig.length % 4) {
      base64Sig += '=';
    }
    providedSignature = Buffer.from(base64Sig, 'base64');
  } catch {
    throw new Error('Failed to parse Shopify session token signature');
  }

  if (
    providedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error('Invalid Shopify session token signature');
  }

  // 2. Decode Header & verify algorithm
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
  } catch {
    throw new Error('Invalid Shopify session token header encoding');
  }

  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported token algorithm '${header.alg}', expected 'HS256'`);
  }

  // 3. Decode Payload
  let payload: any;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw new Error('Invalid Shopify session token payload encoding');
  }

  const now = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW_SECONDS = 10;

  // 4. Validate Timestamps (exp, nbf, iat)
  if (typeof payload.exp !== 'number') {
    throw new Error('Shopify session token missing exp claim');
  }
  if (now > payload.exp + CLOCK_SKEW_SECONDS) {
    throw new Error('Shopify session token has expired');
  }

  if (typeof payload.nbf !== 'number') {
    throw new Error('Shopify session token missing nbf claim');
  }
  if (now < payload.nbf - CLOCK_SKEW_SECONDS) {
    throw new Error('Shopify session token is not yet valid (nbf)');
  }

  if (typeof payload.iat !== 'number') {
    throw new Error('Shopify session token missing iat claim');
  }

  // Shopify Session Tokens have a 60-second lifespan. Disallow abnormally long-lived tokens (> 120s)
  if (payload.exp - payload.iat > 120) {
    throw new Error('Shopify session token lifespan exceeds allowable limit (max 120s)');
  }

  // 5. Validate Audience (aud) - Strictly mandatory
  if (!payload.aud || payload.aud !== apiKey) {
    throw new Error(`Invalid token audience: expected '${apiKey}'`);
  }

  // 6. Validate Subject (sub) - User ID
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Shopify session token missing sub claim');
  }

  // 7. Validate Destination (dest) - Must be HTTPS myshopify domain
  if (!payload.dest || typeof payload.dest !== 'string') {
    throw new Error('Shopify session token missing dest claim');
  }

  let destUrl: URL;
  try {
    destUrl = new URL(payload.dest);
  } catch {
    throw new Error('Invalid dest URL format in Shopify session token');
  }

  if (destUrl.protocol !== 'https:') {
    throw new Error(`Invalid dest protocol '${destUrl.protocol}', expected 'https:'`);
  }

  const shopDomain = destUrl.hostname.toLowerCase();
  const shopifyDomainRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
  if (!shopifyDomainRegex.test(shopDomain)) {
    throw new Error(`Invalid shop domain in dest claim: '${shopDomain}'`);
  }

  // 8. Validate Issuer (iss) - Must strictly equal ${dest}/admin
  if (!payload.iss || typeof payload.iss !== 'string') {
    throw new Error('Shopify session token missing iss claim');
  }

  const expectedIss = `${payload.dest.replace(/\/$/, '')}/admin`;
  if (payload.iss.replace(/\/$/, '') !== expectedIss) {
    throw new Error(`Invalid issuer '${payload.iss}', expected '${expectedIss}'`);
  }

  return {
    iss: payload.iss,
    dest: payload.dest,
    aud: payload.aud,
    sub: String(payload.sub),
    exp: payload.exp,
    nbf: payload.nbf,
    iat: payload.iat,
    jti: payload.jti,
    sid: payload.sid,
    shopDomain,
  };
}
