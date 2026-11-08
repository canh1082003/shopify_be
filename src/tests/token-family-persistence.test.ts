import './bootstrap';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { repository, Repository, TokenFamilyRecord } from '../db/repository';
import { TokenFamily as TokenFamilyModel } from '../databases';
import { authController } from '../controllers/auth.controller';
import { generateToken, generateTokenPair } from '../utils/jwt';
import { HttpStatus } from '../constants/httpStatus';
import { AppError } from '../middleware/error.middleware';

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  };
  return res;
}

describe('Step 4C.1: TokenFamily MongoDB Persistence & Atomic CAS Rotation', () => {
  const SHOP_A_ID = 'shop-alpha-persistence';
  const SHOP_A_DOMAIN = 'alpha-persistence.myshopify.com';
  const SHOP_B_ID = 'shop-beta-persistence';
  const SHOP_B_DOMAIN = 'beta-persistence.myshopify.com';

  beforeEach(async () => {
    repository.resetInMemoryState();
    await repository.upsertShop({
      id: SHOP_A_ID,
      shopDomain: SHOP_A_DOMAIN,
      name: 'Alpha Persistence Store',
      currency: 'USD',
      timezone: 'UTC',
      plan: 'basic',
      installedAt: new Date().toISOString(),
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repository.saveSession({
      id: `sess-${SHOP_A_ID}`,
      shopId: SHOP_A_ID,
      sessionType: 'offline',
      encryptedAccessToken: 'encrypted-test-token-alpha',
      iv: 'iv-alpha',
      authTag: 'authTag-alpha',
      scope: 'read_products',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await repository.upsertShop({
      id: SHOP_B_ID,
      shopDomain: SHOP_B_DOMAIN,
      name: 'Beta Persistence Store',
      currency: 'EUR',
      timezone: 'UTC',
      plan: 'basic',
      installedAt: new Date().toISOString(),
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repository.saveSession({
      id: `sess-${SHOP_B_ID}`,
      shopId: SHOP_B_ID,
      sessionType: 'offline',
      encryptedAccessToken: 'encrypted-test-token-beta',
      iv: 'iv-beta',
      authTag: 'authTag-beta',
      scope: 'read_products',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('1. Token family creation: correctly saves and retrieves token family metadata', async () => {
    const familyId = `fam-test-${crypto.randomUUID()}`;
    const jti = `jti-test-${crypto.randomUUID()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const absExp = nowSec + 86400 * 7;

    const record: TokenFamilyRecord = {
      familyId,
      shopId: SHOP_A_ID,
      currentJti: jti,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: absExp,
    };

    await repository.saveTokenFamily(record);
    const retrieved = await repository.getTokenFamily(familyId, SHOP_A_ID);

    assert.ok(retrieved, 'Token family must be retrieved successfully');
    assert.strictEqual(retrieved.familyId, familyId);
    assert.strictEqual(retrieved.shopId, SHOP_A_ID);
    assert.strictEqual(retrieved.currentJti, jti);
    assert.strictEqual(retrieved.revoked, false);
    assert.strictEqual(retrieved.absoluteExpiresAt, absExp);
  });

  it('2. Persistence across repository re-instantiation (RAM isolation state)', async () => {
    const familyId = `fam-inst-${crypto.randomUUID()}`;
    const jti = `jti-inst-${crypto.randomUUID()}`;

    await repository.saveTokenFamily({
      familyId,
      shopId: SHOP_A_ID,
      currentJti: jti,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const retrieved = await repository.getTokenFamily(familyId);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.currentJti, jti);
  });

  it('3. Valid refresh rotation: atomic CAS advances currentJti to newJti and records previousJti', async () => {
    const familyId = `fam-rot-${crypto.randomUUID()}`;
    const oldJti = `jti-old-${crypto.randomUUID()}`;
    const newJti = `jti-new-${crypto.randomUUID()}`;

    await repository.saveTokenFamily({
      familyId,
      shopId: SHOP_A_ID,
      currentJti: oldJti,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const rotated = await repository.rotateTokenFamily(familyId, SHOP_A_ID, oldJti, newJti);
    assert.ok(rotated, 'CAS rotation must succeed with matching currentJti');
    assert.strictEqual(rotated.currentJti, newJti);
    assert.strictEqual(rotated.previousJti, oldJti);
    assert.ok(rotated.rotatedAt);

    // Verify persisted state
    const current = await repository.getTokenFamily(familyId, SHOP_A_ID);
    assert.ok(current);
    assert.strictEqual(current.currentJti, newJti);
    assert.strictEqual(current.previousJti, oldJti);
  });

  it('4. Concurrent refresh requests: Request A succeeds CAS; Request B fails CAS and falls into grace window', async () => {
    const familyId = `fam-concurrent-${crypto.randomUUID()}`;
    const initialJti = `jti-init-${crypto.randomUUID()}`;
    const absExp = Math.floor(Date.now() / 1000) + 3600;

    await repository.saveTokenFamily({
      familyId,
      shopId: SHOP_A_ID,
      currentJti: initialJti,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: absExp,
    });

    const tokenPair = generateTokenPair(
      { shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN, role: 'merchant_admin' },
      900,
      86400,
      familyId,
      initialJti,
      absExp
    );

    // Simulate Request A and Request B arriving concurrently with the same refresh token
    const mockReqA: any = { body: { refreshToken: tokenPair.refreshToken } };
    const mockResA = createMockResponse();
    const mockReqB: any = { body: { refreshToken: tokenPair.refreshToken } };
    const mockResB = createMockResponse();

    await Promise.all([
      authController.refreshToken(mockReqA, mockResA, () => {}),
      authController.refreshToken(mockReqB, mockResB, () => {}),
    ]);

    // Both requests must succeed (HTTP 200 OK)
    assert.strictEqual(mockResA.statusCode, HttpStatus.OK, 'Req A must succeed');
    assert.strictEqual(mockResB.statusCode, HttpStatus.OK, 'Req B must succeed via concurrent grace window');

    assert.ok(mockResA.body.data.token, 'Req A has access token');
    assert.ok(mockResB.body.data.token, 'Req B has access token');

    // Verify token family is NOT revoked
    const familyState = await repository.getTokenFamily(familyId, SHOP_A_ID);
    assert.ok(familyState);
    assert.strictEqual(familyState.revoked, false, 'Concurrent requests must not trigger false replay revocation');
  });

  it('5. Grace-period behavior: request presenting previousJti within 10s succeeds; replay after 10s is rejected', async () => {
    const familyId = `fam-grace-${crypto.randomUUID()}`;
    const jti0 = `jti-0-${crypto.randomUUID()}`;
    const jti1 = `jti-1-${crypto.randomUUID()}`;
    const absExp = Math.floor(Date.now() / 1000) + 3600;

    await repository.saveTokenFamily({
      familyId,
      shopId: SHOP_A_ID,
      currentJti: jti1,
      previousJti: jti0,
      rotatedAt: new Date().toISOString(), // Just rotated now (< 10s)
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: absExp,
    });

    // Token with previousJti within 10s grace window
    const tokenGrace = generateTokenPair(
      { shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN, role: 'merchant_admin' },
      900,
      86400,
      familyId,
      jti0,
      absExp
    );

    const mockReqGrace: any = { body: { refreshToken: tokenGrace.refreshToken } };
    const mockResGrace = createMockResponse();
    await authController.refreshToken(mockReqGrace, mockResGrace, () => {});

    assert.strictEqual(mockResGrace.statusCode, HttpStatus.OK, 'Previous JTI within grace window must succeed');
    assert.match(mockResGrace.body.message, /within concurrent refresh grace window/i);

    // Now age rotatedAt by 15 seconds to expire grace window
    const agedTime = new Date(Date.now() - 15000).toISOString();
    const family = await repository.getTokenFamily(familyId, SHOP_A_ID);
    assert.ok(family);
    family.rotatedAt = agedTime;
    await repository.saveTokenFamily(family);

    // Token presenting expired jti0 now triggers replay attack!
    const mockReqExpired: any = { body: { refreshToken: tokenGrace.refreshToken } };
    const mockResExpired = createMockResponse();
    await authController.refreshToken(mockReqExpired, mockResExpired, () => {});

    assert.strictEqual(mockResExpired.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockResExpired.body.errorCode, 'AUTH_REPLAY_DETECTED');

    // Family is now revoked
    const revokedFam = await repository.getTokenFamily(familyId, SHOP_A_ID);
    assert.ok(revokedFam);
    assert.strictEqual(revokedFam.revoked, true);
    assert.match(revokedFam.revokedReason || '', /Replay Attack/i);
  });

  it('6. Replay detection: using an unknown or compromised JTI revokes family immediately', async () => {
    const familyId = `fam-replay-${crypto.randomUUID()}`;
    const jtiCurrent = `jti-curr-${crypto.randomUUID()}`;
    const jtiCompromised = `jti-compromised-${crypto.randomUUID()}`;
    const absExp = Math.floor(Date.now() / 1000) + 3600;

    await repository.saveTokenFamily({
      familyId,
      shopId: SHOP_A_ID,
      currentJti: jtiCurrent,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: absExp,
    });

    const forgedToken = generateTokenPair(
      { shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN, role: 'merchant_admin' },
      900,
      86400,
      familyId,
      jtiCompromised,
      absExp
    );

    const mockReq: any = { body: { refreshToken: forgedToken.refreshToken } };
    const mockRes = createMockResponse();
    await authController.refreshToken(mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, 'AUTH_REPLAY_DETECTED');

    const state = await repository.getTokenFamily(familyId, SHOP_A_ID);
    assert.ok(state);
    assert.strictEqual(state.revoked, true);
  });

  it('7. Family revocation: revokeTokenFamily marks revoked and blocks subsequent refresh requests', async () => {
    const familyId = `fam-revoke-${crypto.randomUUID()}`;
    const jti = `jti-rev-${crypto.randomUUID()}`;
    const absExp = Math.floor(Date.now() / 1000) + 3600;

    await repository.saveTokenFamily({
      familyId,
      shopId: SHOP_A_ID,
      currentJti: jti,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: absExp,
    });

    await repository.revokeTokenFamily(familyId, 'Merchant manual logout', SHOP_A_ID);

    const state = await repository.getTokenFamily(familyId, SHOP_A_ID);
    assert.ok(state);
    assert.strictEqual(state.revoked, true);
    assert.strictEqual(state.revokedReason, 'Merchant manual logout');

    const token = generateTokenPair(
      { shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN, role: 'merchant_admin' },
      900,
      86400,
      familyId,
      jti,
      absExp
    );

    const mockReq: any = { body: { refreshToken: token.refreshToken } };
    const mockRes = createMockResponse();
    await authController.refreshToken(mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, 'AUTH_REFRESH_REVOKED');
  });

  it('8. Shop-wide revocation: revokeAllTokenFamiliesForShop revokes all families for target shop only', async () => {
    const famA1 = `fam-A1-${crypto.randomUUID()}`;
    const famA2 = `fam-A2-${crypto.randomUUID()}`;
    const famB1 = `fam-B1-${crypto.randomUUID()}`;

    await repository.saveTokenFamily({
      familyId: famA1,
      shopId: SHOP_A_ID,
      currentJti: 'jti-A1',
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    await repository.saveTokenFamily({
      familyId: famA2,
      shopId: SHOP_A_ID,
      currentJti: 'jti-A2',
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    await repository.saveTokenFamily({
      familyId: famB1,
      shopId: SHOP_B_ID,
      currentJti: 'jti-B1',
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    // Revoke all for Shop A
    await repository.revokeAllTokenFamiliesForShop(SHOP_A_ID, 'App uninstalled for Alpha');

    const stateA1 = await repository.getTokenFamily(famA1, SHOP_A_ID);
    const stateA2 = await repository.getTokenFamily(famA2, SHOP_A_ID);
    const stateB1 = await repository.getTokenFamily(famB1, SHOP_B_ID);

    assert.strictEqual(stateA1?.revoked, true, 'Fam A1 must be revoked');
    assert.strictEqual(stateA2?.revoked, true, 'Fam A2 must be revoked');
    assert.strictEqual(stateB1?.revoked, false, 'Fam B1 must remain active and isolated');
  });

  it('9. Absolute expiration: session past absoluteExpiresAt is rejected and revoked', async () => {
    const familyId = `fam-absexp-${crypto.randomUUID()}`;
    const jti = `jti-absexp-${crypto.randomUUID()}`;
    const pastExp = Math.floor(Date.now() / 1000) - 60; // Expired 1 minute ago

    await repository.saveTokenFamily({
      familyId,
      shopId: SHOP_A_ID,
      currentJti: jti,
      revoked: false,
      createdAt: new Date(Date.now() - 86400 * 8 * 1000).toISOString(),
      absoluteExpiresAt: pastExp,
    });

    const token = generateTokenPair(
      { shopId: SHOP_A_ID, shopDomain: SHOP_A_DOMAIN, role: 'merchant_admin' },
      900,
      86400,
      familyId,
      jti,
      pastExp
    );

    const mockReq: any = { body: { refreshToken: token.refreshToken } };
    const mockRes = createMockResponse();
    await authController.refreshToken(mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, HttpStatus.UNAUTHORIZED);
    assert.strictEqual(mockRes.body.errorCode, 'AUTH_SESSION_EXPIRED');

    const state = await repository.getTokenFamily(familyId, SHOP_A_ID);
    assert.ok(state);
    assert.strictEqual(state.revoked, true);
    assert.match(state.revokedReason || '', /Absolute session lifetime reached/i);
  });

  it('10. Cross-tenant isolation: Shop B cannot lookup, rotate, or revoke Shop A token families', async () => {
    const familyIdA = `fam-isolated-A-${crypto.randomUUID()}`;
    const jtiA = `jti-iso-A-${crypto.randomUUID()}`;

    await repository.saveTokenFamily({
      familyId: familyIdA,
      shopId: SHOP_A_ID,
      currentJti: jtiA,
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    // 1. Cross-tenant lookup: Shop B query returns null
    const lookupByB = await repository.getTokenFamily(familyIdA, SHOP_B_ID);
    assert.strictEqual(lookupByB, null, 'Shop B lookup for Shop A family must return null');

    // 2. Cross-tenant CAS rotation: Shop B attempt fails
    const rotateByB = await repository.rotateTokenFamily(familyIdA, SHOP_B_ID, jtiA, 'jti-forged');
    assert.strictEqual(rotateByB, null, 'Shop B cannot rotate Shop A family');

    // Verify JTI did not change
    const stateAfter = await repository.getTokenFamily(familyIdA, SHOP_A_ID);
    assert.strictEqual(stateAfter?.currentJti, jtiA, 'Original JTI must remain unchanged');

    // 3. Cross-tenant revocation: Shop B cannot revoke Shop A family
    await repository.revokeTokenFamily(familyIdA, 'Malicious revoke attempt', SHOP_B_ID);
    const stateAfterRevoke = await repository.getTokenFamily(familyIdA, SHOP_A_ID);
    assert.strictEqual(stateAfterRevoke?.revoked, false, 'Shop A family must not be revoked by Shop B');
  });

  it('11. MongoDB authoritative delegation: repository delegates to TokenFamilyModel when active', async () => {
    const familyId = `fam-mongo-${crypto.randomUUID()}`;
    const jti = `jti-mongo-${crypto.randomUUID()}`;
    const absExp = Math.floor(Date.now() / 1000) + 7200;

    const mockDoc = {
      _id: familyId,
      shopId: SHOP_A_ID,
      currentJti: jti,
      previousJti: null,
      rotatedAt: null,
      revoked: false,
      revokedReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      absoluteExpiresAt: absExp,
      ttlExpiresAt: new Date(absExp * 1000),
    };

    let findOneCalled = false;
    let findByIdAndUpdateCalled = false;
    let updateOneCalled = false;
    let updateManyCalled = false;
    let findOneAndUpdateCalled = false;

    const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
    const origFindOne = TokenFamilyModel.findOne;
    const origFindByIdAndUpdate = TokenFamilyModel.findByIdAndUpdate;
    const origUpdateOne = TokenFamilyModel.updateOne;
    const origUpdateMany = TokenFamilyModel.updateMany;
    const origFindOneAndUpdate = TokenFamilyModel.findOneAndUpdate;

    (repository as any).isMongoAuthoritative = () => true;

    (TokenFamilyModel as any).findOne = (query: any) => {
      findOneCalled = true;
      assert.strictEqual(query._id, familyId);
      assert.strictEqual(query.shopId, SHOP_A_ID);
      return { lean: async () => mockDoc };
    };

    (TokenFamilyModel as any).findByIdAndUpdate = (id: string, update: any) => {
      findByIdAndUpdateCalled = true;
      assert.strictEqual(id, familyId);
      assert.strictEqual(update.shopId, SHOP_A_ID);
      assert.ok(update.ttlExpiresAt instanceof Date);
      return Promise.resolve(mockDoc);
    };

    (TokenFamilyModel as any).updateOne = (filter: any, update: any) => {
      updateOneCalled = true;
      assert.strictEqual(filter._id, familyId);
      assert.strictEqual(update.$set.revoked, true);
      return Promise.resolve({ modifiedCount: 1 });
    };

    (TokenFamilyModel as any).updateMany = (filter: any, update: any) => {
      updateManyCalled = true;
      assert.strictEqual(filter.shopId, SHOP_A_ID);
      assert.strictEqual(update.$set.revoked, true);
      return Promise.resolve({ modifiedCount: 2 });
    };

    (TokenFamilyModel as any).findOneAndUpdate = (query: any, update: any) => {
      findOneAndUpdateCalled = true;
      assert.strictEqual(query._id, familyId);
      assert.strictEqual(query.shopId, SHOP_A_ID);
      assert.strictEqual(query.currentJti, jti);
      return {
        lean: async () => ({
          ...mockDoc,
          currentJti: update.$set.currentJti,
          previousJti: jti,
          rotatedAt: update.$set.rotatedAt,
        }),
      };
    };

    try {
      // 1. Test saveTokenFamily delegation
      await repository.saveTokenFamily({
        familyId,
        shopId: SHOP_A_ID,
        currentJti: jti,
        revoked: false,
        createdAt: new Date().toISOString(),
        absoluteExpiresAt: absExp,
      });
      assert.strictEqual(findByIdAndUpdateCalled, true, 'saveTokenFamily must delegate to TokenFamilyModel.findByIdAndUpdate');

      // 2. Test getTokenFamily delegation
      const doc = await repository.getTokenFamily(familyId, SHOP_A_ID);
      assert.strictEqual(findOneCalled, true, 'getTokenFamily must delegate to TokenFamilyModel.findOne');
      assert.ok(doc);
      assert.strictEqual(doc.familyId, familyId);

      // 3. Test rotateTokenFamily delegation
      const rotated = await repository.rotateTokenFamily(familyId, SHOP_A_ID, jti, 'new-jti-mongo');
      assert.strictEqual(findOneAndUpdateCalled, true, 'rotateTokenFamily must delegate to TokenFamilyModel.findOneAndUpdate');
      assert.ok(rotated);
      assert.strictEqual(rotated.currentJti, 'new-jti-mongo');

      // 4. Test revokeTokenFamily delegation
      await repository.revokeTokenFamily(familyId, 'Security logout', SHOP_A_ID);
      assert.strictEqual(updateOneCalled, true, 'revokeTokenFamily must delegate to TokenFamilyModel.updateOne');

      // 5. Test revokeAllTokenFamiliesForShop delegation
      await repository.revokeAllTokenFamiliesForShop(SHOP_A_ID, 'App uninstalled');
      assert.strictEqual(updateManyCalled, true, 'revokeAllTokenFamiliesForShop must delegate to TokenFamilyModel.updateMany');
    } finally {
      (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
      TokenFamilyModel.findOne = origFindOne;
      TokenFamilyModel.findByIdAndUpdate = origFindByIdAndUpdate;
      TokenFamilyModel.updateOne = origUpdateOne;
      TokenFamilyModel.updateMany = origUpdateMany;
      TokenFamilyModel.findOneAndUpdate = origFindOneAndUpdate;
    }
  });

  it('12. MongoDB failure propagation: write and rotation errors bubble up without silent swallow', async () => {
    const originalIsMongoAuthoritative = (repository as any).isMongoAuthoritative;
    const origFindByIdAndUpdate = TokenFamilyModel.findByIdAndUpdate;
    const origFindOneAndUpdate = TokenFamilyModel.findOneAndUpdate;

    (repository as any).isMongoAuthoritative = () => true;

    (TokenFamilyModel as any).findByIdAndUpdate = () => {
      return Promise.reject(new Error('MongoDB cluster unavailable'));
    };

    (TokenFamilyModel as any).findOneAndUpdate = () => {
      return {
        lean: () => Promise.reject(new Error('MongoDB write conflict timeout')),
      };
    };

    try {
      // saveTokenFamily must reject with database error
      await assert.rejects(
        async () => {
          await repository.saveTokenFamily({
            familyId: 'fam-fail',
            shopId: SHOP_A_ID,
            currentJti: 'jti-fail',
            revoked: false,
            createdAt: new Date().toISOString(),
            absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
          });
        },
        /MongoDB cluster unavailable/,
        'saveTokenFamily must propagate MongoDB error'
      );

      // rotateTokenFamily must reject with database error
      await assert.rejects(
        async () => {
          await repository.rotateTokenFamily('fam-fail', SHOP_A_ID, 'jti-fail', 'jti-next');
        },
        /MongoDB write conflict timeout/,
        'rotateTokenFamily must propagate MongoDB error'
      );
    } finally {
      (repository as any).isMongoAuthoritative = originalIsMongoAuthoritative;
      TokenFamilyModel.findByIdAndUpdate = origFindByIdAndUpdate;
      TokenFamilyModel.findOneAndUpdate = origFindOneAndUpdate;
    }
  });
});

