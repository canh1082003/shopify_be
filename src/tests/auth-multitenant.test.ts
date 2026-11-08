import './bootstrap';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { verifyShopifySessionToken } from '../utils/shopifyToken';
import { generateTestShopifySessionToken } from './testUtils';
import {
  generateToken,
  generateTokenPair,
  verifyToken,
  verifyRefreshToken,
  JWT_ISSUER,
  JWT_AUDIENCE,
} from '../utils/jwt';
import { verifyShopifyWebhookHmac } from '../utils/crypto';
import { repository } from '../db/repository';
import {
  config,
  validateProductionConfig,
  DEFAULT_DEV_ENCRYPTION_KEY,
  DEFAULT_DEV_JWT_SECRET,
  DEFAULT_JWT_EXPIRES_IN_SECONDS,
  parseJwtExpiresInSeconds,
} from '../config';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';
import {
  getAuthenticatedShopId,
  assertTenantMatch,
  authenticateToken,
} from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { authController } from '../controllers/auth.controller';
import { inventoryController } from '../controllers/inventory.controller';
import { orderController } from '../controllers/order.controller';
import { settingsController } from '../controllers/settings.controller';
import { integrationController } from '../controllers/integration.controller';
import { shopifyService } from '../services/shopify.service';
import { Shop, ShopifySession, ProductVariant, Order, Settings } from '../types';

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    send(data: any) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function createMockNext(mockRes: any) {
  return (err?: any) => {
    if (err) {
      mockRes.statusCode = err.statusCode || 500;
      mockRes.body = {
        success: false,
        statusCode: mockRes.statusCode,
        errorCode: err.errorCode,
        message: err.message,
      };
    }
  };
}

function base64UrlEncode(strOrBuffer: string | Buffer): string {
  const buf = typeof strOrBuffer === 'string' ? Buffer.from(strOrBuffer, 'utf8') : strOrBuffer;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Test-only helper to generate custom or malformed tokens for negative verification testing
 * without exposing header or claim override parameters in the production token generator.
 */
function createTestCustomToken(options: {
  header?: Record<string, any>;
  payload?: Record<string, any>;
  secret?: string;
  signatureOverride?: string;
}): string {
  const header = options.header !== undefined ? options.header : { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    shopId: 'shop-test',
    shopDomain: 'test.myshopify.com',
    type: 'access',
    iat: now,
    exp: now + 900,
    ...(options.payload || {}),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const message = `${encodedHeader}.${encodedPayload}`;

  if (options.signatureOverride !== undefined) {
    return `${message}.${options.signatureOverride}`;
  }

  const secret = options.secret || config.jwtSecret;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest();
  return `${message}.${base64UrlEncode(signature)}`;
}

describe('Phase 1: Shopify Session Token Verification & Security', () => {
  const TEST_SHOP_DOMAIN = 'conganh-test-lab.myshopify.com';

  it('1. Valid Shopify Session Token: correctly verifies and derives shopDomain from dest', () => {
    const validToken = generateTestShopifySessionToken({
      shopDomain: TEST_SHOP_DOMAIN,
      expiresInSeconds: 60,
    });

    const payload = verifyShopifySessionToken(validToken);
    assert.strictEqual(payload.shopDomain, TEST_SHOP_DOMAIN);
    assert.strictEqual(payload.dest, `https://${TEST_SHOP_DOMAIN}`);
    assert.strictEqual(payload.iss, `https://${TEST_SHOP_DOMAIN}/admin`);
    assert.strictEqual(payload.aud, config.shopify.apiKey);
  });

  it('2. Forged Shopify Session Token: invalid signature is rejected', () => {
    const forgedToken = generateTestShopifySessionToken({
      shopDomain: TEST_SHOP_DOMAIN,
      tamperSignature: true,
    });

    assert.throws(
      () => verifyShopifySessionToken(forgedToken),
      /Invalid Shopify session token signature/
    );
  });

  it('3. Forged Secret: token signed with foreign secret is rejected', () => {
    const wrongSecretToken = generateTestShopifySessionToken({
      shopDomain: TEST_SHOP_DOMAIN,
      apiSecret: 'attacker_random_hmac_secret_key_1234567890',
    });

    assert.throws(
      () => verifyShopifySessionToken(wrongSecretToken),
      /Invalid Shopify session token signature/
    );
  });

  it('4. Expired Shopify Session Token: rejected when exp has passed', () => {
    const expiredToken = generateTestShopifySessionToken({
      shopDomain: TEST_SHOP_DOMAIN,
      expiresInSeconds: -30, // Expired 30 seconds ago
    });

    assert.throws(
      () => verifyShopifySessionToken(expiredToken),
      /Shopify session token has expired/
    );
  });

  it('5. Audience Mismatch: rejected when aud does not match app apiKey', () => {
    const foreignAudienceToken = generateTestShopifySessionToken({
      shopDomain: TEST_SHOP_DOMAIN,
      apiKey: 'foreign_client_id_999999',
    });

    assert.throws(
      () => verifyShopifySessionToken(foreignAudienceToken),
      /Invalid token audience/
    );
  });

  it('6. Malformed Structure: non-JWT string is rejected', () => {
    assert.throws(
      () => verifyShopifySessionToken('random-invalid-string'),
      /Malformed Shopify session token/
    );
  });

  it('7. Malformed dest claim: non-Shopify domain in dest claim is rejected', () => {
    const maliciousDomainToken = generateTestShopifySessionToken({
      shopDomain: 'evil-phishing-site.com',
    });

    assert.throws(
      () => verifyShopifySessionToken(maliciousDomainToken),
      /Invalid shop domain in dest claim/
    );
  });
});

describe('Phase 1: Multi-Tenant Isolation & Controller Context', () => {
  const SHOP_A_ID = 'shop-tenant_alpha_myshopify_com';
  const SHOP_B_ID = 'shop-tenant_beta_myshopify_com';

  it('8. getAuthenticatedShopId: extracts shopId when authenticated', () => {
    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: 'tenant-alpha.myshopify.com',
        role: 'merchant_admin',
      },
    };

    const extracted = getAuthenticatedShopId(mockReq);
    assert.strictEqual(extracted, SHOP_A_ID);
  });

  it('9. Missing Tenant Context: throws 401 UNAUTHORIZED if req.shop is missing', () => {
    const mockReq: any = {};

    assert.throws(
      () => getAuthenticatedShopId(mockReq),
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.strictEqual(err.statusCode, HttpStatus.UNAUTHORIZED);
        assert.strictEqual(err.errorCode, ErrorCode.AUTH_TOKEN_MISSING);
        return true;
      }
    );
  });

  it('10. Cross-Tenant Access: assertTenantMatch throws 403 FORBIDDEN when targetShopId mismatches', () => {
    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: 'tenant-alpha.myshopify.com',
      },
    };

    assert.throws(
      () => assertTenantMatch(mockReq, SHOP_B_ID),
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.strictEqual(err.statusCode, HttpStatus.FORBIDDEN);
        assert.strictEqual(err.errorCode, ErrorCode.TENANT_MISMATCH);
        return true;
      }
    );
  });

  it('11. Same Tenant Access: assertTenantMatch succeeds when targetShopId matches', () => {
    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: 'tenant-alpha.myshopify.com',
      },
    };

    assert.doesNotThrow(() => assertTenantMatch(mockReq, SHOP_A_ID));
    assert.doesNotThrow(() => assertTenantMatch(mockReq, undefined));
  });

  it('12. Token without shopId claim: verifyToken produces payload without shopId which middleware rejects', () => {
    const tokenWithoutShop = generateToken(
      { shopId: '', shopDomain: 'empty.myshopify.com' },
      60,
      'access'
    );
    const decoded = verifyToken(tokenWithoutShop, 'access');
    assert.strictEqual(decoded.shopId, '');
  });
});

