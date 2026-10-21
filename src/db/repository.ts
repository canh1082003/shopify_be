import fs from 'fs';
import path from 'path';
import {
  Shop,
  ShopifySession,
  Order,
  Alert,
  Settings,
  NotificationLog,
  OrderFilterQuery,
  PaginatedResult,
} from '../types';
import {
  isDatabaseConnected as isMongoConnected,
  Shop as ShopModel,
  ShopifySession as SessionModel,
  Order as OrderModel,
  Alert as AlertModel,
  Settings as SettingsModel,
  NotificationLog as NotificationLogModel,
} from '../databases';

interface DatabaseSchema {
  shops: Record<string, Shop>;
  sessions: Record<string, ShopifySession>;
  orders: Record<string, Order[]>; // Keyed by shopId
  alerts: Record<string, Alert[]>; // Keyed by shopId
  settings: Record<string, Settings>; // Keyed by shopId
  notificationLogs: Record<string, NotificationLog[]>; // Keyed by shopId
}

export class Repository {
  private dataDir = path.resolve(__dirname, '../../data');
  private storeFile = path.resolve(this.dataDir, 'store.json');
  private db: DatabaseSchema = {
    shops: {},
    sessions: {},
    orders: {},
    alerts: {},
    settings: {},
    notificationLogs: {},
  };
  private isLoaded = false;

  constructor() {
    this.init();
  }

