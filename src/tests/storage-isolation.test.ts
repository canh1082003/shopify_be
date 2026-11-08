import './bootstrap';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { repository, Repository } from '../db/repository';
import { connectDatabase, isDatabaseConnected, isTestIsolationEnabled } from '../databases';
import { connectMongo, isMongoConnected } from '../db/mongo';
import { Shop, ShopifySession, Order } from '../types';

describe('Storage & Environment Isolation Barrier Tests (Step 1 Complete)', () => {
  const dataDir = path.resolve(__dirname, '../../data');
  const storeFilePath = path.resolve(dataDir, 'store.json');

  it('1. Test isolation flags & initialization order: isolation barrier active before any operations', () => {
    assert.strictEqual(isTestIsolationEnabled(), true, 'isTestIsolationEnabled() must return true');
    assert.strictEqual(repository.isInMemory(), true, 'repository.isInMemory() must be true');
    assert.strictEqual(new Repository().isInMemory(), true, 'new Repository().isInMemory() must be true');
    assert.strictEqual(process.env.STOCKPILOT_TEST_ENV, 'true');
    assert.strictEqual(process.env.STOCKPILOT_ISOLATE_STORAGE, 'true');
  });

  it('2. MongoDB credential sanitization: real DB connection strings are scrubbed from process.env', () => {
    assert.strictEqual(process.env.MONGODB_URL, undefined, 'MONGODB_URL must be purged in test mode');
    assert.strictEqual(process.env.MONGODB_URI, undefined, 'MONGODB_URI must be purged in test mode');
    assert.strictEqual(process.env.DATABASE_URL, undefined, 'DATABASE_URL must be purged in test mode');
  });

  it('3. Official DB connection entry points: connectDatabase and connectMongo are strictly blocked', async () => {
    const remoteProdUri = 'mongodb://production-admin:supersecret@cluster0.mongodb.net:27017/stockpilot_prod';

    const connected1 = await connectDatabase(remoteProdUri);
    assert.strictEqual(connected1, false, 'connectDatabase must reject connections during test isolation');

    const connected2 = await connectMongo(remoteProdUri);
    assert.strictEqual(connected2, false, 'connectMongo must reject connections during test isolation');

    assert.strictEqual(isDatabaseConnected(), false, 'isDatabaseConnected() must return false');
    assert.strictEqual(isMongoConnected(), false, 'isMongoConnected() must return false');
  });

  it('4. Direct Mongoose driver calls: direct mongoose.connect and createConnection throw explicit errors without network I/O', async () => {
    const remoteProdUri = 'mongodb://fake-direct-mongoose-host:27017/stockpilot_prod';

    // Direct mongoose.connect call must be rejected with explicit error to avoid false-positive connection objects
    await assert.rejects(
      async () => {
        await mongoose.connect(remoteProdUri);
      },
      /Direct mongoose\.connect\(\) is blocked in test mode/i,
      'Direct mongoose.connect must throw explicit error'
    );
    assert.strictEqual(mongoose.connection.readyState, 0, 'Connection readyState must remain 0 (disconnected)');

    // Direct mongoose.createConnection call must be rejected with explicit error
    assert.throws(
      () => {
        mongoose.createConnection(remoteProdUri);
      },
      /Direct mongoose\.createConnection\(\) is blocked in test mode/i,
      'Direct mongoose.createConnection must throw explicit error'
    );
    assert.strictEqual(isDatabaseConnected(), false, 'isDatabaseConnected must remain false');
  });

  it('5. Zero store.json creation: mutations on repository do NOT create or modify store.json on disk', async () => {
    // Assert that store.json does not exist on disk (deleted per stateless SaaS design)
    assert.strictEqual(fs.existsSync(storeFilePath), false, 'store.json must not exist on disk');

    // Perform mutations across multiple entities on the singleton repository
    const mockShopId = 'shop-isolation-test';
    const mockShop: Shop = {
      id: mockShopId,
      shopDomain: 'isolation-test.myshopify.com',
      name: 'Isolation Test Store',
      currency: 'USD',
      timezone: 'UTC',
      plan: 'basic',
      installedAt: new Date().toISOString(),
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repository.upsertShop(mockShop);

    const mockSession: ShopifySession = {
      id: `sess-${mockShopId}`,
      shopId: mockShopId,
      sessionType: 'offline',
      encryptedAccessToken: 'encrypted-test-token',
      iv: 'iv-test',
      authTag: 'auth-tag-test',
      scope: 'read_products',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repository.saveSession(mockSession);

    const mockOrder: Order = {
      id: 'ord-isolation-999',
      shopId: mockShopId,
      shopifyOrderId: 'gid://shopify/Order/999999',
      orderNumber: '#ISO-999',
      name: '#ISO-999',
      customerName: 'Test Customer',
      customerEmail: 'test@example.com',
      createdAt: new Date().toISOString(),
      processedAt: null,
      cancelledAt: null,
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      totalAmount: 199.99,
      currencyCode: 'USD',
      totalItems: 2,
      fulfillableQuantity: 2,
      lineItems: [],
      deadline: null,
      isOverdue: false,
      overdueMinutes: 0,
      lastSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repository.upsertOrder(mockShopId, mockOrder);

    await repository.saveTokenFamily({
      familyId: 'fam-isolation-test',
      shopId: mockShopId,
      currentJti: 'jti-isolation-1',
      revoked: false,
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    // Verify mutations were applied in RAM
    const inMemoryShop = await repository.getShop(mockShopId);
    assert.strictEqual(inMemoryShop?.id, mockShopId);
    const inMemoryOrder = await repository.getOrderById(mockShopId, 'ord-isolation-999');
    assert.strictEqual(inMemoryOrder?.id, 'ord-isolation-999');

    // Assert that store.json was NOT created on disk by repository mutations
    assert.strictEqual(
      fs.existsSync(storeFilePath),
      false,
      'store.json must not be created on disk after repository mutations'
    );

    // Verify that no temporary files (*.tmp) or store.json were created in the data directory
    if (fs.existsSync(dataDir)) {
      const filesInDataDir = fs.readdirSync(dataDir);
      const tmpFiles = filesInDataDir.filter((f) => f.endsWith('.tmp') || f === 'store.json');
      assert.strictEqual(tmpFiles.length, 0, 'No persistence files (*.tmp or store.json) may be created during test execution');
    }
  });

  it('6. Concurrent instance isolation: multiple Repository instances operate independently in memory', async () => {
    const repoA = new Repository();
    const repoB = new Repository();

    assert.strictEqual(repoA.isInMemory(), true);
    assert.strictEqual(repoB.isInMemory(), true);

    const shopA: Shop = {
      id: 'shop-concurrent-a',
      shopDomain: 'concurrent-a.myshopify.com',
      name: 'Shop A',
      currency: 'USD',
      timezone: 'UTC',
      plan: 'basic',
      installedAt: new Date().toISOString(),
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repoA.upsertShop(shopA);

    // Assert Shop A is present in repoA but NOT in repoB
    const foundInA = await repoA.getShop('shop-concurrent-a');
    const foundInB = await repoB.getShop('shop-concurrent-a');

    assert.strictEqual(foundInA?.id, 'shop-concurrent-a');
    assert.strictEqual(foundInB, null, 'Repository instances must maintain separate isolated in-memory stores');
  });
});
