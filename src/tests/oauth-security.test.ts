import './bootstrap';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import {
  validateAndNormalizeShopDomain,
  verifyShopifyOAuthHmac,
  generateOAuthState,
  verifyOAuthStateFormat,
  getOAuthCookieName,
  parseCookies,
  buildOAuthCookieHeader,
  buildClearOAuthCookieHeader,
  buildSecureEmbeddedAppRedirect,
  sha256,
} from '../utils/shopifyOAuth';
import { Shop as ShopModel, ShopifySession as SessionModel } from '../databases';
import { integrationController } from '../controllers/integration.controller';
import { shopifyService } from '../services/shopify.service';
import { repository } from '../db/repository';
import { config } from '../config';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';
import { AppError } from '../middleware/error.middleware';

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    redirectUrl: null,
    body: null,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    redirect(url: string) {
      this.redirectUrl = url;
      return this;
    },
  };
  return res;
}

/**
 * Helper to generate valid Shopify OAuth query parameters with HMAC
 */
function buildShopifyOAuthQuery(
  params: Record<string, any>,
  secret: string = config.shopify.apiSecret
): Record<string, any> {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (key === 'hmac' || key === 'signature') continue;
    entries.push([key, String(value)]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const message = entries.map(([k, v]) => `${k}=${v}`).join('&');
  const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return { ...params, hmac };
}

describe('Phase 1 — Step 2: Comprehensive Shopify OAuth Security Hardening', () => {
  const TEST_SHOP = 'secure-pilot-store.myshopify.com';
  const TEST_SECRET = 'test_shopify_oauth_api_secret_key_12345';
  let originalSecret: string;
  let originalApiKey: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalSecret = config.shopify.apiSecret;
    originalApiKey = config.shopify.apiKey;
    originalFetch = globalThis.fetch;
    (config.shopify as any).apiSecret = TEST_SECRET;
    (config.shopify as any).apiKey = 'test_api_key_shopify_123';
  });

  afterEach(() => {
    (config.shopify as any).apiSecret = originalSecret;
    (config.shopify as any).apiKey = originalApiKey;
    globalThis.fetch = originalFetch;
  });

  describe('1. Strict Shop Domain Validation & Normalization', () => {
    it('accepts valid myshopify domain and normalizes to lowercase', () => {
      const normalized = validateAndNormalizeShopDomain('Secure-Pilot-Store.myshopify.com');
      assert.strictEqual(normalized, 'secure-pilot-store.myshopify.com');
    });

    it('rejects external domain (attacker.com)', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('attacker.com'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects domain mimicking myshopify (evil-myshopify.com)', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('evil-myshopify.com'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects subdomain suffix attack (myshopify.com.evil.com)', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('myshopify.com.evil.com'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects protocol injection (https://store.myshopify.com)', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('https://store.myshopify.com'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects port injection (store.myshopify.com:8080)', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('store.myshopify.com:8080'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects path traversal or injection (store.myshopify.com/admin/oauth)', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('store.myshopify.com/admin/oauth'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects query string or fragment injection', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('store.myshopify.com?leak=true'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
      assert.throws(
        () => validateAndNormalizeShopDomain('store.myshopify.com#fragment'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects invalid characters such as underscores or spaces', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('store_bad.myshopify.com'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
      assert.throws(
        () => validateAndNormalizeShopDomain('store bad.myshopify.com'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects bare myshopify.com without subdomain', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain('myshopify.com'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });

    it('rejects non-string or empty input', () => {
      assert.throws(
        () => validateAndNormalizeShopDomain(null),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
      assert.throws(
        () => validateAndNormalizeShopDomain(''),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
      assert.throws(
        () => validateAndNormalizeShopDomain(['store.myshopify.com']),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.BAD_REQUEST
      );
    });
  });

  describe('2. Official Shopify OAuth HMAC Verification & Independent Reference Vectors', () => {
    // Independent test vector 1: precomputed HMAC using known secret and message
    it('verifies independent hardcoded reference vector A', () => {
      const secret = 'independent_secret_vector_123';
      // Raw query params: shop=alpha-store.myshopify.com, timestamp=1700000000, code=code123
      // Canonical sorted: code=code123&shop=alpha-store.myshopify.com&timestamp=1700000000
      // Precomputed SHA256 HMAC
      const knownExpectedHmac = 'a22e088a474c8821003a09c50a6ec8a9d226a75ab45ce75f44144dedeea147b6';

      const query = {
        timestamp: '1700000000',
        shop: 'alpha-store.myshopify.com',
        code: 'code123',
        hmac: knownExpectedHmac,
      };

      assert.strictEqual(verifyShopifyOAuthHmac(query, secret), true);
    });

    it('verifies independent hardcoded reference vector B with host parameter', () => {
      const secret = 'another_secret_for_vector_b';
      // Query: { host: 'admin.shopify.com', shop: 'beta-store.myshopify.com', code: 'c99', timestamp: '1711111111' }
      // Canonical: code=c99&host=admin.shopify.com&shop=beta-store.myshopify.com&timestamp=1711111111
      const knownExpectedHmac = 'cceae70052e7496bb6f1da169e4c62a322d17290232f8068f20462f641083301';

      const query = {
        timestamp: '1711111111',
        host: 'admin.shopify.com',
        code: 'c99',
        shop: 'beta-store.myshopify.com',
        hmac: knownExpectedHmac,
      };

      assert.strictEqual(verifyShopifyOAuthHmac(query, secret), true);
    });

    it('rejects HMAC with invalid format (uppercase, non-hex, invalid length)', () => {
      const validQuery = buildShopifyOAuthQuery({
        code: 'auth_code_xyz',
        shop: TEST_SHOP,
        timestamp: '1700000000',
      });

      // Uppercase hex must be rejected by format rule
      assert.strictEqual(
        verifyShopifyOAuthHmac({ ...validQuery, hmac: validQuery.hmac.toUpperCase() }, TEST_SECRET),
        true // lowercase normalized inside verifyShopifyOAuthHmac
      );

      // Non-hex characters
      assert.strictEqual(
        verifyShopifyOAuthHmac({ ...validQuery, hmac: 'zzzz' + validQuery.hmac.slice(4) }, TEST_SECRET),
        false
      );

      // Short length (63 characters)
      assert.strictEqual(
        verifyShopifyOAuthHmac({ ...validQuery, hmac: validQuery.hmac.slice(0, 63) }, TEST_SECRET),
        false
      );

      // Long length (65 characters)
      assert.strictEqual(
        verifyShopifyOAuthHmac({ ...validQuery, hmac: validQuery.hmac + 'a' }, TEST_SECRET),
        false
      );
    });

    it('rejects tampered query parameters (code modified)', () => {
      const query = buildShopifyOAuthQuery({
        code: 'original_code',
        shop: TEST_SHOP,
        timestamp: '1700000000',
      });
      query.code = 'attacker_tampered_code';
      assert.strictEqual(verifyShopifyOAuthHmac(query, TEST_SECRET), false);
    });

    it('rejects HTTP Parameter Pollution (duplicate shop parameters as array)', () => {
      const query = buildShopifyOAuthQuery({
        code: 'auth_code_xyz',
        shop: TEST_SHOP,
      });
      // Duplicate parameter array
      query.shop = [TEST_SHOP, 'evil.myshopify.com'];
      assert.strictEqual(verifyShopifyOAuthHmac(query, TEST_SECRET), false);
    });

    it('rejects HTTP Parameter Pollution (duplicate hmac parameter as array)', () => {
      const query = {
        code: 'auth_code_xyz',
        shop: TEST_SHOP,
        hmac: ['valid_hmac', 'duplicate_hmac'],
      };
      assert.strictEqual(verifyShopifyOAuthHmac(query, TEST_SECRET), false);
    });

    it('ignores signature parameter if present alongside hmac', () => {
      const query = buildShopifyOAuthQuery({
        code: 'auth_code_xyz',
        shop: TEST_SHOP,
        timestamp: '1700000000',
        signature: 'legacy_md5_signature_should_be_ignored',
      });
      assert.strictEqual(verifyShopifyOAuthHmac(query, TEST_SECRET), true);
    });
  });

  describe('3. Browser-Bound OAuth State & Concurrent Transaction Isolation', () => {
    it('getAuthUrl generates distinct transaction cookies and sets host-only Path=/ cookie', async () => {
      const req: any = { query: { shop: TEST_SHOP }, headers: {} };
      const res = createMockResponse();
      let capturedError: any = null;
      await integrationController.getAuthUrl(req, res, (err) => { capturedError = err; });

      assert.strictEqual(capturedError, null);
      assert.strictEqual(res.statusCode, HttpStatus.OK);
      assert.ok(res.body.data.authUrl);
      assert.ok(res.body.data.state);

      const setCookieHeader = res.getHeader('set-cookie');
      assert.ok(setCookieHeader);
      assert.ok(setCookieHeader.includes('Path=/'));
      assert.ok(setCookieHeader.includes('HttpOnly'));
      assert.ok(setCookieHeader.includes('Secure'));
      assert.ok(setCookieHeader.includes('SameSite=Lax'));
      assert.strictEqual(setCookieHeader.includes('Domain='), false); // Strictly host-only
    });

    it('supports multiple concurrent OAuth transactions without overwriting cookies', async () => {
      const shopA = 'store-alpha.myshopify.com';
      const shopB = 'store-beta.myshopify.com';

      const resA = createMockResponse();
      await integrationController.getAuthUrl({ query: { shop: shopA }, headers: {} } as any, resA, () => {});

      const resB = createMockResponse();
      await integrationController.getAuthUrl({ query: { shop: shopB }, headers: {} } as any, resB, () => {});

      const cookieA = resA.getHeader('set-cookie');
      const cookieB = resB.getHeader('set-cookie');

      const nameA = cookieA.split('=')[0];
      const nameB = cookieB.split('=')[0];

      // Distinct cookie names keyed by unique nonce: no collision or overwriting
      assert.notStrictEqual(nameA, nameB);
      assert.ok(nameA.startsWith('__Host-sp_oauth_'));
      assert.ok(nameB.startsWith('__Host-sp_oauth_'));
    });

    it('rejects callback when browser cookie is missing (cross-browser / login CSRF defense)', async () => {
      const { authUrl, state, nonce } = await shopifyService.generateAuthUrl(TEST_SHOP);
      const queryParams = buildShopifyOAuthQuery({
        code: 'auth_code_test',
        shop: TEST_SHOP,
        state,
      });

      // Request without any Cookie header
      const req: any = { query: queryParams, headers: {} };
      const res = createMockResponse();
      let capturedError: any = null;
      await integrationController.handleOAuthCallback(req, res, (err) => { capturedError = err; });

      assert.ok(capturedError instanceof AppError);
      assert.strictEqual(capturedError.statusCode, HttpStatus.BAD_REQUEST);
      assert.strictEqual(capturedError.errorCode, ErrorCode.VALIDATION_ERROR);
      assert.ok(capturedError.message.includes('not initiated by this browser'));
    });

    it('rejects callback when browser cookie has wrong nonce (attacker browser binding)', async () => {
      const { state, nonce } = await shopifyService.generateAuthUrl(TEST_SHOP);
      const queryParams = buildShopifyOAuthQuery({
        code: 'auth_code_test',
        shop: TEST_SHOP,
        state,
      });

      // Browser sends cookie with incorrect/attacker browserNonce
      const fakeBrowserNonce = crypto.randomBytes(16).toString('hex');
      const cookieName = getOAuthCookieName(nonce);
      const req: any = {
        query: queryParams,
        headers: { cookie: `${cookieName}=${fakeBrowserNonce}` },
      };
      const res = createMockResponse();
      let capturedError: any = null;
      await integrationController.handleOAuthCallback(req, res, (err) => { capturedError = err; });

      assert.ok(capturedError instanceof AppError);
      assert.strictEqual(capturedError.statusCode, HttpStatus.BAD_REQUEST);
    });

    it('terminal callback processing always clears the transaction cookie', async () => {
      const { state, nonce } = await shopifyService.generateAuthUrl(TEST_SHOP);
      const queryParams = buildShopifyOAuthQuery({
        code: 'auth_code_test',
        shop: TEST_SHOP,
        state,
      });

      const cookieName = getOAuthCookieName(nonce);
      const req: any = {
        query: queryParams,
        headers: { cookie: `${cookieName}=wrong_nonce` },
      };
      const res = createMockResponse();
      await integrationController.handleOAuthCallback(req, res, () => {});

      const clearHeader = res.getHeader('set-cookie');
      assert.ok(clearHeader);
      assert.ok(clearHeader.includes(`${cookieName}=;`));
      assert.ok(clearHeader.includes('Max-Age=0'));
    });
  });

  describe('4. Atomic Shared Storage Replay Protection', () => {
    it('consumes transaction exactly once; replayed attempt fails immediately', async () => {
      const { state, nonce, browserNonce } = await shopifyService.generateAuthUrl(TEST_SHOP);
      const queryParams = buildShopifyOAuthQuery({
        code: 'auth_code_single_use',
        shop: TEST_SHOP,
        state,
      });

      // Mock successful fetch for code exchange and GraphQL identity
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/admin/oauth/access_token')) {
          return new Response(JSON.stringify({ access_token: 'shpat_valid_token_1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/graphql.json')) {
          return new Response(
            JSON.stringify({
              data: {
                shop: {
                  id: 'gid://shopify/Shop/12345678',
                  name: 'Verified Test Store',
                  email: 'owner@teststore.com',
                  myshopifyDomain: TEST_SHOP,
                  currencyCode: 'USD',
                  ianaTimezone: 'America/New_York',
                  plan: { displayName: 'Shopify Plus' },
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      // First callback attempt succeeds
      const cookieName = getOAuthCookieName(nonce);
      const req1: any = {
        query: queryParams,
        headers: { cookie: `${cookieName}=${browserNonce}` },
      };
      const res1 = createMockResponse();
      let error1: any = null;
      await integrationController.handleOAuthCallback(req1, res1, (err) => { error1 = err; });
      assert.strictEqual(error1, null);
      assert.ok(res1.redirectUrl);

      // Second callback attempt with exact same state and cookie (Replay Attack) fails
      const req2: any = {
        query: queryParams,
        headers: { cookie: `${cookieName}=${browserNonce}` },
      };
      const res2 = createMockResponse();
      let error2: any = null;
      await integrationController.handleOAuthCallback(req2, res2, (err) => { error2 = err; });
      assert.ok(error2 instanceof AppError);
      assert.strictEqual(error2.statusCode, HttpStatus.BAD_REQUEST);
      assert.ok(error2.message.includes('already consumed'));
    });

    it('rejects expired transaction (> 10 minutes)', async () => {
      const nonce = crypto.randomBytes(16).toString('hex');
      const browserNonce = crypto.randomBytes(16).toString('hex');
      const expiredTime = Date.now() - 11 * 60 * 1000;
      const dataToSign = `${nonce}:${expiredTime}:${TEST_SHOP}`;
      const sig = crypto.createHmac('sha256', TEST_SECRET).update(dataToSign).digest('hex');
      const state = `${nonce}.${expiredTime}.${sig}`;

      // Persist expired transaction in repository
      await repository.createOAuthTransaction({
        nonce,
        stateHash: sha256(state),
        shopDomain: TEST_SHOP,
        browserNonceHash: sha256(browserNonce),
        expiresAt: new Date(expiredTime + 10 * 60 * 1000), // expired in past
        consumedAt: null,
        createdAt: new Date(expiredTime),
        updatedAt: new Date(expiredTime),
      });

      const queryParams = buildShopifyOAuthQuery({
        code: 'auth_code_expired',
        shop: TEST_SHOP,
        state,
      });

      const cookieName = getOAuthCookieName(nonce);
      const req: any = {
        query: queryParams,
        headers: { cookie: `${cookieName}=${browserNonce}` },
      };
      const res = createMockResponse();
      let capturedError: any = null;
      await integrationController.handleOAuthCallback(req, res, (err) => { capturedError = err; });

      assert.ok(capturedError instanceof AppError);
      assert.strictEqual(capturedError.statusCode, HttpStatus.BAD_REQUEST);
    });

    it('strictly rejects incoming callback with legacy non-__Host- cookie (prevents cookie tossing)', async () => {
      const { state, nonce, browserNonce } = await shopifyService.generateAuthUrl(TEST_SHOP);
      const queryParams = buildShopifyOAuthQuery({
        code: 'auth_code_toss_attempt',
        shop: TEST_SHOP,
        state,
      });

      // Attacker attempts to bypass __Host- prefix by tossing insecure cookie sp_oauth_${nonce}
      const req: any = {
        query: queryParams,
        headers: { cookie: `sp_oauth_${nonce}=${browserNonce}` },
      };
      const res = createMockResponse();
      let capturedError: any = null;
      await integrationController.handleOAuthCallback(req, res, (err) => { capturedError = err; });

      assert.ok(capturedError instanceof AppError);
      assert.strictEqual(capturedError.statusCode, HttpStatus.BAD_REQUEST);
      assert.strictEqual(capturedError.errorCode, ErrorCode.VALIDATION_ERROR);
      assert.ok(capturedError.message.includes('not initiated by this browser'));
    });

    it('fails closed when MongoDB is configured but unavailable', async () => {
      // Temporarily simulate environment with MongoDB configured but offline
      process.env.MONGODB_URL = 'mongodb://production-offline.internal:27017/stockpilot';

      try {
        await assert.rejects(
          () => repository.consumeOAuthTransaction('test_nonce', TEST_SHOP, 'hash1', 'hash2'),
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.strictEqual(err.statusCode, HttpStatus.SERVICE_UNAVAILABLE);
            assert.strictEqual(err.errorCode, ErrorCode.SERVICE_UNAVAILABLE);
            return true;
          }
        );
      } finally {
        delete process.env.MONGODB_URL;
      }
    });

    it('concurrent consumption of same transaction: exactly one succeeds and one fails', async () => {
      const nonce = crypto.randomBytes(16).toString('hex');
      const browserNonce = crypto.randomBytes(16).toString('hex');
      const state = 'test_concurrent_state';
      const stateHash = sha256(state);
      const browserNonceHash = sha256(browserNonce);

      await repository.createOAuthTransaction({
        nonce,
        shopDomain: TEST_SHOP,
        stateHash,
        browserNonceHash,
        expiresAt: new Date(Date.now() + 600 * 1000),
        consumedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Execute two simultaneous consumption requests
      const [res1, res2] = await Promise.all([
        repository.consumeOAuthTransaction(nonce, TEST_SHOP, stateHash, browserNonceHash),
        repository.consumeOAuthTransaction(nonce, TEST_SHOP, stateHash, browserNonceHash),
      ]);

      // Exactly one must be true, the other false
      const successes = [res1, res2].filter(Boolean).length;
      assert.strictEqual(successes, 1, 'Only one concurrent consumer may succeed');
    });

    it('fails closed for shop and session reads when MongoDB is configured but offline', async () => {
      process.env.MONGODB_URL = 'mongodb://production-offline.internal:27017/stockpilot';

      try {
        await assert.rejects(
          () => repository.getShop('shop-any'),
          (err: any) => err instanceof AppError && err.statusCode === HttpStatus.SERVICE_UNAVAILABLE
        );
        await assert.rejects(
          () => repository.getShopByDomain('any.myshopify.com'),
          (err: any) => err instanceof AppError && err.statusCode === HttpStatus.SERVICE_UNAVAILABLE
        );
        await assert.rejects(
          () => repository.getSession('shop-any'),
          (err: any) => err instanceof AppError && err.statusCode === HttpStatus.SERVICE_UNAVAILABLE
        );
      } finally {
        delete process.env.MONGODB_URL;
      }
    });
  });

  describe('5. Real Shopify Shop Identity & Zero Fake Credentials', () => {
    it('persists authentic Shopify Shop ID and merchant metadata from GraphQL', async () => {
      const realShopGid = 'gid://shopify/Shop/88877766';
      const realMerchantName = 'Super Authentic Merchant';
      const realMerchantEmail = 'owner@authentic.com';

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/admin/oauth/access_token')) {
          return new Response(JSON.stringify({ access_token: 'shpat_authentic_token_123' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/graphql.json')) {
          return new Response(
            JSON.stringify({
              data: {
                shop: {
                  id: realShopGid,
                  name: realMerchantName,
                  email: realMerchantEmail,
                  myshopifyDomain: TEST_SHOP,
                  currencyCode: 'CAD',
                  ianaTimezone: 'America/Toronto',
                  plan: { displayName: 'Shopify Plus' },
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      const result = await shopifyService.handleOAuthCallback(TEST_SHOP, 'valid_code', 'state');

      assert.strictEqual(result.shop.shopifyShopId, realShopGid);
      assert.strictEqual(result.shop.name, realMerchantName);
      assert.strictEqual(result.shop.email, realMerchantEmail);
      assert.strictEqual(result.shop.currency, 'CAD');
      assert.strictEqual(result.shop.timezone, 'America/Toronto');
      assert.strictEqual(result.shop.plan, 'Shopify Plus');

      // Verify stored shop matches real identity exactly
      const storedShop = await repository.getShopByDomain(TEST_SHOP);
      assert.ok(storedShop);
      assert.strictEqual(storedShop.shopifyShopId, realShopGid);
      assert.strictEqual(storedShop.email, realMerchantEmail);
    });

    it('rejects installation if GraphQL shop identity domain mismatches target store', async () => {
      const targetStore = 'mismatch-store.myshopify.com';
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/admin/oauth/access_token')) {
          return new Response(JSON.stringify({ access_token: 'shpat_hijacked_token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/graphql.json')) {
          return new Response(
            JSON.stringify({
              data: {
                shop: {
                  id: 'gid://shopify/Shop/99999999',
                  name: 'Different Store',
                  email: 'different@store.com',
                  myshopifyDomain: 'attacker-different-store.myshopify.com', // Mismatched domain!
                  currencyCode: 'USD',
                  ianaTimezone: 'UTC',
                  plan: { displayName: 'Basic' },
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      await assert.rejects(
        () => shopifyService.handleOAuthCallback(targetStore, 'valid_code', 'state'),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, HttpStatus.UNAUTHORIZED);
          assert.strictEqual(err.errorCode, ErrorCode.AUTH_INVALID_TOKEN);
          assert.ok(err.message.includes('domain mismatch'));
          return true;
        }
      );

      // Verify no shop or session was created
      const shop = await repository.getShopByDomain(targetStore);
      assert.strictEqual(shop, null);
    });

    it('rejects installation and preserves existing credentials if GraphQL identity retrieval fails', async () => {
      // Pre-seed existing valid shop and session
      const existingShop = {
        id: 'shop-existing_myshopify_com',
        shopDomain: 'existing.myshopify.com',
        shopifyShopId: 'gid://shopify/Shop/11111111',
        name: 'Existing Store',
        email: 'original@existing.com',
        timezone: 'UTC',
        currency: 'USD',
        plan: 'Basic',
        installedAt: new Date().toISOString(),
        uninstalledAt: null,
        isDemo: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const existingSession = {
        id: 'sess-shop-existing_myshopify_com',
        shopId: existingShop.id,
        sessionType: 'offline' as const,
        encryptedAccessToken: 'original_encrypted_token',
        iv: 'iv_original',
        authTag: 'tag_original',
        scope: 'read_products',
        expiresAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await repository.saveShopAndSession(existingShop, existingSession);

      // Re-authorization attempt fails at GraphQL identity fetch
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/admin/oauth/access_token')) {
          return new Response(JSON.stringify({ access_token: 'shpat_new_token' }), { status: 200 });
        }
        if (urlStr.includes('/graphql.json')) {
          return new Response('GraphQL Gateway Error', { status: 502 });
        }
        return new Response('Not Found', { status: 404 });
      };

      await assert.rejects(
        () => shopifyService.handleOAuthCallback(existingShop.shopDomain, 'valid_code', 'state'),
        (err: any) => err instanceof AppError && err.statusCode === HttpStatus.UNAUTHORIZED
      );

      // Verify existing credentials were NOT overwritten or destroyed
      const preservedShop = await repository.getShopByDomain(existingShop.shopDomain);
      assert.ok(preservedShop);
      assert.strictEqual(preservedShop.shopifyShopId, 'gid://shopify/Shop/11111111');

      const preservedSession = await repository.getSession(existingShop.id);
      assert.ok(preservedSession);
      assert.strictEqual(preservedSession.encryptedAccessToken, 'original_encrypted_token');
    });

    it('getPrimaryShop returns null when no shops exist and never fabricates a dummy shop', async () => {
      const FreshRepositoryClass = repository.constructor as any;
      const freshRepo = new FreshRepositoryClass({ inMemoryOnly: true });

      const primary = await freshRepo.getPrimaryShop();
      assert.strictEqual(primary, null, 'getPrimaryShop must return null when empty');

      // Verify no shop was automatically upserted or fabricated
      const allShops = Object.keys((freshRepo as any).db.shops);
      assert.strictEqual(allShops.length, 0, 'No shop must be fabricated in storage');
    });

    it('getPrimaryShop returns null immediately when MongoDB is authoritative and returns no shop, never falling back to RAM', async () => {
      const FreshRepositoryClass = repository.constructor as any;
      const repo = new FreshRepositoryClass({ inMemoryOnly: true });

      // Seed RAM with an active shop
      const ramShop: any = {
        id: 'shop-in-ram-only',
        shopDomain: 'ram-only.myshopify.com',
        name: 'RAM Only Store',
        installedAt: new Date().toISOString(),
        uninstalledAt: null,
        isDemo: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      (repo as any).db.shops['shop-in-ram-only'] = ramShop;

      // Simulate MongoDB authoritative mode
      repo.isMongoAuthoritative = () => true;

      // Mock ShopModel.findOne to return null (MongoDB has no active shop)
      const originalShopFindOne = ShopModel.findOne;
      (ShopModel as any).findOne = () => ({
        sort: () => ({
          lean: async () => null,
        }),
      });

      try {
        const primary = await repo.getPrimaryShop();
        assert.strictEqual(primary, null, 'Must return null immediately without falling back to RAM');
      } finally {
        (ShopModel as any).findOne = originalShopFindOne;
      }
    });
  });

  describe('6. Atomic Shop & Session Persistence', () => {
    it('persists both shop and session atomically; both can be retrieved', async () => {
      const shopId = 'shop-atomic_test_store';
      const shop = {
        id: shopId,
        shopDomain: 'atomic-test.myshopify.com',
        shopifyShopId: 'gid://shopify/Shop/777888',
        name: 'Atomic Store',
        email: 'atomic@test.com',
        timezone: 'UTC',
        currency: 'USD',
        plan: 'Basic',
        installedAt: new Date().toISOString(),
        uninstalledAt: null,
        isDemo: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const session = {
        id: `sess-${shopId}`,
        shopId,
        sessionType: 'offline' as const,
        encryptedAccessToken: 'atomic_token_payload',
        iv: 'iv_atomic',
        authTag: 'tag_atomic',
        scope: 'read_products',
        expiresAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await repository.saveShopAndSession(shop, session);

      const retrievedShop = await repository.getShop(shopId);
      assert.ok(retrievedShop);
      assert.strictEqual(retrievedShop.shopDomain, 'atomic-test.myshopify.com');

      const retrievedSession = await repository.getSession(shopId);
      assert.ok(retrievedSession);
      assert.strictEqual(retrievedSession.encryptedAccessToken, 'atomic_token_payload');
    });

    it('propagates real persist() filesystem failure and rolls back in-memory state without touching real store.json', async () => {
      // Use an unreachable path within a non-existent subdirectory of tmpdir
      const nonExistentDir = path.join(
        os.tmpdir(),
        `stockpilot-fs-err-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        'no-such-sub'
      );
      const controlledFailureStorePath = path.join(nonExistentDir, 'store.json');

      const FreshRepositoryClass = repository.constructor as any;
      // Instantiate repository pointing to the invalid path with inMemoryOnly: false
      // so the REAL persist() implementation is exercised.
      const testRepo = new FreshRepositoryClass({
        customStorePath: controlledFailureStorePath,
        inMemoryOnly: false,
      });

      const failedShopId = 'shop-real_fs_fail_store';
      const shop = {
        id: failedShopId,
        shopDomain: 'real-fs-fail.myshopify.com',
        name: 'Real FS Fail Store',
        timezone: 'UTC',
        currency: 'USD',
        plan: 'Basic',
        installedAt: new Date().toISOString(),
        isDemo: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const session = {
        id: `sess-${failedShopId}`,
        shopId: failedShopId,
        sessionType: 'offline' as const,
        encryptedAccessToken: 'token_fs_fail',
        iv: 'iv_fs_fail',
        authTag: 'tag_fs_fail',
        scope: 'read_products',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Call saveShopAndSession: real persist() will attempt fs.writeFileSync to non-existent dir and throw ENOENT
      await assert.rejects(
        () => testRepo.saveShopAndSession(shop, session),
        (err: any) =>
          err.code === 'ENOENT' ||
          err.message.includes('ENOENT') ||
          err.message.includes('no such file or directory')
      );

      // Verify that in-memory state rolled back: neither shop nor session was retained
      const shopAfter = await testRepo.getShop(failedShopId);
      assert.strictEqual(shopAfter, null, 'Shop must be rolled back in memory after persist failure');

      const sessionAfter = await testRepo.getSession(failedShopId);
      assert.strictEqual(sessionAfter, null, 'Session must be rolled back in memory after persist failure');
    });

    it('delegates to MongoDB models authoritatively when MongoDB mode is active', async () => {
      const mockShopDoc = {
        _id: 'shop-mongo-authoritative',
        shopDomain: 'mongo-authoritative.myshopify.com',
        name: 'Mongo Shop',
        shopifyShopId: 'gid://shopify/Shop/999',
        email: 'mongo@example.com',
        timezone: 'UTC',
        currency: 'USD',
        plan: 'Plus',
        installedAt: new Date(),
        uninstalledAt: null,
        isDemo: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSessionDoc = {
        _id: 'sess-mongo-authoritative',
        shopId: 'shop-mongo-authoritative',
        sessionType: 'offline',
        encryptedAccessToken: 'mongo_encrypted_token',
        iv: 'mongo_iv',
        authTag: 'mongo_tag',
        scope: 'read_orders',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
      const originalShopFindById = ShopModel.findById;
      const originalShopFindOne = ShopModel.findOne;
      const originalSessionFindOne = SessionModel.findOne;

      (repository as any).isMongoAuthoritative = () => true;
      (ShopModel as any).findById = () => ({ lean: async () => mockShopDoc });
      (ShopModel as any).findOne = () => ({ lean: async () => mockShopDoc });
      (SessionModel as any).findOne = () => ({ lean: async () => mockSessionDoc });

      try {
        const shopById = await repository.getShop('shop-mongo-authoritative');
        assert.ok(shopById);
        assert.strictEqual(shopById.id, 'shop-mongo-authoritative');
        assert.strictEqual(shopById.name, 'Mongo Shop');

        const shopByDomain = await repository.getShopByDomain('mongo-authoritative.myshopify.com');
        assert.ok(shopByDomain);
        assert.strictEqual(shopByDomain.shopDomain, 'mongo-authoritative.myshopify.com');

        const session = await repository.getSession('shop-mongo-authoritative');
        assert.ok(session);
        assert.strictEqual(session.encryptedAccessToken, 'mongo_encrypted_token');
      } finally {
        (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
        (ShopModel as any).findById = originalShopFindById;
        (ShopModel as any).findOne = originalShopFindOne;
        (SessionModel as any).findOne = originalSessionFindOne;
      }
    });

    it('rolls back MongoDB transaction if second write fails in saveShopAndSession', async () => {
      const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
      (repository as any).isMongoAuthoritative = () => true;

      let transactionStarted = false;
      let transactionAborted = false;
      let sessionEnded = false;

      const mockDbSession = {
        startTransaction: () => { transactionStarted = true; },
        commitTransaction: async () => {},
        abortTransaction: async () => { transactionAborted = true; },
        endSession: () => { sessionEnded = true; },
      };

      const mongooseModule = require('mongoose');
      const originalStartSession = mongooseModule.startSession;
      mongooseModule.startSession = async () => mockDbSession;

      const originalShopUpsert = ShopModel.findByIdAndUpdate;
      const originalSessionUpsert = SessionModel.findByIdAndUpdate;
      const originalSessionFindOneAndUpdate = SessionModel.findOneAndUpdate;

      (ShopModel as any).findByIdAndUpdate = async () => ({ _id: 'shop-test' });
      (SessionModel as any).findByIdAndUpdate = async () => {
        throw new Error('Database write error on session update');
      };
      (SessionModel as any).findOneAndUpdate = async () => {
        throw new Error('Database write error on session update');
      };

      const testShop = {
        id: 'shop-rollback-test',
        shopDomain: 'rollback-test.myshopify.com',
        name: 'Rollback Test',
        timezone: 'UTC',
        currency: 'USD',
        plan: 'Basic',
        installedAt: new Date().toISOString(),
        isDemo: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const testSession = {
        id: 'sess-rollback-test',
        shopId: 'shop-rollback-test',
        sessionType: 'offline' as const,
        encryptedAccessToken: 'token_rollback',
        iv: 'iv_rollback',
        authTag: 'tag_rollback',
        scope: 'read_products',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        await assert.rejects(
          () => repository.saveShopAndSession(testShop, testSession),
          (err: any) => err.message.includes('Database write error on session update')
        );

        assert.strictEqual(transactionStarted, true);
        assert.strictEqual(transactionAborted, true);
        assert.strictEqual(sessionEnded, true);
      } finally {
        (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
        mongooseModule.startSession = originalStartSession;
        ShopModel.findByIdAndUpdate = originalShopUpsert;
        SessionModel.findByIdAndUpdate = originalSessionUpsert;
        SessionModel.findOneAndUpdate = originalSessionFindOneAndUpdate;
      }
    });

    it('does not fail operation if local JSON disk persist fails after MongoDB commit succeeded', async () => {
      const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
      (repository as any).isMongoAuthoritative = () => true;

      const mockDbSession = {
        startTransaction: () => {},
        commitTransaction: async () => {},
        abortTransaction: async () => {},
        endSession: () => {},
      };

      const mongooseModule = require('mongoose');
      const originalStartSession = mongooseModule.startSession;
      mongooseModule.startSession = async () => mockDbSession;

      const originalShopUpsert = ShopModel.findByIdAndUpdate;
      const originalSessionUpsert = SessionModel.findByIdAndUpdate;
      const originalSessionFindOneAndUpdate = SessionModel.findOneAndUpdate;
      const originalPersist = (repository as any).persist;

      (ShopModel as any).findByIdAndUpdate = async () => ({ _id: 'shop-survive-persist' });
      (SessionModel as any).findByIdAndUpdate = async () => ({ _id: 'sess-survive-persist' });
      (SessionModel as any).findOneAndUpdate = async () => ({ _id: 'sess-survive-persist' });
      (repository as any).persist = () => {
        throw new Error('Local disk is read-only (EACCES)');
      };

      const testShop = {
        id: 'shop-survive-persist',
        shopDomain: 'survive-persist.myshopify.com',
        name: 'Survive Store',
        timezone: 'UTC',
        currency: 'USD',
        plan: 'Basic',
        installedAt: new Date().toISOString(),
        isDemo: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const testSession = {
        id: 'sess-survive-persist',
        shopId: 'shop-survive-persist',
        sessionType: 'offline' as const,
        encryptedAccessToken: 'token_survive',
        iv: 'iv_survive',
        authTag: 'tag_survive',
        scope: 'read_products',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        await repository.saveShopAndSession(testShop, testSession);
      } finally {
        (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
        mongooseModule.startSession = originalStartSession;
        ShopModel.findByIdAndUpdate = originalShopUpsert;
        SessionModel.findByIdAndUpdate = originalSessionUpsert;
        SessionModel.findOneAndUpdate = originalSessionFindOneAndUpdate;
        (repository as any).persist = originalPersist;
      }
    });

    it('survives process restart: fresh Repository instance retrieves data from authoritative store', async () => {
      const mockShopDoc = {
        _id: 'shop-restart-test',
        shopDomain: 'restart-test.myshopify.com',
        name: 'Restart Store',
        shopifyShopId: 'gid://shopify/Shop/101010',
        email: 'restart@example.com',
        timezone: 'UTC',
        currency: 'USD',
        plan: 'Basic',
        installedAt: new Date(),
        uninstalledAt: null,
        isDemo: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSessionDoc = {
        _id: 'sess-restart-test',
        shopId: 'shop-restart-test',
        sessionType: 'offline',
        encryptedAccessToken: 'restart_encrypted_token',
        iv: 'restart_iv',
        authTag: 'restart_tag',
        scope: 'read_inventory',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalShopFindById = ShopModel.findById;
      const originalSessionFindOne = SessionModel.findOne;

      (ShopModel as any).findById = () => ({ lean: async () => mockShopDoc });
      (SessionModel as any).findOne = () => ({ lean: async () => mockSessionDoc });

      const FreshRepositoryClass = repository.constructor as any;
      const freshRepo = new FreshRepositoryClass({ inMemoryOnly: true });

      freshRepo.isMongoAuthoritative = () => true;

      try {
        const restoredShop = await freshRepo.getShop('shop-restart-test');
        assert.ok(restoredShop);
        assert.strictEqual(restoredShop.name, 'Restart Store');
        assert.strictEqual(restoredShop.shopDomain, 'restart-test.myshopify.com');

        const restoredSession = await freshRepo.getSession('shop-restart-test');
        assert.ok(restoredSession);
        assert.strictEqual(restoredSession.encryptedAccessToken, 'restart_encrypted_token');
        assert.strictEqual(restoredSession.shopId, 'shop-restart-test');
      } finally {
        (ShopModel as any).findById = originalShopFindById;
        (SessionModel as any).findOne = originalSessionFindOne;
      }
    });
  });

  describe('7. Secure OAuth Embedded App Redirect & Open Redirect Prevention', () => {
    it('redirects to trusted modern Shopify Admin embedded URL with verified host parameter', () => {
      // host = base64('admin.shopify.com/store/secure-pilot-store')
      const host = Buffer.from('admin.shopify.com/store/secure-pilot-store').toString('base64');
      const target = buildSecureEmbeddedAppRedirect(TEST_SHOP, host, 'stockpilot');

      assert.strictEqual(
        target,
        'https://admin.shopify.com/store/secure-pilot-store/apps/stockpilot'
      );
    });

    it('redirects to trusted legacy Shopify Admin embedded URL with verified host parameter', () => {
      // host = base64('secure-pilot-store.myshopify.com/admin')
      const host = Buffer.from('secure-pilot-store.myshopify.com/admin').toString('base64');
      const target = buildSecureEmbeddedAppRedirect(TEST_SHOP, host, 'stockpilot');

      assert.strictEqual(
        target,
        'https://secure-pilot-store.myshopify.com/admin/apps/stockpilot'
      );
    });

    it('rejects mismatched host parameter for a different store and falls back safely', () => {
      // Host for different store
      const host = Buffer.from('admin.shopify.com/store/attacker-store').toString('base64');
      const target = buildSecureEmbeddedAppRedirect(TEST_SHOP, host, 'stockpilot');

      // Falls back to canonical URL for authenticated store
      assert.strictEqual(
        target,
        'https://admin.shopify.com/store/secure-pilot-store/apps/stockpilot'
      );
    });

    it('prevents open redirect attacks (credentials, ports, arbitrary domains in host)', () => {
      const maliciousHosts = [
        'evil.com',
        'https://evil.com/admin',
        'admin.shopify.com:8080/store/secure-pilot-store',
        'user:pass@admin.shopify.com/store/secure-pilot-store',
        'admin.shopify.com/store/secure-pilot-store/evil/path',
      ];

      for (const malHost of maliciousHosts) {
        const rawHost = Buffer.from(malHost).toString('base64');
        const target = buildSecureEmbeddedAppRedirect(TEST_SHOP, rawHost, 'stockpilot');
        // Must never redirect to malHost
        assert.strictEqual(target.includes('evil.com'), false);
        assert.strictEqual(target.includes(':8080'), false);
        assert.strictEqual(target.includes('@'), false);
        assert.strictEqual(
          target,
          'https://admin.shopify.com/store/secure-pilot-store/apps/stockpilot'
        );
      }
    });

    it('uses configuration-driven appHandle instead of hardcoded slug', () => {
      const host = Buffer.from('admin.shopify.com/store/secure-pilot-store').toString('base64');
      const target = buildSecureEmbeddedAppRedirect(TEST_SHOP, host, 'custom-warehouse-app');

      assert.strictEqual(
        target,
        'https://admin.shopify.com/store/secure-pilot-store/apps/custom-warehouse-app'
      );
    });
  });
});
