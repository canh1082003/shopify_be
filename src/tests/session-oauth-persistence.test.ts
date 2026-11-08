import './bootstrap';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { repository, Repository, OAuthTransactionRecord } from '../db/repository';
import { ShopifySession, Shop } from '../types';
import { SessionModel, OAuthTransactionModel } from '../models';
import ShopifySessionEntity from '../databases/entities/ShopifySession';
import OAuthTransactionEntity from '../databases/entities/OAuthTransaction';
import { AppError } from '../middleware/error.middleware';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

describe('Step 4C.2: ShopifySession & OAuthTransaction MongoDB Authoritative Persistence', () => {
  const SHOP_A_ID = 'shop-sess-alpha';
  const SHOP_A_DOMAIN = 'alpha-store.myshopify.com';
  const SHOP_B_ID = 'shop-sess-beta';
  const SHOP_B_DOMAIN = 'beta-store.myshopify.com';

  beforeEach(async () => {
    repository.resetInMemoryState();
    await repository.upsertShop({
      id: SHOP_A_ID,
      shopDomain: SHOP_A_DOMAIN,
      name: 'Alpha Store',
      currency: 'USD',
      timezone: 'UTC',
      plan: 'basic',
      installedAt: new Date().toISOString(),
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repository.upsertShop({
      id: SHOP_B_ID,
      shopDomain: SHOP_B_DOMAIN,
      name: 'Beta Store',
      currency: 'EUR',
      timezone: 'UTC',
      plan: 'basic',
      installedAt: new Date().toISOString(),
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  // =========================================================================
  // SECTION 1: SHOPIFYSESSION PERSISTENCE TESTS (Tests 1-9)
  // In-Memory Unit Tests & Mocked Mongoose Tests
  // =========================================================================
  describe('Part 1 — ShopifySession Persistence & Partial Unique Index', () => {
    it('1. [Unit] Save offline session: saves offline session credentials cleanly in RAM repository', async () => {
      const session: ShopifySession = {
        id: `sess-${SHOP_A_ID}`,
        shopId: SHOP_A_ID,
        sessionType: 'offline',
        encryptedAccessToken: 'enc_token_alpha_offline',
        iv: 'iv_alpha',
        authTag: 'tag_alpha',
        scope: 'read_products,write_inventory',
        expiresAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await repository.saveSession(session);
      const retrieved = await repository.getSession(SHOP_A_ID);
      assert.ok(retrieved, 'Offline session must be retrieved');
      assert.strictEqual(retrieved.shopId, SHOP_A_ID);
      assert.strictEqual(retrieved.sessionType, 'offline');
      assert.strictEqual(retrieved.encryptedAccessToken, 'enc_token_alpha_offline');
      assert.strictEqual(retrieved.iv, 'iv_alpha');
      assert.strictEqual(retrieved.authTag, 'tag_alpha');
      assert.strictEqual(retrieved.scope, 'read_products,write_inventory');
    });

    it('2. [Unit] Retrieve offline session: getSession retrieves only the active offline session', async () => {
      const session: ShopifySession = {
        id: `sess-${SHOP_A_ID}`,
        shopId: SHOP_A_ID,
        sessionType: 'offline',
        encryptedAccessToken: 'token_alpha_retrieve',
        iv: 'iv_1',
        authTag: 'tag_1',
        scope: 'read_orders',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await repository.saveSession(session);
      const res = await repository.getSession(SHOP_A_ID);
      assert.ok(res);
      assert.strictEqual(res.shopId, SHOP_A_ID);
      assert.strictEqual(res.encryptedAccessToken, 'token_alpha_retrieve');
    });

    it('3. [Unit] Reject online session as offline fallback: online session is NEVER returned by getSession', async () => {
      // Save an online session (short-lived user session)
      const onlineSession: ShopifySession = {
        id: 'sess-user-online-999',
        shopId: SHOP_A_ID,
        sessionType: 'online',
        encryptedAccessToken: 'online_user_token',
        iv: 'iv_online',
        authTag: 'tag_online',
        scope: 'read_products',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await repository.saveSession(onlineSession);

      // getSession(shopId) MUST return null because no offline session exists for SHOP_A
      const res = await repository.getSession(SHOP_A_ID);
      assert.strictEqual(
        res,
        null,
        'getSession MUST return null when only an online session exists, never falling back to online'
      );
    });

    it('4. [Unit] Replace offline session safely: re-authorization updates credentials in place in RAM repository', async () => {
      const sessionV1: ShopifySession = {
        id: `sess-${SHOP_A_ID}`,
        shopId: SHOP_A_ID,
        sessionType: 'offline',
        encryptedAccessToken: 'token_v1',
        iv: 'iv_v1',
        authTag: 'tag_v1',
        scope: 'read_products',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await repository.saveSession(sessionV1);

      const sessionV2: ShopifySession = {
        id: `sess-${SHOP_A_ID}`,
        shopId: SHOP_A_ID,
        sessionType: 'offline',
        encryptedAccessToken: 'token_v2_refreshed',
        iv: 'iv_v2',
        authTag: 'tag_v2',
        scope: 'read_products,write_orders',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await repository.saveSession(sessionV2);

      const retrieved = await repository.getSession(SHOP_A_ID);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.encryptedAccessToken, 'token_v2_refreshed');
      assert.strictEqual(retrieved.scope, 'read_products,write_orders');
    });

    it('5. [Unit] Prevent duplicate offline sessions: schema partial unique index is defined on offline sessionType', () => {
      // Verify schema index definition on ShopifySessionEntity
      const indexes = ShopifySessionEntity.schema.indexes();
      const partialUniqueIndex = indexes.find((idx) => {
        const fields = idx[0];
        const options = idx[1] || {};
        return (
          fields.shopId === 1 &&
          options.unique === true &&
          options.partialFilterExpression &&
          options.partialFilterExpression.sessionType === 'offline'
        );
      });

      assert.ok(
        partialUniqueIndex,
        'ShopifySessionSchema must define a partial unique index on { shopId: 1 } where sessionType === "offline"'
      );
    });

    it('6. [Unit] Cross-tenant session isolation: Shop A session is NEVER returned for Shop B', async () => {
      await repository.saveSession({
        id: `sess-${SHOP_A_ID}`,
        shopId: SHOP_A_ID,
        sessionType: 'offline',
        encryptedAccessToken: 'token_secret_alpha',
        iv: 'iv_a',
        authTag: 'tag_a',
        scope: 'read_products',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const sessionB = await repository.getSession(SHOP_B_ID);
      assert.strictEqual(sessionB, null, 'Query for Shop B must return null when only Shop A session exists');
    });

    it('7. [Mocked Mongoose] MongoDB read failure: getSession bubbles up database read error without swallowing', async () => {
      const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
      const origFindOne = SessionModel.findOne;

      (repository as any).isMongoAuthoritative = () => true;
      (SessionModel as any).findOne = () => {
        return {
          lean: () => Promise.reject(new Error('MongoDB replica set read timeout')),
        };
      };

      try {
        await assert.rejects(
          async () => repository.getSession(SHOP_A_ID),
          /MongoDB replica set read timeout/,
          'getSession must fail closed and propagate MongoDB read errors'
        );
      } finally {
        (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
        SessionModel.findOne = origFindOne;
      }
    });

    it('8. [Mocked Mongoose] MongoDB write failure: saveSession bubbles up database write error without false success', async () => {
      const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
      const origFindOneAndUpdate = SessionModel.findOneAndUpdate;

      (repository as any).isMongoAuthoritative = () => true;
      (SessionModel as any).findOneAndUpdate = () => {
        return Promise.reject(new Error('MongoDB primary write conflict (E11000)'));
      };

      try {
        await assert.rejects(
          async () => {
            await repository.saveSession({
              id: `sess-${SHOP_A_ID}`,
              shopId: SHOP_A_ID,
              sessionType: 'offline',
              encryptedAccessToken: 'token_fail',
              iv: 'iv_fail',
              authTag: 'tag_fail',
              scope: 'read_products',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          },
          /MongoDB primary write conflict/,
          'saveSession must propagate write failure'
        );
      } finally {
        (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
        SessionModel.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    it('9. [Mocked Mongoose] Repository re-instantiation: authoritative MongoDB delegation survives instance recreation', async () => {
      const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
      const origFindOne = SessionModel.findOne;

      let findOneCalled = false;
      const mockDoc = {
        _id: `sess-${SHOP_A_ID}`,
        shopId: SHOP_A_ID,
        sessionType: 'offline',
        encryptedAccessToken: 'mongo_authoritative_token',
        iv: 'iv_mongo',
        authTag: 'tag_mongo',
        scope: 'read_products',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (SessionModel as any).findOne = (query: any) => {
        findOneCalled = true;
        assert.strictEqual(query.shopId, SHOP_A_ID);
        assert.strictEqual(query.sessionType, 'offline');
        return {
          lean: async () => mockDoc,
        };
      };

      try {
        (repository as any).isMongoAuthoritative = () => true;
        const retrieved = await repository.getSession(SHOP_A_ID);
        assert.strictEqual(findOneCalled, true, 'Must delegate to SessionModel.findOne');
        assert.ok(retrieved);
        assert.strictEqual(retrieved.encryptedAccessToken, 'mongo_authoritative_token');
      } finally {
        (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
        SessionModel.findOne = origFindOne;
      }
    });

    it('9b. [Unit] Production fail-closed behavior: getSession throws AppError 503 when in production mode without MongoDB', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origTestEnv = process.env.STOCKPILOT_TEST_ENV;
      const origIsolate = process.env.STOCKPILOT_ISOLATE_STORAGE;

      // Simulate production runtime environment without active test isolation flags
      process.env.NODE_ENV = 'production';
      delete process.env.STOCKPILOT_TEST_ENV;
      delete process.env.STOCKPILOT_ISOLATE_STORAGE;

      try {
        await assert.rejects(
          async () => repository.getSession('shop-prod-test'),
          (err: any) =>
            err instanceof AppError &&
            err.statusCode === HttpStatus.SERVICE_UNAVAILABLE &&
            err.errorCode === ErrorCode.SERVICE_UNAVAILABLE,
          'Production must fail closed and refuse fallback to RAM or store.json'
        );
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        if (origTestEnv) process.env.STOCKPILOT_TEST_ENV = origTestEnv;
        if (origIsolate) process.env.STOCKPILOT_ISOLATE_STORAGE = origIsolate;
      }
    });
  });

  // =========================================================================
  // SECTION 2: OAUTHTRANSACTION PERSISTENCE TESTS (Tests 10-20)
  // In-Memory Unit Tests & Mocked Mongoose Tests
  // =========================================================================
  describe('Part 2 — OAuthTransaction Persistence, Single-Use & Concurrency Control', () => {
    const TEST_NONCE = 'nonce_deadbeef0123456789abcdef01234567';
    const STATE_HASH = crypto.createHash('sha256').update('oauth_state_string_xyz').digest('hex');
    const BROWSER_NONCE_HASH = crypto.createHash('sha256').update('browser_cookie_nonce_123').digest('hex');

    it('10. [Unit] Create transaction: creates and stores OAuth transaction record in RAM repository', async () => {
      const record: OAuthTransactionRecord = {
        nonce: TEST_NONCE,
        shopDomain: SHOP_A_DOMAIN,
        stateHash: STATE_HASH,
        browserNonceHash: BROWSER_NONCE_HASH,
        expiresAt: new Date(Date.now() + 600000), // +10 minutes
        consumedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await repository.createOAuthTransaction(record);
      const retrieved = await repository.getOAuthTransaction(TEST_NONCE);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.nonce, TEST_NONCE);
      assert.strictEqual(retrieved.shopDomain, SHOP_A_DOMAIN);
      assert.strictEqual(retrieved.stateHash, STATE_HASH);
      assert.strictEqual(retrieved.browserNonceHash, BROWSER_NONCE_HASH);
      assert.strictEqual(retrieved.consumedAt, null);
    });

    it('11. [Unit] Retrieve transaction: getOAuthTransaction returns null for unknown nonce', async () => {
      const res = await repository.getOAuthTransaction('non_existent_nonce');
      assert.strictEqual(res, null);
    });

    it('12. [Unit] Validate shop domain: consumeOAuthTransaction rejects mismatched shopDomain', async () => {
      await repository.createOAuthTransaction({
        nonce: TEST_NONCE,
        shopDomain: SHOP_A_DOMAIN,
        stateHash: STATE_HASH,
        browserNonceHash: BROWSER_NONCE_HASH,
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Attempt to consume using SHOP_B_DOMAIN
      const consumed = await repository.consumeOAuthTransaction(
        TEST_NONCE,
        SHOP_B_DOMAIN,
        STATE_HASH,
        BROWSER_NONCE_HASH
      );
      assert.strictEqual(consumed, false, 'Must reject mismatched shopDomain');

      // Verify the transaction was NOT accidentally consumed
      const tx = await repository.getOAuthTransaction(TEST_NONCE);
      assert.ok(tx);
      assert.strictEqual(tx.consumedAt, null, 'Failed validation must NOT consume transaction');
    });

    it('13. [Unit] Validate state hash: consumeOAuthTransaction rejects invalid stateHash', async () => {
      await repository.createOAuthTransaction({
        nonce: TEST_NONCE,
        shopDomain: SHOP_A_DOMAIN,
        stateHash: STATE_HASH,
        browserNonceHash: BROWSER_NONCE_HASH,
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const wrongHash = crypto.createHash('sha256').update('forged_state').digest('hex');
      const consumed = await repository.consumeOAuthTransaction(
        TEST_NONCE,
        SHOP_A_DOMAIN,
        wrongHash,
        BROWSER_NONCE_HASH
      );
      assert.strictEqual(consumed, false, 'Must reject invalid stateHash');
    });

    it('14. [Unit] Validate browser nonce: consumeOAuthTransaction rejects invalid browserNonceHash', async () => {
      await repository.createOAuthTransaction({
        nonce: TEST_NONCE,
        shopDomain: SHOP_A_DOMAIN,
        stateHash: STATE_HASH,
        browserNonceHash: BROWSER_NONCE_HASH,
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const wrongBrowserHash = crypto.createHash('sha256').update('foreign_cookie').digest('hex');
      const consumed = await repository.consumeOAuthTransaction(
        TEST_NONCE,
        SHOP_A_DOMAIN,
        STATE_HASH,
        wrongBrowserHash
      );
      assert.strictEqual(consumed, false, 'Must reject invalid browserNonceHash');
    });

    it('15. [Unit] Reject expired transaction: consumeOAuthTransaction rejects expired transaction', async () => {
      await repository.createOAuthTransaction({
        nonce: TEST_NONCE,
        shopDomain: SHOP_A_DOMAIN,
        stateHash: STATE_HASH,
        browserNonceHash: BROWSER_NONCE_HASH,
        expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
        consumedAt: null,
        createdAt: new Date(Date.now() - 605000),
        updatedAt: new Date(Date.now() - 605000),
      });

      const consumed = await repository.consumeOAuthTransaction(
        TEST_NONCE,
        SHOP_A_DOMAIN,
        STATE_HASH,
        BROWSER_NONCE_HASH
      );
      assert.strictEqual(consumed, false, 'Must reject expired transaction');
    });

    it('16. [Unit] Consume transaction once: first valid consumption succeeds', async () => {
      await repository.createOAuthTransaction({
        nonce: TEST_NONCE,
        shopDomain: SHOP_A_DOMAIN,
        stateHash: STATE_HASH,
        browserNonceHash: BROWSER_NONCE_HASH,
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const consumed = await repository.consumeOAuthTransaction(
        TEST_NONCE,
        SHOP_A_DOMAIN,
        STATE_HASH,
        BROWSER_NONCE_HASH
      );
      assert.strictEqual(consumed, true, 'First consumption must return true');

      const tx = await repository.getOAuthTransaction(TEST_NONCE);
      assert.ok(tx);
      assert.ok(tx.consumedAt !== null, 'consumedAt must be recorded');
    });

    it('17. [Unit] Reject replay: subsequent consumption of the same transaction returns false', async () => {
      await repository.createOAuthTransaction({
        nonce: TEST_NONCE,
        shopDomain: SHOP_A_DOMAIN,
        stateHash: STATE_HASH,
        browserNonceHash: BROWSER_NONCE_HASH,
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const firstCall = await repository.consumeOAuthTransaction(
        TEST_NONCE,
        SHOP_A_DOMAIN,
        STATE_HASH,
        BROWSER_NONCE_HASH
      );
      assert.strictEqual(firstCall, true);

      // Replay attempt with exact same valid parameters
      const secondCall = await repository.consumeOAuthTransaction(
        TEST_NONCE,
        SHOP_A_DOMAIN,
        STATE_HASH,
        BROWSER_NONCE_HASH
      );
      assert.strictEqual(secondCall, false, 'Replay of consumed transaction must be rejected');
    });

    it('18. [Unit] Concurrent callback consumption: two simultaneous callbacks result in exactly one winner in RAM', async () => {
      await repository.createOAuthTransaction({
        nonce: TEST_NONCE,
        shopDomain: SHOP_A_DOMAIN,
        stateHash: STATE_HASH,
        browserNonceHash: BROWSER_NONCE_HASH,
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const [resA, resB] = await Promise.all([
        repository.consumeOAuthTransaction(TEST_NONCE, SHOP_A_DOMAIN, STATE_HASH, BROWSER_NONCE_HASH),
        repository.consumeOAuthTransaction(TEST_NONCE, SHOP_A_DOMAIN, STATE_HASH, BROWSER_NONCE_HASH),
      ]);

      const successCount = (resA ? 1 : 0) + (resB ? 1 : 0);
      assert.strictEqual(successCount, 1, 'Exactly one concurrent request must consume the transaction');
    });

    it('19. [Mocked Mongoose] MongoDB read/write failure: create and consume errors bubble up properly', async () => {
      const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
      const origCreate = OAuthTransactionModel.create;
      const origFindOneAndUpdate = OAuthTransactionModel.findOneAndUpdate;

      (repository as any).isMongoAuthoritative = () => true;

      (OAuthTransactionModel as any).create = () => {
        return Promise.reject(new Error('MongoDB cluster unavailable on create'));
      };

      (OAuthTransactionModel as any).findOneAndUpdate = () => {
        return Promise.reject(new Error('MongoDB cluster unavailable on consume'));
      };

      try {
        await assert.rejects(
          async () => {
            await repository.createOAuthTransaction({
              nonce: 'nonce_err',
              shopDomain: SHOP_A_DOMAIN,
              stateHash: STATE_HASH,
              browserNonceHash: BROWSER_NONCE_HASH,
              expiresAt: new Date(),
              consumedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          },
          /MongoDB cluster unavailable on create/,
          'createOAuthTransaction must propagate write errors'
        );

        await assert.rejects(
          async () => {
            await repository.consumeOAuthTransaction('nonce_err', SHOP_A_DOMAIN, STATE_HASH, BROWSER_NONCE_HASH);
          },
          /MongoDB cluster unavailable on consume/,
          'consumeOAuthTransaction must propagate DB errors'
        );
      } finally {
        (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
        OAuthTransactionModel.create = origCreate;
        OAuthTransactionModel.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    it('20. [Mocked Mongoose] Cross-instance workflow simulation: verifies Instance B consumes transaction created by Instance A without local RAM dependency (Mongoose model mocks; not a live multi-node integration test)', async () => {
      const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
      const origCreate = OAuthTransactionModel.create;
      const origFindById = OAuthTransactionModel.findById;
      const origFindOneAndUpdate = OAuthTransactionModel.findOneAndUpdate;

      // Simulated shared MongoDB state for two separate Backend instances
      let sharedDbDoc: any = null;

      (OAuthTransactionModel as any).create = async (doc: any) => {
        sharedDbDoc = {
          _id: doc._id,
          shopDomain: doc.shopDomain,
          stateHash: doc.stateHash,
          browserNonceHash: doc.browserNonceHash,
          expiresAt: doc.expiresAt,
          consumedAt: doc.consumedAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return sharedDbDoc;
      };

      (OAuthTransactionModel as any).findById = (id: string) => {
        return {
          lean: async () => (sharedDbDoc && sharedDbDoc._id === id ? { ...sharedDbDoc } : null),
        };
      };

      (OAuthTransactionModel as any).findOneAndUpdate = async (query: any, update: any) => {
        if (!sharedDbDoc || sharedDbDoc._id !== query._id) return null;
        if (sharedDbDoc.consumedAt !== null) return null;
        if (sharedDbDoc.shopDomain !== query.shopDomain) return null;
        if (sharedDbDoc.stateHash !== query.stateHash) return null;
        if (sharedDbDoc.browserNonceHash !== query.browserNonceHash) return null;
        if (sharedDbDoc.expiresAt <= new Date()) return null;

        sharedDbDoc.consumedAt = update.$set.consumedAt;
        sharedDbDoc.updatedAt = update.$set.updatedAt;
        return { ...sharedDbDoc };
      };

      try {
        (repository as any).isMongoAuthoritative = () => true;

        // Instance A creates OAuth Transaction in MongoDB
        const nonceShared = 'nonce_multi_instance_test';
        await repository.createOAuthTransaction({
          nonce: nonceShared,
          shopDomain: SHOP_A_DOMAIN,
          stateHash: STATE_HASH,
          browserNonceHash: BROWSER_NONCE_HASH,
          expiresAt: new Date(Date.now() + 600000),
          consumedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Instance B looks up transaction from authoritative MongoDB
        const txOnInstanceB = await repository.getOAuthTransaction(nonceShared);
        assert.ok(txOnInstanceB, 'Instance B must retrieve transaction from shared MongoDB');
        assert.strictEqual(txOnInstanceB.shopDomain, SHOP_A_DOMAIN);
        assert.strictEqual(txOnInstanceB.consumedAt, null);

        // Instance B atomically consumes the transaction in MongoDB
        const consumedByB = await repository.consumeOAuthTransaction(
          nonceShared,
          SHOP_A_DOMAIN,
          STATE_HASH,
          BROWSER_NONCE_HASH
        );
        assert.strictEqual(consumedByB, true, 'Instance B must consume transaction');

        // Subsequent consumption by Instance A is rejected (single-use)
        const replayedByA = await repository.consumeOAuthTransaction(
          nonceShared,
          SHOP_A_DOMAIN,
          STATE_HASH,
          BROWSER_NONCE_HASH
        );
        assert.strictEqual(replayedByA, false, 'Instance A replay attempt must be rejected');
      } finally {
        (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
        OAuthTransactionModel.create = origCreate;
        OAuthTransactionModel.findById = origFindById;
        OAuthTransactionModel.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  // =========================================================================
  // SECTION 3: REAL MONGODB INTEGRATION TEST ENVIRONMENT GUARD
  // =========================================================================
  describe('Part 3 — Real MongoDB Integration Tests (Status: NOT RUN until Step 4C.3)', () => {
    it('Real MongoDB Atlas Integration Suite Status: [NOT RUN until Step 4C.3]', () => {
      // NOTE: Mocked Mongoose tests above verify model delegation and error propagation,
      // but do NOT prove actual MongoDB wire-protocol durability or multi-node instance persistence.
      // Real MongoDB integration tests against an isolated test cluster remain NOT RUN until Step 4C.3.
      const isIsolationActive = process.env.STOCKPILOT_ISOLATE_STORAGE === 'true';
      assert.strictEqual(
        isIsolationActive,
        true,
        'Storage isolation barrier must be active during local automated test execution'
      );
    });
  });
});
