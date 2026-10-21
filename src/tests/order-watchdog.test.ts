import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MonitorService } from '../services/monitor.service';
import { Repository } from '../db/repository';
import { Settings, Order } from '../types';

describe('Order Watchdog - Monitor Engine & Eligibility Tests', () => {
  const monitor = new MonitorService();

  const standardSettings: Pick<Settings, 'overdueThresholdHours' | 'warningLeadTimeHours'> = {
    overdueThresholdHours: 24,
    warningLeadTimeHours: 4,
  };

  it('1. Canceled order exclusion: canceled order must never be flagged as overdue', () => {
    const order: Pick<Order, 'createdAt' | 'cancelledAt' | 'financialStatus' | 'fulfillmentStatus' | 'fulfillableQuantity'> = {
      createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), // 48h ago
      cancelledAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(), // Canceled!
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      fulfillableQuantity: 1,
    };

    const result = monitor.evaluateOrder(order, standardSettings);
    assert.strictEqual(result.isEligible, false);
    assert.strictEqual(result.isOverdue, false);
    assert.match(result.reason || '', /canceled/i);
  });

  it('2. Paid/Unpaid eligibility: unpaid or pending payment orders are excluded', () => {
    const order: Pick<Order, 'createdAt' | 'cancelledAt' | 'financialStatus' | 'fulfillmentStatus' | 'fulfillableQuantity'> = {
      createdAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
      cancelledAt: null,
      financialStatus: 'pending', // Unpaid!
      fulfillmentStatus: 'unfulfilled',
      fulfillableQuantity: 1,
    };

    const result = monitor.evaluateOrder(order, standardSettings);
    assert.strictEqual(result.isEligible, false);
    assert.strictEqual(result.isOverdue, false);
    assert.match(result.reason || '', /pending/i);
  });

  it('3. Fully fulfilled exclusion: fulfilled order is not overdue', () => {
    const order: Pick<Order, 'createdAt' | 'cancelledAt' | 'financialStatus' | 'fulfillmentStatus' | 'fulfillableQuantity'> = {
      createdAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
      cancelledAt: null,
      financialStatus: 'paid',
      fulfillmentStatus: 'fulfilled',
      fulfillableQuantity: 0,
    };

    const result = monitor.evaluateOrder(order, standardSettings);
    assert.strictEqual(result.isEligible, false);
    assert.strictEqual(result.isOverdue, false);
  });

  it('4. Partial fulfillment handling: order with remaining unfulfilled items past threshold MUST be overdue', () => {
    const order: Pick<Order, 'createdAt' | 'cancelledAt' | 'financialStatus' | 'fulfillmentStatus' | 'fulfillableQuantity'> = {
      createdAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString(), // 30h ago (threshold is 24h)
      cancelledAt: null,
      financialStatus: 'paid',
      fulfillmentStatus: 'partial', // Partially fulfilled
      fulfillableQuantity: 1, // Still 1 item unfulfilled!
    };

    const result = monitor.evaluateOrder(order, standardSettings);
    assert.strictEqual(result.isEligible, true);
    assert.strictEqual(result.isOverdue, true);
    assert.strictEqual(result.overdueMinutes >= 350, true);
  });

  it('5. Warning lead time calculation: order approaching deadline triggers warning window', () => {
    // Created 21 hours ago, threshold is 24h, warning window starts at 20h (24h - 4h)
    const order: Pick<Order, 'createdAt' | 'cancelledAt' | 'financialStatus' | 'fulfillmentStatus' | 'fulfillableQuantity'> = {
      createdAt: new Date(Date.now() - 21 * 3600 * 1000).toISOString(),
      cancelledAt: null,
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      fulfillableQuantity: 1,
    };

    const result = monitor.evaluateOrder(order, standardSettings);
    assert.strictEqual(result.isEligible, true);
    assert.strictEqual(result.isOverdue, false);
    assert.strictEqual(result.isInWarningWindow, true);
  });

  it('6. On-track pending order: created recently is neither overdue nor in warning', () => {
    // Created 2 hours ago
    const order: Pick<Order, 'createdAt' | 'cancelledAt' | 'financialStatus' | 'fulfillmentStatus' | 'fulfillableQuantity'> = {
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      cancelledAt: null,
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      fulfillableQuantity: 1,
    };

    const result = monitor.evaluateOrder(order, standardSettings);
    assert.strictEqual(result.isEligible, true);
    assert.strictEqual(result.isOverdue, false);
    assert.strictEqual(result.isInWarningWindow, false);
  });
});

