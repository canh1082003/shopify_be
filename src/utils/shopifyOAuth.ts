import crypto from 'crypto';
import { AppError } from '../middleware/error.middleware';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export const SHOP_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
export const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes maximum lifetime
export const STATE_CLOCK_SKEW_MS = 60 * 1000; // 1 minute future skew allowance
const HMAC_REGEX = /^[0-9a-f]{64}$/;

/**
 * SHA-256 helper
 */
export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Enforce strict validation and normalization on Shopify shop domain
 * - Must match /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/
 * - Reject protocols (http://, https://)
 * - Reject port numbers (:8080)
 * - Reject URL paths (/admin, /oauth)
 * - Reject query strings or fragments (?, #)
 * - Reject non-myshopify domains
 * - Reject invalid characters, whitespace, or empty strings
 * - Normalize to lowercase string
 */
export function validateAndNormalizeShopDomain(rawDomain: unknown): string {
  if (typeof rawDomain !== 'string') {
    throw new AppError(
      'Invalid shop parameter: domain must be a string',
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR
    );
  }

  const trimmed = rawDomain.trim();
  if (!trimmed) {
    throw new AppError(
      'Invalid shop parameter: domain cannot be empty',
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR
    );
  }

  // Reject protocol injection, ports, paths, queries, fragments, credentials, whitespace
  if (
    trimmed.includes('://') ||
    trimmed.includes('/') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes(':') ||
    trimmed.includes('@') ||
    /\s/.test(trimmed)
  ) {
    throw new AppError(
      'Invalid shop parameter: domain contains forbidden characters, protocol, or path',
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR
    );
  }

  const normalized = trimmed.toLowerCase();

  if (!SHOP_DOMAIN_REGEX.test(normalized)) {
    throw new AppError(
      'Invalid shop parameter: must be a valid myshopify.com domain',
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR
    );
  }

  return normalized;
}

/**
 * Cryptographic verification of Shopify OAuth query HMAC signature
 * 1. Requires valid 64-character lowercase hexadecimal SHA-256 HMAC
 * 2. Removes 'hmac' and 'signature' from parameter map
 * 3. Rejects duplicate / ambiguous parameters (arrays or objects - HTTP Parameter Pollution)
 * 4. Sorts keys lexicographically (A-Z)
 * 5. Formats as 'key=value' joined by '&'
 * 6. Computes HMAC-SHA256 hex string with SHOPIFY_API_SECRET
 * 7. Compares with timing-safe equality check
 */
export function verifyShopifyOAuthHmac(
  queryParams: Record<string, any>,
  apiSecret: string
): boolean {
  if (!apiSecret || typeof apiSecret !== 'string' || !apiSecret.trim()) {
    return false;
  }

  const hmac = queryParams.hmac;
  if (!hmac || typeof hmac !== 'string') {
    return false;
  }

  const trimmedHmac = hmac.trim().toLowerCase();
  // Enforce strict 64-hex SHA-256 format
  if (!HMAC_REGEX.test(trimmedHmac)) {
    return false;
  }

  // Reject duplicate array parameters (HTTP Parameter Pollution) or non-primitive values
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(queryParams)) {
    if (key === 'hmac' || key === 'signature') {
      continue;
    }
    if (Array.isArray(value) || typeof value !== 'string') {
      return false;
    }
    entries.push([key, value]);
  }

  // Lexicographical sort by parameter key (ascending A-Z)
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  // Build canonical Shopify query string: key=val joined by &
  const message = entries.map(([k, v]) => `${k}=${v}`).join('&');

  const computedHex = crypto
    .createHmac('sha256', apiSecret)
    .update(message)
    .digest('hex');

  const computedBuffer = Buffer.from(computedHex, 'utf8');
  const providedBuffer = Buffer.from(trimmedHmac, 'utf8');

  if (computedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuffer, providedBuffer);
}

export const OAUTH_COOKIE_PREFIX = '__Host-sp_oauth_';

export function getOAuthCookieName(nonce: string): string {
  return `${OAUTH_COOKIE_PREFIX}${nonce}`;
}

/**
 * Parse raw Cookie header string into key-value map
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * Build an RFC 6265bis __Host- prefixed, Path=/, HttpOnly, Secure, SameSite=Lax cookie header
 * - Name begins with __Host-
 * - Must include Secure flag
 * - Must not include Domain attribute (strictly host-only)
 * - Must specify Path=/
 * Distinct cookie name per transaction `__Host-sp_oauth_${nonce}` prevents concurrent OAuth flow collisions
 */
export function buildOAuthCookieHeader(
  nonce: string,
  browserNonce: string,
  maxAgeSeconds: number = 600
): string {
  const cookieName = getOAuthCookieName(nonce);
  return `${cookieName}=${encodeURIComponent(browserNonce)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/**
 * Build clear cookie header for __Host- prefixed cookie
 */
export function buildClearOAuthCookieHeader(nonce: string): string {
  const cookieName = getOAuthCookieName(nonce);
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export interface GeneratedOAuthState {
  state: string;
  nonce: string;
  browserNonce: string;
  stateHash: string;
  browserNonceHash: string;
  expiresAt: Date;
}

/**
 * Generate cryptographically signed, shop-bound CSRF state and browser binding nonces
 * Format: `${nonce}.${timestamp}.${signature}`
 */
export function generateOAuthState(shopDomain: string, apiSecret: string): GeneratedOAuthState {
  if (!apiSecret || !apiSecret.trim()) {
    throw new AppError(
      'Server configuration error: SHOPIFY_API_SECRET is missing',
      HttpStatus.INTERNAL_SERVER_ERROR,
      ErrorCode.AUTH_INVALID_TOKEN
    );
  }

  const normalizedShop = validateAndNormalizeShopDomain(shopDomain);
  const nonce = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  const browserNonce = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  const timestamp = Date.now().toString(10);
  const dataToSign = `${nonce}:${timestamp}:${normalizedShop}`;
  const sig = crypto
    .createHmac('sha256', apiSecret)
    .update(dataToSign)
    .digest('hex');

  const state = `${nonce}.${timestamp}.${sig}`;
  const stateHash = sha256(state);
  const browserNonceHash = sha256(browserNonce);
  const expiresAt = new Date(Date.now() + STATE_MAX_AGE_MS);

  return {
    state,
    nonce,
    browserNonce,
    stateHash,
    browserNonceHash,
    expiresAt,
  };
}

/**
 * Verify CSRF OAuth state token structure and HMAC signature
 * - Parses format: nonce.timestamp.sig
 * - Validates timestamp within 10-minute maximum age
 * - Checks clock skew tolerance (max 1 minute in future)
 * - Verifies cryptographic signature bound to the expected shop domain
 * - Returns { nonce, timestamp } on success or null on failure
 */
export function verifyOAuthStateFormat(
  state: unknown,
  expectedShop: string,
  apiSecret: string
): { nonce: string; timestamp: number } | null {
  if (typeof state !== 'string' || !state.trim()) {
    return null;
  }

  if (!apiSecret || !apiSecret.trim()) {
    return null;
  }

  let normalizedShop: string;
  try {
    normalizedShop = validateAndNormalizeShopDomain(expectedShop);
  } catch {
    return null;
  }

  const parts = state.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [nonce, timestampStr, providedSig] = parts;

  // Strict format validation
  if (!/^[0-9a-f]{32}$/.test(nonce)) {
    return null;
  }
  if (!/^\d+$/.test(timestampStr)) {
    return null;
  }
  if (!/^[0-9a-f]{64}$/.test(providedSig)) {
    return null;
  }

  const timestamp = parseInt(timestampStr, 10);
  const now = Date.now();

  // Expiration: maximum 10 minutes
  if (now - timestamp > STATE_MAX_AGE_MS) {
    return null;
  }

  // Future timestamp tolerance: max 1 minute
  if (timestamp > now + STATE_CLOCK_SKEW_MS) {
    return null;
  }

  // Cryptographic signature check bound to expectedShop
  const dataToSign = `${nonce}:${timestampStr}:${normalizedShop}`;
  const expectedSig = crypto
    .createHmac('sha256', apiSecret)
    .update(dataToSign)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSig, 'utf8');
  const providedBuffer = Buffer.from(providedSig, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) {
    return null;
  }

  const isValid = crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  if (!isValid) {
    return null;
  }

  return { nonce, timestamp };
}

/**
 * Build secure Shopify Admin embedded app redirect URL
 * Strictly validates Shopify's 'host' parameter against the authenticated shop
 * Prevents open redirects, port injection, credential injection, and directory traversal
 */
export function buildSecureEmbeddedAppRedirect(
  shopDomain: string,
  rawHost: unknown,
  appHandle: string = 'stockpilot',
  clientOrigin?: string
): string {
  const cleanStore = shopDomain.replace(/\.myshopify\.com$/i, '');
  const sanitizedAppHandle = encodeURIComponent(appHandle || 'stockpilot');

  // If host query parameter is present, decode and validate strictly
  if (typeof rawHost === 'string' && rawHost.trim()) {
    try {
      const decodedHost = Buffer.from(rawHost.trim(), 'base64').toString('utf8');
      // Trusted host patterns:
      // Modern: admin.shopify.com/store/{cleanStore}
      // Legacy: {cleanStore}.myshopify.com/admin
      const trustedAdminHostRegex = /^admin\.shopify\.com\/store\/([a-zA-Z0-9\-]+)$/;
      const trustedLegacyHostRegex = /^([a-zA-Z0-9\-]+)\.myshopify\.com\/admin$/;

      const adminMatch = decodedHost.match(trustedAdminHostRegex);
      const legacyMatch = decodedHost.match(trustedLegacyHostRegex);

      if (adminMatch && adminMatch[1].toLowerCase() === cleanStore.toLowerCase()) {
        return `https://${decodedHost}/apps/${sanitizedAppHandle}`;
      }
      if (legacyMatch && legacyMatch[1].toLowerCase() === cleanStore.toLowerCase()) {
        return `https://${decodedHost}/apps/${sanitizedAppHandle}`;
      }
      console.warn(`[ShopifyOAuth] Host parameter did not match authenticated shop domain: ${decodedHost}`);
    } catch {
      console.warn('[ShopifyOAuth] Failed to decode base64 host query parameter');
    }
  }

  // Fallback to canonical trusted standard Shopify Admin embedded URL for this shop
  return `https://admin.shopify.com/store/${cleanStore}/apps/${sanitizedAppHandle}`;
}