describe('Phase 1: Refresh Token & Session Revocation Security', () => {
  it('13. Expired or invalid refresh token cannot be verified', () => {
    assert.throws(
      () => verifyToken('invalid.refresh.token', 'refresh'),
      /Invalid token signature|Malformed|Invalid token header/
    );
  });

  it('14. Access token cannot be used in place of refresh token', () => {
    const accessToken = generateToken(
      { shopId: 'shop-test', shopDomain: 'test.myshopify.com' },
      900,
      'access'
    );

    assert.throws(
      () => verifyToken(accessToken, 'refresh'),
      /Invalid token type: expected 'refresh'/
    );
  });
});

describe('Phase 1: Webhook HMAC Raw Buffer Cryptographic Verification', () => {
  const secret = 'webhook_test_secret_key_abcdef123456';
  const samplePayload = JSON.stringify({
    id: 123456789,
    topic: 'orders/create',
    total_price: '99.00',
    currency: 'USD',
  });
  const rawBuffer = Buffer.from(samplePayload, 'utf8');

  it('15. Valid raw Buffer with matching HMAC succeeds', () => {
    const validHmac = crypto
      .createHmac('sha256', secret)
      .update(rawBuffer)
      .digest('base64');

    const isValid = verifyShopifyWebhookHmac(rawBuffer, validHmac, secret);
    assert.strictEqual(isValid, true);
  });

  it('16. Tampered raw Buffer fails HMAC verification', () => {
    const originalHmac = crypto
      .createHmac('sha256', secret)
      .update(rawBuffer)
      .digest('base64');

    const tamperedBuffer = Buffer.from(samplePayload.replace('99.00', '1.00'), 'utf8');
    const isValid = verifyShopifyWebhookHmac(tamperedBuffer, originalHmac, secret);
    assert.strictEqual(isValid, false);
  });

  it('17. Invalid or empty HMAC header fails verification safely', () => {
    assert.strictEqual(verifyShopifyWebhookHmac(rawBuffer, '', secret), false);
    assert.strictEqual(verifyShopifyWebhookHmac(rawBuffer, 'invalid_hmac', secret), false);
    assert.strictEqual(verifyShopifyWebhookHmac(rawBuffer, 'aW52YWxpZA==', secret), false);
  });

  it('18. Re-serialized JSON with different key order produces different HMAC than raw body', () => {
    const originalObj = { z: 1, a: 2, m: 3 };
    const originalRaw = Buffer.from(JSON.stringify(originalObj), 'utf8');
    const expectedHmac = crypto.createHmac('sha256', secret).update(originalRaw).digest('base64');

    // Re-ordering keys in JS object and stringifying:
    const reorderedObj = { a: 2, m: 3, z: 1 };
    const reorderedRaw = Buffer.from(JSON.stringify(reorderedObj), 'utf8');

    // Confirms why rawBuffer capture is mandatory and JSON.stringify fallback is broken:
    assert.notStrictEqual(originalRaw.toString(), reorderedRaw.toString());
    assert.strictEqual(verifyShopifyWebhookHmac(reorderedRaw, expectedHmac, secret), false);
  });
});

