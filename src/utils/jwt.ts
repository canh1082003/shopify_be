import crypto from 'crypto';
import { config } from '../config';

export type TokenType = 'access' | 'refresh';

export const JWT_ISSUER = 'stockpilot-api';
export const JWT_AUDIENCE = 'stockpilot-app';

export interface JwtPayload {
  shopId: string;
  shopDomain: string;
  role?: string;
  type?: TokenType;
  familyId?: string; // Token family ID for refresh token rotation
  jti?: string; // Unique token identifier
  absoluteExpiresAt?: number; // Absolute session timeout unix timestamp
  iss?: string;
  aud?: string;
  nbf?: number;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
  familyId?: string;
  jti?: string;
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
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss' | 'aud'>,
  expiresInSeconds = config.jwtExpiresInSeconds,
  tokenType: TokenType = 'access'
): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);

  // FIX 2: Explicitly prevent caller from overriding trusted iss and aud
  const { iss: _ignoredIss, aud: _ignoredAud, ...safePayload } = payload as any;

  const fullPayload: JwtPayload = {
    ...safePayload,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    type: tokenType,
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
 * Generate both an Access Token and a long-lived Refresh Token with token family & rotation support
 */
export function generateTokenPair(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'type'>,
  accessExpirySeconds = config.jwtExpiresInSeconds, // default 15m (900s)
  refreshExpirySeconds = 7 * 24 * 3600, // 7 days (604800s)
  familyId?: string,
  jti?: string,
  absoluteExpiresAt?: number
): TokenPair {
  const finalFamilyId = familyId || `fam-${crypto.randomUUID()}`;
  const finalJti = jti || `jti-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const finalAbsoluteExpiry = absoluteExpiresAt || now + refreshExpirySeconds;

  const accessToken = generateToken(
    {
      shopId: payload.shopId,
      shopDomain: payload.shopDomain,
      role: payload.role,
    },
    accessExpirySeconds,
    'access'
  );

  const refreshToken = generateToken(
    {
      shopId: payload.shopId,
      shopDomain: payload.shopDomain,
      role: payload.role,
      familyId: finalFamilyId,
      jti: finalJti,
      absoluteExpiresAt: finalAbsoluteExpiry,
    },
    refreshExpirySeconds,
    'refresh'
  );

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: accessExpirySeconds,
    refreshExpiresIn: refreshExpirySeconds,
    familyId: finalFamilyId,
    jti: finalJti,
  };
}

/**
 * Verify and decode an HMAC-SHA256 JWT Token
 */
export function verifyToken(token: string, expectedType: TokenType = 'access'): JwtPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('No token provided');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT token structure');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const message = `${encodedHeader}.${encodedPayload}`;

  // 1. Verify Header Encoding & Algorithm
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
  } catch {
    throw new Error('Invalid token header encoding');
  }

  if (!header || typeof header !== 'object') {
    throw new Error('Malformed JWT token header');
  }

  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported token algorithm '${header.alg}', expected 'HS256'`);
  }

  if (header.typ && header.typ !== 'JWT') {
    throw new Error(`Unsupported token type header '${header.typ}', expected 'JWT'`);
  }

  // 2. Verify Signature using constant-time comparison
  const expectedSignature = crypto
    .createHmac('sha256', config.jwtSecret)
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
    throw new Error('Failed to parse token signature');
  }

  if (
    providedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error('Invalid token signature');
  }

  // 3. Decode Payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw new Error('Invalid token payload encoding');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Malformed JWT token payload');
  }

  // 4. Verify Issuer
  if (payload.iss !== JWT_ISSUER) {
    throw new Error(`Invalid token issuer: expected '${JWT_ISSUER}', got '${payload.iss || 'none'}'`);
  }

  // 5. Verify Audience
  if (payload.aud !== JWT_AUDIENCE) {
    throw new Error(`Invalid token audience: expected '${JWT_AUDIENCE}', got '${payload.aud || 'none'}'`);
  }

  // 6. Verify Token Type (access vs refresh)
  if (!payload.type || payload.type !== expectedType) {
    throw new Error(`Invalid token type: expected '${expectedType}', got '${payload.type || 'none'}'`);
  }

  // 7. Verify Not Before (nbf)
  const now = Math.floor(Date.now() / 1000);
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > now) {
      throw new Error('Token is not yet active (nbf)');
    }
  }

  // 8. Verify Expiration
  // FIX 4: Reject tokens when exp <= now and validate finite numeric timestamp
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new Error('Token has expired');
  }

  return payload;
}

/**
 * Specifically verify a Refresh Token
 */
export function verifyRefreshToken(refreshToken: string): JwtPayload {
  return verifyToken(refreshToken, 'refresh');
}