describe('Order Watchdog - Repository & Tenant Isolation Tests', () => {
  const repo = new Repository();

  it('7. Tenant isolation: orders for Shop A are never returned in Shop B queries', async () => {
    const shopA = 'test-shop-a';
    const shopB = 'test-shop-b';

    await repo.upsertOrder(shopA, {
      id: 'ord-a-1',
      shopId: shopA,
      shopifyOrderId: 'gid://shopify/Order/1111',
      orderNumber: '#A101',
      name: '#A101',
      createdAt: new Date().toISOString(),
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      totalAmount: 50.0,
      currencyCode: 'USD',
      totalItems: 1,
      fulfillableQuantity: 1,
      lineItems: [],
      deadline: null,
      isOverdue: false,
      overdueMinutes: 0,
      lastSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const ordersForB = await repo.getOrders(shopB);
    assert.strictEqual(
      ordersForB.items.some((o) => o.id === 'ord-a-1'),
      false
    );
  });

  it('8. Alert acknowledgment: acknowledges alert without marking order fulfilled', async () => {
    const shopId = 'test-ack-shop';
    const alertId = 'alert-test-ack';

    await repo.upsertAlert(shopId, {
      id: alertId,
      shopId,
      orderId: 'ord-test-ack',
      orderNumber: '#9999',
      severity: 'critical',
      status: 'active',
      reason: 'Order overdue test',
      elapsedHours: 30,
      thresholdHours: 24,
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
    });

    const ackResult = await repo.acknowledgeAlert(shopId, alertId);
    assert.strictEqual(ackResult?.status, 'acknowledged');
    assert.notStrictEqual(ackResult?.acknowledgedAt, null);

    const reloaded = await repo.getAlertById(shopId, alertId);
    assert.strictEqual(reloaded?.status, 'acknowledged');
  });

  it('9. Alert resolution: fulfills alerts when order is satisfied', async () => {
    const shopId = 'test-resolve-shop';
    const orderId = 'ord-test-resolve';

    await repo.upsertAlert(shopId, {
      id: 'alert-to-resolve',
      shopId,
      orderId,
      orderNumber: '#8888',
      severity: 'critical',
      status: 'active',
      reason: 'Overdue order test',
      elapsedHours: 28,
      thresholdHours: 24,
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
    });

    await repo.resolveAlertsForOrder(shopId, orderId, 'Fulfilled in test');

    const alert = await repo.getAlertById(shopId, 'alert-to-resolve');
    assert.strictEqual(alert?.status, 'resolved');
    assert.strictEqual(alert?.severity, 'resolved');
    assert.notStrictEqual(alert?.resolvedAt, null);
  });
});

describe('Order Watchdog - Authentication & Token Security Tests', () => {
  const { generateToken, verifyToken, generateTokenPair, verifyRefreshToken } = require('../utils/jwt');

  it('10. Valid token verification: returns authenticated tenant identity', () => {
    const payload = {
      shopId: 'shop-test-123',
      shopDomain: 'test-store.myshopify.com',
      role: 'merchant_admin',
    };

    const token = generateToken(payload, 3600);
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.split('.').length, 3);

    const decoded = verifyToken(token);
    assert.strictEqual(decoded.shopId, 'shop-test-123');
    assert.strictEqual(decoded.shopDomain, 'test-store.myshopify.com');
    assert.strictEqual(decoded.role, 'merchant_admin');
  });

  it('11. Tampered signature rejection: modifying signature fails verification', () => {
    const token = generateToken({ shopId: 'shop-1', shopDomain: 'demo.myshopify.com' });
    const tampered = token.slice(0, -5) + 'xxxxx';

    assert.throws(
      () => verifyToken(tampered),
      /Invalid token signature/i
    );
  });

  it('12. Expired token rejection: expired token throws Token has expired', () => {
    // Generate token with negative expiresIn
    const expiredToken = generateToken(
      { shopId: 'shop-1', shopDomain: 'demo.myshopify.com' },
      -10
    );

    assert.throws(
      () => verifyToken(expiredToken),
      /Token has expired/i
    );
  });

  it('13. Malformed token structure: random string throws malformed error', () => {
    assert.throws(
      () => verifyToken('invalid.token'),
      /Malformed JWT token structure/i
    );
    assert.throws(
      () => verifyToken(''),
      /No token provided/i
    );
  });

  it('14. Token pair generation & refresh token validation', () => {
    const pair = generateTokenPair({ shopId: 'shop-test-456', shopDomain: 'refresh-test.myshopify.com' });
    assert.ok(pair.accessToken, 'Access token must be generated');
    assert.ok(pair.refreshToken, 'Refresh token must be generated');
    assert.strictEqual(pair.tokenType, 'Bearer');

    const accessDecoded = verifyToken(pair.accessToken, 'access');
    assert.strictEqual(accessDecoded.shopId, 'shop-test-456');
    assert.strictEqual(accessDecoded.type, 'access');

    const refreshDecoded = verifyRefreshToken(pair.refreshToken);
    assert.strictEqual(refreshDecoded.shopId, 'shop-test-456');
    assert.strictEqual(refreshDecoded.type, 'refresh');
  });

  it('15. Token type safety: access token cannot be used as refresh token', () => {
    const pair = generateTokenPair({ shopId: 'shop-test-789', shopDomain: 'type-test.myshopify.com' });
    
    // Verifying accessToken with expectedType='refresh' must fail
    assert.throws(
      () => verifyRefreshToken(pair.accessToken),
      /Invalid token type: expected 'refresh', got 'access'/i
    );
  });
});