describe('Phase 1 Hardening: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06', () => {
  const TEST_SEC_SHOP_ID = 'shop-sec_test_myshopify_com';
  const TEST_SEC_SHOP_DOMAIN = 'sec-test.myshopify.com';

  const secShop: Shop = {
    id: TEST_SEC_SHOP_ID,
    shopDomain: TEST_SEC_SHOP_DOMAIN,
    name: 'Security Test Store',
    currency: 'USD',
    timezone: 'UTC',
    plan: 'basic',
    installedAt: new Date().toISOString(),
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('19. SEC-03: Missing sub claim in session token is rejected', () => {
    const token = generateTestShopifySessionToken({
      shopDomain: TEST_SEC_SHOP_DOMAIN,
      customClaims: { sub: undefined },
    });
    assert.throws(
      () => verifyShopifySessionToken(token),
      /missing sub claim/i
    );
  });

  it('20. SEC-03: Non-https dest protocol in session token is rejected', () => {
    const token = generateTestShopifySessionToken({
      shopDomain: TEST_SEC_SHOP_DOMAIN,
      customClaims: { dest: `http://${TEST_SEC_SHOP_DOMAIN}` },
    });
    assert.throws(
      () => verifyShopifySessionToken(token),
      /Invalid dest protocol 'http:', expected 'https:'/i
    );
  });

  it('21. SEC-03: Lifespan exceeding 120s max allowable duration is rejected', () => {
    const token = generateTestShopifySessionToken({
      shopDomain: TEST_SEC_SHOP_DOMAIN,
      expiresInSeconds: 300, // 5 minutes > 120s
    });
    assert.throws(
      () => verifyShopifySessionToken(token),
      /lifespan exceeds allowable limit/i
    );
  });

  it('22. SEC-01: Token exchange rejects shop with missing session credentials (no env fallback)', async () => {
    // Ensure shop exists but has no active offline session in DB
    await repository.upsertShop(secShop);
    await repository.deleteSession(TEST_SEC_SHOP_ID);

    const validSessionToken = generateTestShopifySessionToken({
      shopDomain: TEST_SEC_SHOP_DOMAIN,
      expiresInSeconds: 60,
    });

    const mockReq: any = {
      headers: { authorization: `Bearer ${validSessionToken}` },
      body: {},
    };
    const mockRes = createMockResponse();

    await authController.issueToken(mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, 'AUTH_SESSION_INVALID');
  });

  it('23. SEC-01 & SEC-05: Token exchange succeeds when offline session exists and creates new token family', async () => {
    const secSession: ShopifySession = {
      id: `session-${TEST_SEC_SHOP_ID}`,
      shopId: TEST_SEC_SHOP_ID,
      sessionType: 'offline',
      encryptedAccessToken: 'test-encrypted-token',
      iv: 'test-iv',
      authTag: 'test-auth-tag',
      scope: 'read_products,read_inventory',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repository.saveSession(secSession);

    const validSessionToken = generateTestShopifySessionToken({
      shopDomain: TEST_SEC_SHOP_DOMAIN,
      expiresInSeconds: 60,
    });

    const mockReq: any = {
      headers: { authorization: `Bearer ${validSessionToken}` },
      body: {},
    };
    const mockRes = createMockResponse();

    await authController.issueToken(mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, HttpStatus.OK);
    assert.ok(mockRes.body.data.token);
    assert.ok(mockRes.body.data.refreshToken);

    // Verify family was persisted in repository
    const decoded = verifyToken(mockRes.body.data.refreshToken, 'refresh');
    assert.ok(decoded.familyId);
    const family = await repository.getTokenFamily(decoded.familyId!);
    assert.ok(family);
    assert.strictEqual(family?.shopId, TEST_SEC_SHOP_ID);
    assert.strictEqual(family?.revoked, false);
  });

  it('24. SEC-02: updateVariantOverride returns 404 when variant does not exist or belong to tenant', async () => {
    const mockReq: any = {
      shop: {
        shopId: TEST_SEC_SHOP_ID,
        shopDomain: TEST_SEC_SHOP_DOMAIN,
      },
      params: { id: 'variant-non-existent-999' },
      body: { lowStockThreshold: 15 },
    };
    const mockRes = createMockResponse();

    await inventoryController.updateVariantOverride(mockReq, mockRes);

    assert.strictEqual(mockRes.statusCode, HttpStatus.NOT_FOUND);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('25. SEC-04: authenticateToken middleware rejects uninstalled shop', async () => {
    // Mark shop uninstalled
    await repository.upsertShop({
      ...secShop,
      uninstalledAt: new Date().toISOString(),
    });

    const accessToken = generateToken(
      { shopId: TEST_SEC_SHOP_ID, shopDomain: TEST_SEC_SHOP_DOMAIN },
      900,
      'access'
    );

    const mockReq: any = {
      headers: { authorization: `Bearer ${accessToken}` },
    };
    const mockRes = createMockResponse();
    let nextCalled = false;

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.TENANT_MISMATCH);
    assert.match(mockRes.body.message, /Store is uninstalled or nonexistent/);
  });

  it('26. SEC-06: verifyTokenStatus rejects uninstalled shop', async () => {
    const accessToken = generateToken(
      { shopId: TEST_SEC_SHOP_ID, shopDomain: TEST_SEC_SHOP_DOMAIN },
      900,
      'access'
    );

    const mockReq: any = {
      headers: { authorization: `Bearer ${accessToken}` },
    };
    const mockRes = createMockResponse();

    await authController.verifyTokenStatus(mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.data.valid, false);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.TENANT_MISMATCH);
  });

  it('27. SEC-05: Multi-session isolation: rotating session A does not affect session B', async () => {
    // Restore shop to active state
    await repository.upsertShop({
      ...secShop,
      uninstalledAt: undefined,
    });
    const secSession: ShopifySession = {
      id: `session-${TEST_SEC_SHOP_ID}`,
      shopId: TEST_SEC_SHOP_ID,
      sessionType: 'offline',
      encryptedAccessToken: 'test-encrypted-token',
      iv: 'test-iv',
      authTag: 'test-auth-tag',
      scope: 'read_products,read_inventory',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repository.saveSession(secSession);

    // Create Session A (e.g. desktop)
    const famAId = `fam-desktop-${Date.now()}`;
    const jtiA1 = `jti-a1-${Date.now()}`;
    await repository.saveTokenFamily({
      familyId: famAId,
      shopId: TEST_SEC_SHOP_ID,
      currentJti: jtiA1,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    });
    const tokensA1 = generateTokenPair(
      { shopId: TEST_SEC_SHOP_ID, shopDomain: TEST_SEC_SHOP_DOMAIN },
      900,
      86400,
      famAId,
      jtiA1
    );

    // Create Session B (e.g. mobile)
    const famBId = `fam-mobile-${Date.now()}`;
    const jtiB1 = `jti-b1-${Date.now()}`;
    await repository.saveTokenFamily({
      familyId: famBId,
      shopId: TEST_SEC_SHOP_ID,
      currentJti: jtiB1,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    });
    const tokensB1 = generateTokenPair(
      { shopId: TEST_SEC_SHOP_ID, shopDomain: TEST_SEC_SHOP_DOMAIN },
      900,
      86400,
      famBId,
      jtiB1
    );

    // Rotate Session A
    const reqA: any = { body: { refreshToken: tokensA1.refreshToken } };
    const resA = createMockResponse();
    await authController.refreshToken(reqA, resA, () => {});
    assert.strictEqual(resA.statusCode, HttpStatus.OK);

    // Verify Session A rotated to new JTI
    const famARecord = await repository.getTokenFamily(famAId);
    assert.strictEqual(famARecord?.previousJti, jtiA1);
    assert.notStrictEqual(famARecord?.currentJti, jtiA1);

    // Verify Session B is untouched and still valid with its original token
    const famBRecord = await repository.getTokenFamily(famBId);
    assert.strictEqual(famBRecord?.currentJti, jtiB1);
    assert.strictEqual(famBRecord?.revoked, false);
  });

  it('28. SEC-05: Replay attack revokes compromised token family without revoking other sessions', async () => {
    // Setup two active families: Compromised A and Innocent B
    const famCompromised = `fam-comp-${Date.now()}`;
    const jtiOld = `jti-old-${Date.now()}`;
    const jtiCurrent = `jti-curr-${Date.now()}`;
    await repository.saveTokenFamily({
      familyId: famCompromised,
      shopId: TEST_SEC_SHOP_ID,
      currentJti: jtiCurrent,
      previousJti: 'jti-already-past-grace',
      rotatedAt: new Date(Date.now() - 60000).toISOString(), // Rotated 60s ago (> 10s grace)
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    });

    const famInnocent = `fam-inno-${Date.now()}`;
    const jtiInnocent = `jti-inno-${Date.now()}`;
    await repository.saveTokenFamily({
      familyId: famInnocent,
      shopId: TEST_SEC_SHOP_ID,
      currentJti: jtiInnocent,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    });

    // Attacker attempts replay with old JTI
    const replayToken = generateTokenPair(
      { shopId: TEST_SEC_SHOP_ID, shopDomain: TEST_SEC_SHOP_DOMAIN },
      900,
      86400,
      famCompromised,
      jtiOld
    ).refreshToken;

    const mockReq: any = { body: { refreshToken: replayToken } };
    const mockRes = createMockResponse();

    await authController.refreshToken(mockReq, mockRes, () => {});

    // Replay must be detected and rejected
    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, 'AUTH_REPLAY_DETECTED');

    // Compromised family is revoked
    const updatedCompromised = await repository.getTokenFamily(famCompromised);
    assert.strictEqual(updatedCompromised?.revoked, true);

    // Innocent family is NOT revoked
    const updatedInnocent = await repository.getTokenFamily(famInnocent);
    assert.strictEqual(updatedInnocent?.revoked, false);
  });
});

describe('Phase 1 — Step 3B: JWT Hardening & Claims Verification', () => {
  const TEST_SHOP_ID = 'shop-jwt_harden_myshopify_com';
  const TEST_SHOP_DOMAIN = 'jwt-harden.myshopify.com';

  it('29. Missing access token: authenticateToken rejects with 401 AUTH_TOKEN_MISSING', async () => {
    const mockReq: any = { headers: {} };
    const mockRes = createMockResponse();
    let nextCalled = false;

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.AUTH_TOKEN_MISSING);
  });

  it('30. Malformed authorization header format: rejects with 401 AUTH_INVALID_HEADER', async () => {
    const mockReq: any = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
    const mockRes = createMockResponse();
    let nextCalled = false;

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.AUTH_INVALID_HEADER);
  });

  it('31. Unsupported JWT algorithm: alg "none" is rejected', () => {
    const token = createTestCustomToken({ header: { alg: 'none', typ: 'JWT' } });

    assert.throws(
      () => verifyToken(token, 'access'),
      /Unsupported token algorithm 'none'/i
    );
  });

  it('32. Unsupported JWT algorithm: alg "RS256" is rejected', () => {
    const token = createTestCustomToken({ header: { alg: 'RS256', typ: 'JWT' } });

    assert.throws(
      () => verifyToken(token, 'access'),
      /Unsupported token algorithm 'RS256'/i
    );
  });

  it('33. Unsupported JWT header type: typ "JOSE" is rejected', () => {
    const token = createTestCustomToken({ header: { alg: 'HS256', typ: 'JOSE' } });

    assert.throws(
      () => verifyToken(token, 'access'),
      /Unsupported token type header 'JOSE'/i
    );
  });

  it('34. Malformed JWT header: non-JSON header segment is rejected', () => {
    const parts = generateToken(
      { shopId: TEST_SHOP_ID, shopDomain: TEST_SHOP_DOMAIN }
    ).split('.');
    const malformedHeader = Buffer.from('invalid-json-header').toString('base64');
    const malformedToken = `${malformedHeader}.${parts[1]}.${parts[2]}`;

    assert.throws(
      () => verifyToken(malformedToken, 'access'),
      /Invalid token header encoding/i
    );
  });

  it('35. Invalid JWT signature: payload modification or wrong key fails verification', () => {
    const token = createTestCustomToken({
      signatureOverride: 'invalidsignatureoverride1234567890',
    });

    assert.throws(
      () => verifyToken(token, 'access'),
      /Invalid token signature/i
    );
  });

  it('36. Wrong issuer: token with untrusted iss is rejected', () => {
    const token = createTestCustomToken({
      payload: { iss: 'untrusted-issuer' },
    });

    assert.throws(
      () => verifyToken(token, 'access'),
      /Invalid token issuer: expected 'stockpilot-api'/i
    );
  });

  it('37. Wrong audience: token with untrusted aud is rejected', () => {
    const token = createTestCustomToken({
      payload: { aud: 'foreign-application' },
    });

    assert.throws(
      () => verifyToken(token, 'access'),
      /Invalid token audience: expected 'stockpilot-app'/i
    );
  });

  it('38. Future nbf: token with not-before timestamp in future is rejected', () => {
    const futureTime = Math.floor(Date.now() / 1000) + 300;
    const token = createTestCustomToken({
      payload: { nbf: futureTime },
    });

    assert.throws(
      () => verifyToken(token, 'access'),
      /Token is not yet active \(nbf\)/i
    );
  });

  it('39. Valid/past nbf: token with nbf in past is accepted', () => {
    const pastTime = Math.floor(Date.now() / 1000) - 60;
    const token = generateToken(
      { shopId: TEST_SHOP_ID, shopDomain: TEST_SHOP_DOMAIN, nbf: pastTime },
      900,
      'access'
    );

    const decoded = verifyToken(token, 'access');
    assert.strictEqual(decoded.shopId, TEST_SHOP_ID);
    assert.strictEqual(decoded.iss, JWT_ISSUER);
    assert.strictEqual(decoded.aud, JWT_AUDIENCE);
  });

  it('40. Expired access token: rejected with Token has expired and 401 AUTH_TOKEN_EXPIRED', async () => {
    const expiredToken = generateToken(
      { shopId: TEST_SHOP_ID, shopDomain: TEST_SHOP_DOMAIN },
      -10,
      'access'
    );

    assert.throws(
      () => verifyToken(expiredToken, 'access'),
      /Token has expired/i
    );

    const mockReq: any = { headers: { authorization: `Bearer ${expiredToken}` } };
    const mockRes = createMockResponse();
    let nextCalled = false;

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.AUTH_TOKEN_EXPIRED);
  });

  it('41. Refresh token cannot be used as access token in authenticateToken', async () => {
    const tokenPair = generateTokenPair(
      { shopId: TEST_SHOP_ID, shopDomain: TEST_SHOP_DOMAIN }
    );

    assert.throws(
      () => verifyToken(tokenPair.refreshToken, 'access'),
      /Invalid token type: expected 'access', got 'refresh'/i
    );

    const mockReq: any = { headers: { authorization: `Bearer ${tokenPair.refreshToken}` } };
    const mockRes = createMockResponse();
    let nextCalled = false;

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.AUTH_INVALID_TOKEN);
    assert.match(mockRes.body.message, /Invalid token type: expected 'access', got 'refresh'/i);
  });

  it('42. Access token cannot be used as refresh token in verifyRefreshToken', () => {
    const tokenPair = generateTokenPair(
      { shopId: TEST_SHOP_ID, shopDomain: TEST_SHOP_DOMAIN }
    );

    assert.throws(
      () => verifyRefreshToken(tokenPair.accessToken),
      /Invalid token type: expected 'refresh', got 'access'/i
    );
  });

  it('43. FIX 2: Caller cannot override trusted iss or aud in generateToken', () => {
    const token = generateToken({
      shopId: TEST_SHOP_ID,
      shopDomain: TEST_SHOP_DOMAIN,
      iss: 'malicious-issuer',
      aud: 'malicious-aud',
    } as any);

    const decoded = verifyToken(token, 'access');
    assert.strictEqual(decoded.iss, JWT_ISSUER);
    assert.strictEqual(decoded.aud, JWT_AUDIENCE);
    assert.notStrictEqual(decoded.iss, 'malicious-issuer');
    assert.notStrictEqual(decoded.aud, 'malicious-aud');
  });

  it('44. FIX 4: Expiration boundary exp === now is strictly rejected', () => {
    const now = Math.floor(Date.now() / 1000);
    const tokenBoundary = createTestCustomToken({ payload: { exp: now } });

    assert.throws(
      () => verifyToken(tokenBoundary, 'access'),
      /Token has expired/i
    );
  });

  it('45. FIX 4: Non-finite exp timestamp (NaN, Infinity) is rejected as expired', () => {
    const tokenNaN = createTestCustomToken({ payload: { exp: NaN } });
    assert.throws(() => verifyToken(tokenNaN, 'access'), /Token has expired/i);

    const tokenInf = createTestCustomToken({ payload: { exp: Infinity } });
    assert.throws(() => verifyToken(tokenInf, 'access'), /Token has expired/i);
  });

  it('46. FIX 4: Non-finite nbf timestamp (NaN) is rejected', () => {
    const tokenNbfNaN = createTestCustomToken({ payload: { nbf: NaN } });
    assert.throws(() => verifyToken(tokenNbfNaN, 'access'), /Token is not yet active \(nbf\)/i);
  });

  it('47. FIX 1: Default access token lifetime is exactly 900 seconds (15 minutes)', () => {
    assert.strictEqual(config.jwtExpiresInSeconds, 900);
    assert.strictEqual(DEFAULT_JWT_EXPIRES_IN_SECONDS, 900);

    const token = generateToken({ shopId: TEST_SHOP_ID, shopDomain: TEST_SHOP_DOMAIN });
    const decoded = verifyToken(token, 'access');
    assert.strictEqual((decoded.exp || 0) - (decoded.iat || 0), 900);

    const pair = generateTokenPair({ shopId: TEST_SHOP_ID, shopDomain: TEST_SHOP_DOMAIN });
    assert.strictEqual(pair.expiresIn, 900);
    assert.strictEqual(pair.refreshExpiresIn, 7 * 24 * 3600);
  });

  it('48. FIX 1: Invalid expiration configuration values are rejected', () => {
    assert.throws(() => parseJwtExpiresInSeconds('0'), /must be a positive integer/);
    assert.throws(() => parseJwtExpiresInSeconds('-10'), /must be a positive integer/);
    assert.throws(() => parseJwtExpiresInSeconds('abc'), /must be a positive integer/);
    assert.throws(() => parseJwtExpiresInSeconds('15.5'), /must be a positive integer/);
    assert.strictEqual(parseJwtExpiresInSeconds('1800'), 1800);
    assert.strictEqual(parseJwtExpiresInSeconds(undefined), 900);
  });
});