  private init(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.storeFile)) {
      try {
        const raw = fs.readFileSync(this.storeFile, 'utf8');
        this.db = JSON.parse(raw);
        this.isLoaded = true;
      } catch (err) {
        console.error('[Repository] Failed to read existing store.json, initializing fresh store', err);
      }
    }

    if (!this.isLoaded || Object.keys(this.db.shops).length === 0) {
      this.seedInitialData();
      this.persist();
    }
  }

  private persist(): void {
    try {
      const tempFile = `${this.storeFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(this.db, null, 2), 'utf8');
      fs.renameSync(tempFile, this.storeFile);
    } catch (err) {
      console.error('[Repository] Error persisting store.json', err);
    }
  }

  private seedInitialData(): void {
    const demoShopId = 'shop-demo-001';
    const now = Date.now();
    const hours = (h: number) => h * 60 * 60 * 1000;

    // 1. Demo Shop
    const demoShop: Shop = {
      id: demoShopId,
      shopDomain: 'quickstart-watchdog.myshopify.com',
      shopifyShopId: 'gid://shopify/Shop/82910482',
      name: 'Quickstart Watchdog Demo',
      email: 'merchant@quickstart-watchdog.myshopify.com',
      timezone: 'America/New_York',
      currency: 'USD',
      plan: 'Shopify Plus',
      installedAt: new Date(now - hours(24 * 30)).toISOString(),
      uninstalledAt: null,
      isDemo: true, // Transparently labeled as demo data
      createdAt: new Date(now - hours(24 * 30)).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 2. Demo Settings
    const demoSettings: Settings = {
      id: 'settings-demo-001',
      shopId: demoShopId,
      overdueThresholdHours: 24, // 24-hour default
      warningLeadTimeHours: 4, // Warn 4 hours before deadline
      emailEnabled: true,
      notificationEmail: 'merchant@quickstart-watchdog.myshopify.com',
      digestFrequency: 'immediate',
      autoAcknowledge: false,
      excludeTags: ['pre-order', 'custom-engraving'],
      updatedAt: new Date().toISOString(),
    };

    // 3. Seed Realistic Orders
    const sampleOrders: Order[] = [
      // Order 1: Critical Overdue (Created 48h ago, unfulfilled)
      {
        id: 'ord-1001',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938471',
        orderNumber: '#1048',
        name: '#1048',
        customerName: 'Sarah Jenkins',
        customerEmail: 'sarah.j@example.com',
        createdAt: new Date(now - hours(48)).toISOString(),
        processedAt: new Date(now - hours(48)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        totalAmount: 184.5,
        currencyCode: 'USD',
        totalItems: 2,
        fulfillableQuantity: 2,
        lineItems: [
          { id: 'item-1', title: 'Noise-Canceling Wireless Earbuds', quantity: 1, fulfillableQuantity: 1, price: 129.5, sku: 'NC-EAR-01' },
          { id: 'item-2', title: 'Protective Leather Carry Case', quantity: 1, fulfillableQuantity: 1, price: 55.0, sku: 'CASE-LTH-01' },
        ],
        deadline: new Date(now - hours(24)).toISOString(),
        isOverdue: true,
        overdueMinutes: 24 * 60,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938471',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 2: Critical Overdue (Created 38h ago, unfulfilled)
      {
        id: 'ord-1002',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938472',
        orderNumber: '#1047',
        name: '#1047',
        customerName: 'Marcus Vance',
        customerEmail: 'marcus.v@example.com',
        createdAt: new Date(now - hours(38)).toISOString(),
        processedAt: new Date(now - hours(38)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        totalAmount: 320.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 1,
        lineItems: [
          { id: 'item-3', title: 'Mechanical Ergonomic Studio Keyboard', quantity: 1, fulfillableQuantity: 1, price: 320.0, sku: 'KB-MECH-PRO' },
        ],
        deadline: new Date(now - hours(14)).toISOString(),
        isOverdue: true,
        overdueMinutes: 14 * 60,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938472',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 3: Critical Overdue (Partial fulfillment! Created 32h ago, 1 of 2 items remaining)
      {
        id: 'ord-1003',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938473',
        orderNumber: '#1046',
        name: '#1046',
        customerName: 'Elena Rostova',
        customerEmail: 'elena.r@example.com',
        createdAt: new Date(now - hours(32)).toISOString(),
        processedAt: new Date(now - hours(32)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'partial', // Partial fulfillment explicit test case
        totalAmount: 215.0,
        currencyCode: 'USD',
        totalItems: 2,
        fulfillableQuantity: 1, // 1 item still unfulfilled!
        lineItems: [
          { id: 'item-4', title: 'Smart Sensor Desk Lamp', quantity: 1, fulfillableQuantity: 0, price: 115.0, sku: 'LAMP-SMRT-01' },
          { id: 'item-5', title: 'Desk Organizer Tray (Backordered)', quantity: 1, fulfillableQuantity: 1, price: 100.0, sku: 'TRAY-WDN-02' },
        ],
        deadline: new Date(now - hours(8)).toISOString(),
        isOverdue: true,
        overdueMinutes: 8 * 60,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938473',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 4: Warning Stage (Created 21.5h ago, deadline is in 2.5h, within 4h warning lead time!)
      {
        id: 'ord-1004',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938474',
        orderNumber: '#1045',
        name: '#1045',
        customerName: 'David Chen',
        customerEmail: 'david.c@example.com',
        createdAt: new Date(now - hours(21.5)).toISOString(),
        processedAt: new Date(now - hours(21.5)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        totalAmount: 95.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 1,
        lineItems: [
          { id: 'item-6', title: 'Ultra-thin MagSafe Power Bank 10000mAh', quantity: 1, fulfillableQuantity: 1, price: 95.0, sku: 'PB-MAG-10K' },
        ],
        deadline: new Date(now + hours(2.5)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938474',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 5: On-Track Pending (Created 5h ago, 19h until deadline)
      {
        id: 'ord-1005',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938475',
        orderNumber: '#1044',
        name: '#1044',
        customerName: 'Aria Montgomery',
        customerEmail: 'aria.m@example.com',
        createdAt: new Date(now - hours(5)).toISOString(),
        processedAt: new Date(now - hours(5)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        totalAmount: 145.0,
        currencyCode: 'USD',
        totalItems: 3,
        fulfillableQuantity: 3,
        lineItems: [
          { id: 'item-7', title: 'Braided Fast Charging Cable 2m', quantity: 2, fulfillableQuantity: 2, price: 50.0, sku: 'CBL-BRD-2M' },
          { id: 'item-8', title: '65W GaN Dual USB-C Wall Charger', quantity: 1, fulfillableQuantity: 1, price: 45.0, sku: 'CHG-GAN-65W' },
        ],
        deadline: new Date(now + hours(19)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938475',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 6: Fulfilled on time (Created 18h ago, fulfilled 8h ago)
      {
        id: 'ord-1006',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938476',
        orderNumber: '#1043',
        name: '#1043',
        customerName: 'Liam O\'Connor',
        customerEmail: 'liam.oc@example.com',
        createdAt: new Date(now - hours(18)).toISOString(),
        processedAt: new Date(now - hours(18)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        totalAmount: 240.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 0,
        lineItems: [
          { id: 'item-9', title: 'Minimalist Aluminum Laptop Stand', quantity: 1, fulfillableQuantity: 0, price: 240.0, sku: 'STND-ALM-01' },
        ],
        deadline: new Date(now + hours(6)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938476',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 7: Fulfilled on time (Created 26h ago, fulfilled 4h ago)
      {
        id: 'ord-1007',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938477',
        orderNumber: '#1042',
        name: '#1042',
        customerName: 'Hannah Abbott',
        customerEmail: 'hannah.a@example.com',
        createdAt: new Date(now - hours(26)).toISOString(),
        processedAt: new Date(now - hours(26)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        totalAmount: 78.0,
        currencyCode: 'USD',
        totalItems: 2,
        fulfillableQuantity: 0,
        lineItems: [
          { id: 'item-10', title: 'Microfiber Screen Cleaning Kit', quantity: 2, fulfillableQuantity: 0, price: 78.0, sku: 'CLN-KIT-02' },
        ],
        deadline: new Date(now - hours(2)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938477',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 8: Excluded Canceled Order (Created 35h ago, but cancelled! Must NOT trigger overdue alert)
      {
        id: 'ord-1008',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938478',
        orderNumber: '#1041',
        name: '#1041',
        customerName: 'Robert Langdon',
        customerEmail: 'robert.l@example.com',
        createdAt: new Date(now - hours(35)).toISOString(),
        processedAt: new Date(now - hours(35)).toISOString(),
        cancelledAt: new Date(now - hours(30)).toISOString(), // Canceled!
        financialStatus: 'refunded',
        fulfillmentStatus: 'unfulfilled',
        totalAmount: 110.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 1,
        lineItems: [
          { id: 'item-11', title: 'Vintage Canvas Camera Bag', quantity: 1, fulfillableQuantity: 1, price: 110.0, sku: 'BAG-CAM-01' },
        ],
        deadline: new Date(now - hours(11)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938478',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 9: Excluded Unpaid Order (Pending payment; policy excludes unpaid orders from fulfillment deadline)
      {
        id: 'ord-1009',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938479',
        orderNumber: '#1040',
        name: '#1040',
        customerName: 'Grace Hopper',
        customerEmail: 'grace.h@example.com',
        createdAt: new Date(now - hours(28)).toISOString(),
        processedAt: new Date(now - hours(28)).toISOString(),
        cancelledAt: null,
        financialStatus: 'pending', // Unpaid!
        fulfillmentStatus: 'unfulfilled',
        totalAmount: 450.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 1,
        lineItems: [
          { id: 'item-12', title: 'Curved Ultrawide Workspace Display', quantity: 1, fulfillableQuantity: 1, price: 450.0, sku: 'DSP-CRV-34' },
        ],
        deadline: new Date(now - hours(4)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938479',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Order 10: Recent Paid Pending (Created 2h ago)
      {
        id: 'ord-1010',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938480',
        orderNumber: '#1039',
        name: '#1039',
        customerName: 'Zoe Kravitz',
        customerEmail: 'zoe.k@example.com',
        createdAt: new Date(now - hours(2)).toISOString(),
        processedAt: new Date(now - hours(2)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        totalAmount: 64.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 1,
        lineItems: [
          { id: 'item-13', title: 'Precision Stylus Pen Gen 2', quantity: 1, fulfillableQuantity: 1, price: 64.0, sku: 'PEN-STYL-02' },
        ],
        deadline: new Date(now + hours(22)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/quickstart-watchdog/orders/6102938480',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // 4. Seed Alerts
    const sampleAlerts: Alert[] = [
      {
        id: 'alert-001',
        shopId: demoShopId,
        orderId: 'ord-1001',
        orderNumber: '#1048',
        severity: 'critical',
        status: 'active',
        reason: 'Order unfulfilled for 48h (threshold: 24h). Immediate fulfillment required.',
        elapsedHours: 48,
        thresholdHours: 24,
        createdAt: new Date(now - hours(24)).toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
      },
      {
        id: 'alert-002',
        shopId: demoShopId,
        orderId: 'ord-1002',
        orderNumber: '#1047',
        severity: 'critical',
        status: 'active',
        reason: 'Order unfulfilled for 38h (threshold: 24h).',
        elapsedHours: 38,
        thresholdHours: 24,
        createdAt: new Date(now - hours(14)).toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
      },
      {
        id: 'alert-003',
        shopId: demoShopId,
        orderId: 'ord-1003',
        orderNumber: '#1046',
        severity: 'critical',
        status: 'acknowledged', // Demonstrates acknowledged status without false fulfillment
        reason: 'Partial fulfillment delayed: 1 item outstanding after 32h.',
        elapsedHours: 32,
        thresholdHours: 24,
        createdAt: new Date(now - hours(8)).toISOString(),
        acknowledgedAt: new Date(now - hours(4)).toISOString(),
        resolvedAt: null,
      },
      {
        id: 'alert-004',
        shopId: demoShopId,
        orderId: 'ord-1004',
        orderNumber: '#1045',
        severity: 'warning',
        status: 'active',
        reason: 'Deadline approaching in 2.5h (Elapsed: 21.5h / 24h).',
        elapsedHours: 21.5,
        thresholdHours: 24,
        createdAt: new Date(now - hours(1.5)).toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
      },
      {
        id: 'alert-005',
        shopId: demoShopId,
        orderId: 'ord-1007',
        orderNumber: '#1042',
        severity: 'resolved',
        status: 'resolved',
        reason: 'All items marked fulfilled in Shopify.',
        elapsedHours: 26,
        thresholdHours: 24,
        createdAt: new Date(now - hours(6)).toISOString(),
        acknowledgedAt: null,
        resolvedAt: new Date(now - hours(4)).toISOString(),
      },
    ];

    // 5. Seed Notification Logs
    const sampleLogs: NotificationLog[] = [
      {
        id: 'log-001',
        shopId: demoShopId,
        alertId: 'alert-001',
        recipient: 'merchant@quickstart-watchdog.myshopify.com',
        subject: '[Critical Alert] Order #1048 exceeded 24h fulfillment threshold',
        deliveryStatus: 'simulated_no_credentials',
        errorMessage: null,
        sentAt: new Date(now - hours(24)).toISOString(),
      },
      {
        id: 'log-002',
        shopId: demoShopId,
        alertId: 'alert-002',
        recipient: 'merchant@quickstart-watchdog.myshopify.com',
        subject: '[Critical Alert] Order #1047 exceeded 24h fulfillment threshold',
        deliveryStatus: 'simulated_no_credentials',
        errorMessage: null,
        sentAt: new Date(now - hours(14)).toISOString(),
      },
    ];

    this.db.shops[demoShopId] = demoShop;
    this.db.settings[demoShopId] = demoSettings;
    this.db.orders[demoShopId] = sampleOrders;
    this.db.alerts[demoShopId] = sampleAlerts;
    this.db.notificationLogs[demoShopId] = sampleLogs;
  }

  // Shop Operations
  public async getShop(shopId: string): Promise<Shop | null> {
    return this.db.shops[shopId] || null;
  }

  public async getPrimaryShop(): Promise<Shop> {
    const shops = Object.values(this.db.shops);
    if (shops.length > 0) return shops[0];
    throw new Error('No shop configured in store');
  }

  public async getShopByDomain(domain: string): Promise<Shop | null> {
    const clean = domain.toLowerCase().trim();
    return Object.values(this.db.shops).find((s) => s.shopDomain.toLowerCase() === clean) || null;
  }

  public async upsertShop(shop: Shop): Promise<Shop> {
    this.db.shops[shop.id] = { ...shop, updatedAt: new Date().toISOString() };
    if (!this.db.settings[shop.id]) {
      this.db.settings[shop.id] = {
        id: `settings-${shop.id}`,
        shopId: shop.id,
        overdueThresholdHours: 24,
        warningLeadTimeHours: 4,
        emailEnabled: true,
        notificationEmail: shop.email || 'merchant@example.com',
        digestFrequency: 'immediate',
        autoAcknowledge: false,
        excludeTags: [],
        updatedAt: new Date().toISOString(),
      };
    }
    this.persist();
    if (isMongoConnected()) {
      ShopModel.findByIdAndUpdate(shop.id, { ...shop, _id: shop.id }, { upsert: true }).catch((e) =>
        console.error('[Repository] MongoDB upsertShop error:', e)
      );
    }
    return this.db.shops[shop.id];
  }

  // Session Operations
  public async getSession(shopId: string): Promise<ShopifySession | null> {
    return this.db.sessions[shopId] || null;
  }

  public async saveSession(session: ShopifySession): Promise<void> {
    this.db.sessions[session.shopId] = { ...session, updatedAt: new Date().toISOString() };
    this.persist();
    if (isMongoConnected()) {
      SessionModel.findByIdAndUpdate(session.id, { ...session, _id: session.id }, { upsert: true }).catch((e) =>
        console.error('[Repository] MongoDB saveSession error:', e)
      );
    }
  }

  // Settings Operations
  public async getSettings(shopId: string): Promise<Settings> {
    if (!this.db.settings[shopId]) {
      const defaultSettings: Settings = {
        id: `settings-${shopId}`,
        shopId,
        overdueThresholdHours: 24,
        warningLeadTimeHours: 4,
        emailEnabled: true,
        notificationEmail: 'merchant@example.com',
        digestFrequency: 'immediate',
        autoAcknowledge: false,
        excludeTags: [],
        updatedAt: new Date().toISOString(),
      };
      this.db.settings[shopId] = defaultSettings;
      this.persist();
    }
    return this.db.settings[shopId];
  }

  public async updateSettings(shopId: string, partial: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings(shopId);
    const updated: Settings = {
      ...current,
      ...partial,
      overdueThresholdHours:
        partial.overdueThresholdHours !== undefined
          ? Number(partial.overdueThresholdHours)
          : current.overdueThresholdHours,
      warningLeadTimeHours:
        partial.warningLeadTimeHours !== undefined
          ? Number(partial.warningLeadTimeHours)
          : current.warningLeadTimeHours,
      updatedAt: new Date().toISOString(),
    };
    this.db.settings[shopId] = updated;
    this.persist();
    if (isMongoConnected()) {
      SettingsModel.findOneAndUpdate({ shopId }, { ...updated, _id: updated.id }, { upsert: true }).catch((e) =>
        console.error('[Repository] MongoDB updateSettings error:', e)
      );
    }
    return updated;
  }

  // Orders Operations (Server-side Pagination, Filtering & Sorting)
  public async getOrders(
    shopId: string,
    query: OrderFilterQuery = {}
  ): Promise<PaginatedResult<Order>> {
    let list = this.db.orders[shopId] ? [...this.db.orders[shopId]] : [];

    // Filter by status tab
    if (query.status && query.status !== 'all') {
      if (query.status === 'overdue') {
        list = list.filter((o) => o.isOverdue);
      } else if (query.status === 'pending') {
        list = list.filter((o) => o.fulfillmentStatus === 'unfulfilled' || o.fulfillmentStatus === 'partial');
      } else if (query.status === 'fulfilled') {
        list = list.filter((o) => o.fulfillmentStatus === 'fulfilled');
      }
    }

    // Filter by search query (orderNumber, customerName, customerEmail)
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          (o.customerName && o.customerName.toLowerCase().includes(q)) ||
          (o.customerEmail && o.customerEmail.toLowerCase().includes(q))
      );
    }

    // Filter by date range
    if (query.dateFrom) {
      const from = new Date(query.dateFrom).getTime();
      list = list.filter((o) => new Date(o.createdAt).getTime() >= from);
    }
    if (query.dateTo) {
      const to = new Date(query.dateTo).getTime();
      list = list.filter((o) => new Date(o.createdAt).getTime() <= to);
    }

    // Sorting
    const sortBy = query.sortBy || 'newest';
    if (sortBy === 'newest') {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === 'oldest') {
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (sortBy === 'overdue_desc') {
      list.sort((a, b) => b.overdueMinutes - a.overdueMinutes);
    }

    const total = list.length;
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 10);
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedItems = list.slice(startIndex, startIndex + limit);

    return {
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages,
    };
  }

  public async getOrderById(shopId: string, orderId: string): Promise<Order | null> {
    const list = this.db.orders[shopId] || [];
    return list.find((o) => o.id === orderId || o.shopifyOrderId === orderId) || null;
  }

  public async upsertOrder(shopId: string, order: Order): Promise<Order> {
    if (!this.db.orders[shopId]) this.db.orders[shopId] = [];
    const index = this.db.orders[shopId].findIndex(
      (o) => o.id === order.id || o.shopifyOrderId === order.shopifyOrderId
    );

    if (index >= 0) {
      this.db.orders[shopId][index] = { ...order, updatedAt: new Date().toISOString() };
    } else {
      this.db.orders[shopId].unshift({ ...order, updatedAt: new Date().toISOString() });
    }
    this.persist();
    if (isMongoConnected()) {
      OrderModel.findByIdAndUpdate(order.id, { ...order, _id: order.id, shopId }, { upsert: true }).catch((e) =>
        console.error('[Repository] MongoDB upsertOrder error:', e)
      );
    }
    return order;
  }

  public async getAllActiveOrders(shopId: string): Promise<Order[]> {
    return this.db.orders[shopId] ? [...this.db.orders[shopId]] : [];
  }

  // Alerts Operations
  public async getAlerts(
    shopId: string,
    filter: { severity?: string; status?: string; page?: number; limit?: number } = {}
  ): Promise<PaginatedResult<Alert>> {
    let list = this.db.alerts[shopId] ? [...this.db.alerts[shopId]] : [];

    if (filter.severity && filter.severity !== 'all') {
      list = list.filter((a) => a.severity.toLowerCase() === filter.severity?.toLowerCase());
    }
    if (filter.status && filter.status !== 'all') {
      list = list.filter((a) => a.status.toLowerCase() === filter.status?.toLowerCase());
    }

    // Default: Sort active & critical alerts first, then newest
    list.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = list.length;
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.max(1, Number(filter.limit) || 10);
    const totalPages = Math.ceil(total / limit) || 1;
    const paginatedItems = list.slice((page - 1) * limit, page * limit);

    return {
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages,
    };
  }

  public async getAlertById(shopId: string, alertId: string): Promise<Alert | null> {
    const list = this.db.alerts[shopId] || [];
    return list.find((a) => a.id === alertId) || null;
  }

  public async upsertAlert(shopId: string, alert: Alert): Promise<Alert> {
    if (!this.db.alerts[shopId]) this.db.alerts[shopId] = [];
    const index = this.db.alerts[shopId].findIndex((a) => a.id === alert.id);

    if (index >= 0) {
      this.db.alerts[shopId][index] = alert;
    } else {
      this.db.alerts[shopId].unshift(alert);
    }
    this.persist();
    this.syncAlertToMongo(shopId, alert);
    return alert;
  }

  private syncAlertToMongo(shopId: string, alert: Alert): void {
    if (!isMongoConnected()) return;
    AlertModel.findByIdAndUpdate(alert.id, { ...alert, _id: alert.id, shopId }, { upsert: true }).catch((e) =>
      console.error('[Repository] MongoDB alert sync error:', e)
    );
  }

  public async acknowledgeAlert(shopId: string, alertId: string): Promise<Alert | null> {
    const alert = await this.getAlertById(shopId, alertId);
    if (!alert) return null;

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date().toISOString();
    this.persist();
    this.syncAlertToMongo(shopId, alert);
    return alert;
  }

  public async resolveAlertsForOrder(shopId: string, orderId: string, reason?: string): Promise<void> {
    const list = this.db.alerts[shopId] || [];
    let updated = false;

    for (const alert of list) {
      if (alert.orderId === orderId && alert.status !== 'resolved') {
        alert.status = 'resolved';
        alert.severity = 'resolved';
        alert.resolvedAt = new Date().toISOString();
        if (reason) alert.reason = reason;
        this.syncAlertToMongo(shopId, alert);
        updated = true;
      }
    }
    if (updated) this.persist();
  }

  // Notification Logs
  public async addNotificationLog(log: NotificationLog): Promise<void> {
    if (!this.db.notificationLogs[log.shopId]) {
      this.db.notificationLogs[log.shopId] = [];
    }
    this.db.notificationLogs[log.shopId].unshift(log);
    this.persist();
    if (isMongoConnected()) {
      NotificationLogModel.findByIdAndUpdate(log.id, { ...log, _id: log.id, shopId: log.shopId }, { upsert: true }).catch((e) =>
        console.error('[Repository] MongoDB addNotificationLog error:', e)
      );
    }
  }

  public async getNotificationLogs(shopId: string, limit = 20): Promise<NotificationLog[]> {
    const list = this.db.notificationLogs[shopId] || [];
    return list.slice(0, limit);
  }

  // Dashboard Aggregates
  public async getDashboardSummary(shopId: string): Promise<{
    totalOrders: number;
    overdueOrders: number;
    pendingFulfillment: number;
    onTimeRate: number;
    activeAlertsCount: number;
  }> {
    const orders = this.db.orders[shopId] || [];
    const alerts = this.db.alerts[shopId] || [];

    const totalOrders = orders.length;
    const overdueOrders = orders.filter((o) => o.isOverdue).length;
    const pendingFulfillment = orders.filter(
      (o) => o.fulfillmentStatus === 'unfulfilled' || o.fulfillmentStatus === 'partial'
    ).length;

    const fulfilledOrders = orders.filter((o) => o.fulfillmentStatus === 'fulfilled');
    const eligibleOrders = totalOrders - orders.filter((o) => o.cancelledAt !== null).length;
    const onTimeRate =
      eligibleOrders > 0
        ? Math.round(((eligibleOrders - overdueOrders) / eligibleOrders) * 100)
        : 100;

    const activeAlertsCount = alerts.filter((a) => a.status === 'active').length;

    return {
      totalOrders,
      overdueOrders,
      pendingFulfillment,
      onTimeRate: Math.max(0, Math.min(100, onTimeRate)),
      activeAlertsCount,
    };
  }

  public async getDashboardTrends(
    shopId: string,
    days: 7 | 30 | 90
  ): Promise<Array<{ date: string; overdueCount: number; fulfilledCount: number; totalCount: number }>> {
    const orders = this.db.orders[shopId] || [];
    const points: Array<{ date: string; overdueCount: number; fulfilledCount: number; totalCount: number }> = [];

    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      // Match orders created on or before this day that were overdue / fulfilled
      const dayOrders = orders.filter((o) => o.createdAt.startsWith(dateStr));
      const overdueCount = dayOrders.filter((o) => o.isOverdue).length;
      const fulfilledCount = dayOrders.filter((o) => o.fulfillmentStatus === 'fulfilled').length;

      points.push({
        date: dateStr,
        overdueCount,
        fulfilledCount,
        totalCount: dayOrders.length,
      });
    }

    return points;
  }

  // MongoDB Atlas Synchronization
  public async syncWithMongo(): Promise<void> {
    if (!isMongoConnected()) return;
    try {
      const count = await ShopModel.countDocuments();
      if (count === 0) {
        console.log('[Repository] Seeding demo data to MongoDB Atlas collections...');
        for (const shop of Object.values(this.db.shops)) {
          await ShopModel.findByIdAndUpdate(shop.id, { ...shop, _id: shop.id }, { upsert: true });
        }
        for (const s of Object.values(this.db.settings)) {
          await SettingsModel.findByIdAndUpdate(s.id, { ...s, _id: s.id }, { upsert: true });
        }
        for (const shopId of Object.keys(this.db.orders)) {
          for (const order of this.db.orders[shopId]) {
            await OrderModel.findByIdAndUpdate(order.id, { ...order, _id: order.id, shopId }, { upsert: true });
          }
        }
        for (const shopId of Object.keys(this.db.alerts)) {
          for (const alert of this.db.alerts[shopId]) {
            await AlertModel.findByIdAndUpdate(alert.id, { ...alert, _id: alert.id, shopId }, { upsert: true });
          }
        }
        for (const shopId of Object.keys(this.db.notificationLogs)) {
          for (const log of this.db.notificationLogs[shopId]) {
            await NotificationLogModel.findByIdAndUpdate(log.id, { ...log, _id: log.id, shopId: log.shopId }, { upsert: true });
          }
        }
        console.log('[Repository] Demo data seeded successfully to MongoDB Atlas!');
      } else {
        console.log(`[Repository] MongoDB Atlas already has ${count} shop(s). Syncing from Atlas...`);
        // 1. Sync shops
        const mongoShops = await ShopModel.find().lean();
        for (const s of mongoShops) {
          const shopId = String(s._id);
          const local = this.db.shops[shopId];
          if (!local || new Date(s.updatedAt || s.createdAt).getTime() >= new Date(local.updatedAt || local.createdAt).getTime()) {
            this.db.shops[shopId] = { ...(s as any), id: shopId };
          }
        }

        // 2. Sync sessions
        const mongoSessions = await SessionModel.find().lean();
        for (const sess of mongoSessions) {
          this.db.sessions[sess.shopId] = { ...(sess as any), id: String(sess._id) };
        }

        // 3. Sync orders (and push missing local orders to Mongo)
        const mongoOrders = await OrderModel.find().lean();
        for (const o of mongoOrders) {
          const orderId = String(o._id);
          if (!this.db.orders[o.shopId]) this.db.orders[o.shopId] = [];
          const idx = this.db.orders[o.shopId].findIndex((x) => x.id === orderId);
          const orderObj = { ...(o as any), id: orderId };
          if (idx >= 0) {
            const local = this.db.orders[o.shopId][idx];
            if (new Date(o.updatedAt || o.createdAt).getTime() >= new Date(local.updatedAt || local.createdAt).getTime()) {
              this.db.orders[o.shopId][idx] = orderObj;
            }
          } else {
            this.db.orders[o.shopId].push(orderObj);
          }
        }
        for (const shopId of Object.keys(this.db.orders)) {
          for (const localOrder of this.db.orders[shopId]) {
            if (!mongoOrders.some((mo) => String(mo._id) === String(localOrder.id))) {
              await OrderModel.findByIdAndUpdate(localOrder.id, { ...localOrder, _id: localOrder.id, shopId }, { upsert: true });
            }
          }
        }

        // 4. Sync alerts
        const mongoAlerts = await AlertModel.find().lean();
        for (const a of mongoAlerts) {
          const alertId = String(a._id);
          if (!this.db.alerts[a.shopId]) this.db.alerts[a.shopId] = [];
          const idx = this.db.alerts[a.shopId].findIndex((x) => x.id === alertId);
          const alertObj = { ...(a as any), id: alertId };
          if (idx >= 0) {
            const local = this.db.alerts[a.shopId][idx];
            const mongoTime = new Date(a.resolvedAt || a.acknowledgedAt || a.createdAt).getTime();
            const localTime = new Date(local.resolvedAt || local.acknowledgedAt || local.createdAt).getTime();
            if (mongoTime >= localTime) {
              this.db.alerts[a.shopId][idx] = alertObj;
            }
          } else {
            this.db.alerts[a.shopId].push(alertObj);
          }
        }
        for (const shopId of Object.keys(this.db.alerts)) {
          for (const localAlert of this.db.alerts[shopId]) {
            if (!mongoAlerts.some((ma) => String(ma._id) === String(localAlert.id))) {
              this.syncAlertToMongo(shopId, localAlert);
            }
          }
        }

        // 5. Sync settings
        const mongoSettings = await SettingsModel.find().lean();
        for (const st of mongoSettings) {
          const local = this.db.settings[st.shopId];
          if (!local || new Date(st.updatedAt).getTime() >= new Date(local.updatedAt).getTime()) {
            this.db.settings[st.shopId] = { ...(st as any), id: String(st._id) };
          }
        }

        // 6. Sync notification logs
        const mongoLogs = await NotificationLogModel.find().lean();
        for (const log of mongoLogs) {
          const logId = String(log._id);
          if (!this.db.notificationLogs[log.shopId]) this.db.notificationLogs[log.shopId] = [];
          if (!this.db.notificationLogs[log.shopId].some((l) => l.id === logId)) {
            this.db.notificationLogs[log.shopId].push({ ...(log as any), id: logId });
          }
        }

        this.persist();
      }
    } catch (err) {
      console.error('[Repository] Error syncing with MongoDB:', err);
    }
  }
}

export const repository = new Repository();