describe('Phase 1 — Step 3B: Secure Environment Configuration (Fail-Closed)', () => {
  it('49. Production startup fails when JWT_SECRET is missing', () => {
    assert.throws(
      () => validateProductionConfig({ NODE_ENV: 'production' }),
      /Production startup failed: JWT_SECRET environment variable is missing\./
    );
  });

  it('50. Production startup fails when JWT_SECRET uses default development fallback', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: DEFAULT_DEV_JWT_SECRET,
          ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        }),
      /Production startup failed: JWT_SECRET is unsafe or using default development secret\./
    );
  });

  it('51. Production startup fails when JWT_SECRET is shorter than 32 characters', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'short-secret-12345',
          ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        }),
      /Production startup failed: JWT_SECRET is unsafe or using default development secret\./
    );
  });

  it('52. Production startup fails when ENCRYPTION_KEY is missing', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'custom_strong_jwt_secret_at_least_32_characters_long_1234567890',
        }),
      /Production startup failed: ENCRYPTION_KEY environment variable is missing\./
    );
  });

  it('53. Production startup fails when ENCRYPTION_KEY uses default development fallback', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'custom_strong_jwt_secret_at_least_32_characters_long_1234567890',
          ENCRYPTION_KEY: DEFAULT_DEV_ENCRYPTION_KEY,
        }),
      /Production startup failed: ENCRYPTION_KEY is unsafe or using default development secret\./
    );
  });

  it('54. FIX 5: Production startup fails when ENCRYPTION_KEY is not exactly 64 hex characters (e.g. 32-byte ASCII)', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'custom_strong_jwt_secret_at_least_32_characters_long_1234567890',
          ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', // 32 chars = 16 bytes when hex-decoded
        }),
      /Production startup failed: ENCRYPTION_KEY must be exactly 64 hexadecimal characters/
    );
  });

  it('55. FIX 5: Production startup fails when ENCRYPTION_KEY contains non-hex characters', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'custom_strong_jwt_secret_at_least_32_characters_long_1234567890',
          // 64 chars but contains 'z' and 'g'
          ENCRYPTION_KEY: 'zz23456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        }),
      /Production startup failed: ENCRYPTION_KEY must be exactly 64 hexadecimal characters/
    );
  });

  it('56. FIX 5: Production startup fails when ENCRYPTION_KEY is short hex (63 chars)', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'custom_strong_jwt_secret_at_least_32_characters_long_1234567890',
          ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde', // 63 chars
        }),
      /Production startup failed: ENCRYPTION_KEY must be exactly 64 hexadecimal characters/
    );
  });

  it('57. FIX 5: Production startup succeeds with strong 64-char valid hex key and JWT secret', () => {
    assert.doesNotThrow(() =>
      validateProductionConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'custom_production_grade_jwt_secret_key_32_chars_minimum_value',
        ENCRYPTION_KEY: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      })
    );
  });

  it('58. Development and test environments preserve local workflows and allow dev fallbacks', () => {
    assert.doesNotThrow(() =>
      validateProductionConfig({
        NODE_ENV: 'development',
      })
    );
    assert.doesNotThrow(() =>
      validateProductionConfig({
        NODE_ENV: 'test',
      })
    );
  });

  it('59. Validation errors never expose or print secret values', () => {
    const sensitiveJwtSecret = 'super_secret_password_do_not_leak_in_logs_12345';
    try {
      validateProductionConfig({
        NODE_ENV: 'production',
        JWT_SECRET: sensitiveJwtSecret,
        ENCRYPTION_KEY: '',
      });
      assert.fail('Expected error to be thrown');
    } catch (err: any) {
      assert.strictEqual(err.message.includes(sensitiveJwtSecret), false);
    }
  });
});

describe('Phase 1 — Step 3B: Multi-Tenant Authorization & Cross-Shop Isolation Regression', () => {
  const SHOP_A_ID = 'shop-isolated_alpha_myshopify_com';
  const SHOP_A_DOMAIN = 'isolated-alpha.myshopify.com';
  const SHOP_B_ID = 'shop-isolated_beta_myshopify_com';
  const SHOP_B_DOMAIN = 'isolated-beta.myshopify.com';

  const shopA: Shop = {
    id: SHOP_A_ID,
    shopDomain: SHOP_A_DOMAIN,
    name: 'Tenant Alpha Store',
    currency: 'USD',
    timezone: 'America/New_York',
    plan: 'basic',
    installedAt: new Date().toISOString(),
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const shopB: Shop = {
    id: SHOP_B_ID,
    shopDomain: SHOP_B_DOMAIN,
    name: 'Tenant Beta Store',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    plan: 'enterprise',
    installedAt: new Date().toISOString(),
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const variantA: ProductVariant = {
    id: 'var-alpha-isolated-001',
    shopId: SHOP_A_ID,
    productId: 'prod-alpha-1',
    productTitle: 'Alpha Public Widget',
    shopifyVariantId: 'gid://shopify/ProductVariant/111111',
    inventoryItemId: 'inv-alpha-item-11',
    sku: 'SKU-ALPHA-001',
    title: 'Standard Edition',
    price: 19.99,
    compareAtPrice: null,
    costPrice: 8.0,
    tracked: true,
    requiresShipping: true,
    taxable: true,
    weight: 0.5,
    weightUnit: 'kg',
    selectedOptions: [],
    locationId: 'loc-alpha-1',
    locationName: 'Alpha Warehouse',
    availableQuantity: 100,
    committedQuantity: 5,
    averageDailySales: 5,
    daysRemaining: 20,
    status: 'healthy',
    lowStockThreshold: 15,
    leadTimeDays: 7,
    safetyStockDays: 5,
    recommendedRestockQuantity: 0,
    attributes: {},
    updatedAt: new Date().toISOString(),
  };

  const variantB: ProductVariant = {
    id: 'var-beta-isolated-101',
    shopId: SHOP_B_ID,
    productId: 'prod-beta-1',
    productTitle: 'Beta Secret Widget',
    shopifyVariantId: 'gid://shopify/ProductVariant/888888',
    inventoryItemId: 'inv-beta-item-88',
    sku: 'SKU-BETA-SECRET-101',
    title: 'Secret Edition',
    price: 99.99,
    compareAtPrice: null,
    costPrice: 40.0,
    tracked: true,
    requiresShipping: true,
    taxable: true,
    weight: 1,
    weightUnit: 'kg',
    selectedOptions: [],
    locationId: 'loc-beta-1',
    locationName: 'Beta Vault',
    availableQuantity: 42,
    committedQuantity: 0,
    averageDailySales: 2,
    daysRemaining: 21,
    status: 'healthy',
    lowStockThreshold: 10,
    leadTimeDays: 7,
    safetyStockDays: 5,
    recommendedRestockQuantity: 0,
    attributes: {},
    updatedAt: new Date().toISOString(),
  };

  const orderB: Order = {
    id: 'order-beta-isolated-202',
    shopId: SHOP_B_ID,
    shopifyOrderId: 'gid://shopify/Order/777777',
    orderNumber: '#BETA-1001',
    name: '#BETA-1001',
    customerName: 'Top Secret VIP',
    customerEmail: 'vip@beta-exclusive.com',
    financialStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    currencyCode: 'EUR',
    totalAmount: 199.98,
    totalItems: 2,
    fulfillableQuantity: 2,
    lineItems: [],
    isOverdue: false,
    overdueMinutes: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
  };

  it('60. Shop A requesting Shop B inventory by ID: returns 404, never reveals Shop B item', async () => {
    await repository.upsertShop(shopA);
    await repository.upsertShop(shopB);
    await repository.upsertVariants(SHOP_B_ID, [variantB]);

    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: SHOP_A_DOMAIN,
        type: 'access',
      },
      params: { id: variantB.id },
    };
    const mockRes = createMockResponse();

    await inventoryController.getInventoryItem(mockReq, mockRes);

    assert.strictEqual(mockRes.statusCode, HttpStatus.NOT_FOUND);
    assert.strictEqual(mockRes.body.success, false);
    assert.strictEqual(mockRes.body.data, undefined);
  });

  it('61. Shop A modifying Shop B inventory override: returns 404, does not modify Shop B', async () => {
    await repository.upsertVariants(SHOP_B_ID, [variantB]);

    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: SHOP_A_DOMAIN,
        type: 'access',
      },
      params: { id: variantB.id },
      body: { lowStockThreshold: 999 },
    };
    const mockRes = createMockResponse();

    await inventoryController.updateVariantOverride(mockReq, mockRes);

    assert.strictEqual(mockRes.statusCode, HttpStatus.NOT_FOUND);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.RESOURCE_NOT_FOUND);

    const originalVariant = await repository.getInventoryItemById(SHOP_B_ID, variantB.id);
    assert.strictEqual(originalVariant?.lowStockThreshold, 10);
  });

  it('62. Shop A requesting Shop B order by ID: returns 404, never reveals Shop B order', async () => {
    await repository.upsertOrder(SHOP_B_ID, orderB);

    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: SHOP_A_DOMAIN,
        type: 'access',
      },
      params: { id: orderB.id },
    };
    const mockRes = createMockResponse();
    const mockNext = createMockNext(mockRes);

    await orderController.getOrderById(mockReq, mockRes, mockNext);

    assert.strictEqual(mockRes.statusCode, HttpStatus.NOT_FOUND);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.RESOURCE_NOT_FOUND);
    assert.strictEqual(mockRes.body.data, undefined);
  });

  it('63. Shop A requesting orders with ?shopId=Shop_B: assertTenantMatch triggers 403 Forbidden', async () => {
    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: SHOP_A_DOMAIN,
        type: 'access',
      },
      query: { shopId: SHOP_B_ID },
    };
    const mockRes = createMockResponse();
    const mockNext = createMockNext(mockRes);

    await orderController.getOrders(mockReq, mockRes, mockNext);

    assert.strictEqual(mockRes.statusCode, HttpStatus.FORBIDDEN);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.TENANT_MISMATCH);
    assert.match(mockRes.body.message, /Cross-tenant data access is strictly prohibited/i);
  });

  it('64. Shop A requesting settings: strictly returns Shop A settings, never Shop B', async () => {
    await repository.updateSettings(SHOP_A_ID, { defaultLowStockThreshold: 12 });
    await repository.updateSettings(SHOP_B_ID, { defaultLowStockThreshold: 88 });

    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: SHOP_A_DOMAIN,
        type: 'access',
      },
      query: { shopId: SHOP_B_ID },
      body: { shopId: SHOP_B_ID },
    };
    const mockRes = createMockResponse();
    const mockNext = createMockNext(mockRes);

    await settingsController.getSettings(mockReq, mockRes, mockNext);

    assert.strictEqual(mockRes.statusCode, HttpStatus.OK);
    assert.strictEqual(mockRes.body.data.shopId, SHOP_A_ID);
    assert.strictEqual(mockRes.body.data.defaultLowStockThreshold, 12);
  });

  it('65. Shop A triggering Shopify sync: executes for authenticated Shop A, ignoring client shopId parameter', async () => {
    let targetShopIdPassedToService: string | null = null;
    const originalSyncAll = shopifyService.syncAll;
    shopifyService.syncAll = async (targetId: string) => {
      targetShopIdPassedToService = targetId;
      return { syncedCount: 3, productCount: 2, variantCount: 2, message: `Synced for ${targetId}` };
    };

    const mockReq: any = {
      shop: {
        shopId: SHOP_A_ID,
        shopDomain: SHOP_A_DOMAIN,
        type: 'access',
      },
      body: { shopId: SHOP_B_ID },
      query: { shopId: SHOP_B_ID },
    };
    const mockRes = createMockResponse();
    const mockNext = createMockNext(mockRes);

    try {
      await integrationController.triggerSync(mockReq, mockRes, mockNext);

      assert.strictEqual(mockRes.statusCode, HttpStatus.OK);
      assert.strictEqual(mockRes.body.success, true);
      assert.strictEqual(targetShopIdPassedToService, SHOP_A_ID);
      assert.notStrictEqual(targetShopIdPassedToService, SHOP_B_ID);
    } finally {
      shopifyService.syncAll = originalSyncAll;
    }
  });

  it('66. Uninstalled shop attempting API access: rejected with 401 TENANT_MISMATCH', async () => {
    await repository.upsertShop({
      ...shopA,
      uninstalledAt: new Date().toISOString(),
    });

    const accessToken = generateToken(
      { shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN },
      900,
      'access'
    );

    const mockReq: any = {
      headers: { authorization: `Bearer ${accessToken}` },
    };
    const mockRes = createMockResponse();
    let nextCalled = false;

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.TENANT_MISMATCH);
    assert.match(mockRes.body.message, /Store is uninstalled or nonexistent/i);
  });

  it('67. FIX 6: End-to-end middleware-to-controller pipeline: valid Bearer token enables inventory access for own shop', async () => {
    // Restore shopA to active
    await repository.upsertShop({
      ...shopA,
      uninstalledAt: undefined,
    });
    await repository.upsertVariants(SHOP_A_ID, [variantA]);

    const tokenA = generateToken({ shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN });
    const mockReq: any = {
      headers: { authorization: `Bearer ${tokenA}` },
      params: { id: variantA.id },
    };
    const mockRes = createMockResponse();

    let controllerPromise: Promise<void> | null = null;
    await authenticateToken(mockReq, mockRes, () => {
      controllerPromise = inventoryController.getInventoryItem(mockReq, mockRes);
    });
    if (controllerPromise) {
      await controllerPromise;
    }

    assert.strictEqual(mockRes.statusCode, HttpStatus.OK);
    assert.strictEqual(mockRes.body.success, true);
    assert.strictEqual(mockRes.body.data.id, variantA.id);
  });

  it('68. FIX 6: End-to-end middleware-to-controller pipeline: tampered Bearer token blocked at middleware before controller', async () => {
    let controllerReached = false;
    const tokenA = generateToken({ shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN });
    const tamperedToken = tokenA.slice(0, -6) + 'xxxxxx';

    const mockReq: any = {
      headers: { authorization: `Bearer ${tamperedToken}` },
      params: { id: variantA.id },
    };
    const mockRes = createMockResponse();

    let controllerPromise: Promise<void> | null = null;
    await authenticateToken(mockReq, mockRes, () => {
      controllerReached = true;
      controllerPromise = inventoryController.getInventoryItem(mockReq, mockRes);
    });
    if (controllerPromise) {
      await controllerPromise;
    }

    assert.strictEqual(controllerReached, false);
    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.AUTH_INVALID_TOKEN);
  });

  it('69. FIX 6: End-to-end middleware-to-controller pipeline: cross-tenant access with authentic token returns 404', async () => {
    await repository.upsertShop(shopA);
    await repository.upsertShop(shopB);
    await repository.upsertVariants(SHOP_B_ID, [variantB]);

    const tokenA = generateToken({ shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN });
    const mockReq: any = {
      headers: { authorization: `Bearer ${tokenA}` },
      params: { id: variantB.id },
    };
    const mockRes = createMockResponse();

    let controllerPromise: Promise<void> | null = null;
    await authenticateToken(mockReq, mockRes, () => {
      controllerPromise = inventoryController.getInventoryItem(mockReq, mockRes);
    });
    if (controllerPromise) {
      await controllerPromise;
    }

    assert.strictEqual(mockRes.statusCode, HttpStatus.NOT_FOUND);
    assert.strictEqual(mockRes.body.success, false);
    assert.strictEqual(mockRes.body.data, undefined);
  });

  it('70. FIX 6: End-to-end middleware-to-controller pipeline: cross-tenant query param returns 403 Forbidden', async () => {
    const tokenA = generateToken({ shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN });
    const mockReq: any = {
      headers: { authorization: `Bearer ${tokenA}` },
      query: { shopId: SHOP_B_ID },
    };
    const mockRes = createMockResponse();
    const mockNext = createMockNext(mockRes);

    let controllerPromise: Promise<void> | null = null;
    await authenticateToken(mockReq, mockRes, () => {
      controllerPromise = orderController.getOrders(mockReq, mockRes, mockNext);
    });
    if (controllerPromise) {
      await controllerPromise;
    }

    assert.strictEqual(mockRes.statusCode, HttpStatus.FORBIDDEN);
    assert.strictEqual(mockRes.body.errorCode, ErrorCode.TENANT_MISMATCH);
    assert.match(mockRes.body.message, /Cross-tenant data access is strictly prohibited/i);
  });
});

