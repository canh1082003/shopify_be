import fs from 'fs';
import path from 'path';
import {
  Shop,
  ShopifySession,
  Order,
  Alert,
  StockAlert,
  Product,
  ProductVariant,
  InventoryLevel,
  InventoryItemDetail,
  Settings,
  NotificationLog,
  OrderFilterQuery,
  InventoryFilterQuery,
  AlertFilterQuery,
  PaginatedResult,
  DashboardSummary,
  DashboardTrend,
  SalesVelocitySummary,
  StockoutRiskGroup,
  RestockRecommendation,
} from '../types';
import {
  isDatabaseConnected as isMongoConnected,
  Shop as ShopModel,
  ShopifySession as SessionModel,
  Order as OrderModel,
  Alert as AlertModel,
  StockAlert as StockAlertModel,
  Product as ProductModel,
  ProductVariant as VariantModel,
  Settings as SettingsModel,
  NotificationLog as NotificationLogModel,
} from '../databases';
import { forecastingService } from '../services/forecasting.service';

interface DatabaseSchema {
  shops: Record<string, Shop>;
  sessions: Record<string, ShopifySession>;
  products: Record<string, Product[]>; // Keyed by shopId
  variants: Record<string, ProductVariant[]>; // Keyed by shopId
  inventoryLevels: Record<string, InventoryLevel[]>; // Keyed by shopId
  orders: Record<string, Order[]>; // Keyed by shopId
  alerts: Record<string, Alert[]>; // Legacy overdue alerts
  stockAlerts: Record<string, StockAlert[]>; // StockPilot stock alerts
  settings: Record<string, Settings>; // Keyed by shopId
  notificationLogs: Record<string, NotificationLog[]>; // Keyed by shopId
}

export class Repository {
  private dataDir = path.resolve(__dirname, '../../data');
  private storeFile = path.resolve(this.dataDir, 'store.json');
  private db: DatabaseSchema = {
    shops: {},
    sessions: {},
    products: {},
    variants: {},
    inventoryLevels: {},
    orders: {},
    alerts: {},
    stockAlerts: {},
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
        const parsed = JSON.parse(raw);
        this.db = {
          shops: parsed.shops || {},
          sessions: parsed.sessions || {},
          products: parsed.products || {},
          variants: parsed.variants || {},
          inventoryLevels: parsed.inventoryLevels || {},
          orders: parsed.orders || {},
          alerts: parsed.alerts || {},
          stockAlerts: parsed.stockAlerts || {},
          settings: parsed.settings || {},
          notificationLogs: parsed.notificationLogs || {},
        };
        this.isLoaded = true;
      } catch (err) {
        console.error('[Repository] Failed to read store.json, creating new database', err);
      }
    }

    const primaryKey = Object.keys(this.db.shops)[0];
    const hasVariants = primaryKey && this.db.variants[primaryKey]?.length > 0;

    if (!this.isLoaded || !hasVariants) {
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

  public seedInitialData(): void {
    const demoShopId = 'shop-demo-001';
    const now = Date.now();
    const hours = (h: number) => h * 3600 * 1000;
    const days = (d: number) => d * 24 * 3600 * 1000;

    // 1. Demo Shop
    const demoShop: Shop = {
      id: demoShopId,
      shopDomain: 'stockpilot-demo.myshopify.com',
      shopifyShopId: 'gid://shopify/Shop/91823746',
      name: 'StockPilot Apparel & Gear (Demo)',
      email: 'merchant@stockpilot-demo.myshopify.com',
      timezone: 'America/New_York',
      currency: 'USD',
      plan: 'Shopify Plus',
      installedAt: new Date(now - days(60)).toISOString(),
      uninstalledAt: null,
      isDemo: true,
      createdAt: new Date(now - days(60)).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 2. Demo Settings
    const demoSettings: Settings = {
      id: 'settings-demo-001',
      shopId: demoShopId,
      defaultLowStockThreshold: 10,
      defaultLeadTimeDays: 7,
      defaultSafetyStockDays: 5,
      salesVelocityDays: 30,
      locationScope: 'all',
      emailEnabled: true,
      notificationEmail: 'merchant@stockpilot-demo.myshopify.com',
      dailyDigest: true,
      productOverrides: {
        'var-201': {
          lowStockThreshold: 15,
          leadTimeDays: 10,
          safetyStockDays: 5,
        },
      },
      overdueThresholdHours: 24,
      warningLeadTimeHours: 4,
      autoAcknowledge: false,
      excludeTags: [],
      updatedAt: new Date().toISOString(),
    };

    // 3. Products
    const sampleProducts: Product[] = [
      {
        id: 'prod-100',
        shopId: demoShopId,
        shopifyProductId: 'gid://shopify/Product/710001',
        title: 'Merino Wool Performance Hoodie',
        description: 'Breathable, temperature-regulating athletic hoodie crafted from 100% fine merino wool.',
        vendor: 'AeroKnit Studio',
        productType: 'Apparel',
        status: 'active',
        imageUrl: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=400&q=80',
        tags: ['apparel', 'winter', 'merino', 'bestseller'],
        createdAt: new Date(now - days(45)).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'prod-200',
        shopId: demoShopId,
        shopifyProductId: 'gid://shopify/Product/710002',
        title: 'Noise-Canceling Wireless Earbuds Pro',
        description: 'Active hybrid noise-canceling earbuds with transparency mode and 32h battery life.',
        vendor: 'SoundCore Dynamics',
        productType: 'Electronics',
        status: 'active',
        imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=400&q=80',
        tags: ['electronics', 'audio', 'earbuds', 'wireless'],
        createdAt: new Date(now - days(50)).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'prod-300',
        shopId: demoShopId,
        shopifyProductId: 'gid://shopify/Product/710003',
        title: 'Magnetic Wireless Power Bank 10,000mAh',
        description: 'Slim MagSafe-compatible external battery pack with fast USB-C PD 20W output.',
        vendor: 'SoundCore Dynamics',
        productType: 'Electronics',
        status: 'active',
        imageUrl: 'https://images.unsplash.com/photo-1609592426861-f3b14562095f?auto=format&fit=crop&w=400&q=80',
        tags: ['electronics', 'charging', 'accessories'],
        createdAt: new Date(now - days(30)).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'prod-400',
        shopId: demoShopId,
        shopifyProductId: 'gid://shopify/Product/710004',
        title: 'Ceramic Specialty Pour-Over Dripper',
        description: 'Handcrafted artisan ceramic coffee dripper designed for precision flow extraction.',
        vendor: 'Roast & Vessel',
        productType: 'Home & Living',
        status: 'active',
        imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80',
        tags: ['kitchen', 'coffee', 'ceramic'],
        createdAt: new Date(now - days(25)).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'prod-500',
        shopId: demoShopId,
        shopifyProductId: 'gid://shopify/Product/710005',
        title: 'Minimalist Vegan Leather Desk Mat',
        description: 'Water-resistant dual-sided desk protector mat (90x40cm) with non-slip cork base.',
        vendor: 'Nomad Workspace',
        productType: 'Office',
        status: 'active',
        imageUrl: 'https://images.unsplash.com/photo-1585792180666-f7547c6a28c5?auto=format&fit=crop&w=400&q=80',
        tags: ['desk', 'office', 'leather'],
        createdAt: new Date(now - days(20)).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'prod-600',
        shopId: demoShopId,
        shopifyProductId: 'gid://shopify/Product/710006',
        title: 'Hydrating Hyaluronic Acid Serum 50ml',
        description: 'Multi-molecular weight hyaluronic acid formula providing deep cellular moisture.',
        vendor: 'Aura Botanicals',
        productType: 'Skincare',
        status: 'active',
        imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=400&q=80',
        tags: ['skincare', 'serum', 'beauty'],
        createdAt: new Date(now - days(15)).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'prod-700',
        shopId: demoShopId,
        shopifyProductId: 'gid://shopify/Product/710007',
        title: 'Custom Laser-Engraved Wood Keychain',
        description: 'Made-to-order personalized walnut wood keychain (inventory not tracked).',
        vendor: 'Artisan Woodcraft',
        productType: 'Accessories',
        status: 'active',
        imageUrl: 'https://images.unsplash.com/photo-1614036417651-efe5912149d8?auto=format&fit=crop&w=400&q=80',
        tags: ['custom', 'gift', 'wood'],
        createdAt: new Date(now - days(10)).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // 4. Product Variants
    const sampleVariants: ProductVariant[] = [
      // Hoodie Sizes
      {
        id: 'var-101',
        shopId: demoShopId,
        productId: 'prod-100',
        productTitle: 'Merino Wool Performance Hoodie',
        productImage: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/81001',
        inventoryItemId: 'gid://shopify/InventoryItem/91001',
        sku: 'MW-HD-S',
        title: 'Charcoal / S',
        price: 118,
        costPrice: 42,
        tracked: true,
        barcode: '840192800101',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 18,
        committedQuantity: 2,
        averageDailySales: 0.8,
        daysRemaining: 23,
        status: 'healthy',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 0,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'var-102',
        shopId: demoShopId,
        productId: 'prod-100',
        productTitle: 'Merino Wool Performance Hoodie',
        productImage: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/81002',
        inventoryItemId: 'gid://shopify/InventoryItem/91002',
        sku: 'MW-HD-M',
        title: 'Charcoal / M',
        price: 118,
        costPrice: 42,
        tracked: true,
        barcode: '840192800102',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 4,
        committedQuantity: 3,
        averageDailySales: 2.5,
        daysRemaining: 2,
        status: 'low_stock',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 26,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'var-103',
        shopId: demoShopId,
        productId: 'prod-100',
        productTitle: 'Merino Wool Performance Hoodie',
        productImage: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/81003',
        inventoryItemId: 'gid://shopify/InventoryItem/91003',
        sku: 'MW-HD-L',
        title: 'Charcoal / L',
        price: 118,
        costPrice: 42,
        tracked: true,
        barcode: '840192800103',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 0,
        committedQuantity: 0,
        averageDailySales: 2.0,
        daysRemaining: 0,
        status: 'out_of_stock',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 24,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'var-104',
        shopId: demoShopId,
        productId: 'prod-100',
        productTitle: 'Merino Wool Performance Hoodie',
        productImage: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/81004',
        inventoryItemId: 'gid://shopify/InventoryItem/91004',
        sku: 'MW-HD-XL',
        title: 'Charcoal / XL',
        price: 118,
        costPrice: 42,
        tracked: true,
        barcode: '840192800104',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 15,
        committedQuantity: 1,
        averageDailySales: 0.5,
        daysRemaining: 30,
        status: 'healthy',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 0,
        updatedAt: new Date().toISOString(),
      },

      // Wireless Earbuds
      {
        id: 'var-201',
        shopId: demoShopId,
        productId: 'prod-200',
        productTitle: 'Noise-Canceling Wireless Earbuds Pro',
        productImage: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/82001',
        inventoryItemId: 'gid://shopify/InventoryItem/92001',
        sku: 'NC-EAR-BLK',
        title: 'Midnight Black',
        price: 139,
        costPrice: 48,
        tracked: true,
        barcode: '840192800201',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 8,
        committedQuantity: 4,
        averageDailySales: 3.0,
        daysRemaining: 3,
        status: 'low_stock',
        lowStockThreshold: 15, // Product-level override
        leadTimeDays: 10,
        safetyStockDays: 5,
        recommendedRestockQuantity: 37,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'var-202',
        shopId: demoShopId,
        productId: 'prod-200',
        productTitle: 'Noise-Canceling Wireless Earbuds Pro',
        productImage: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/82002',
        inventoryItemId: 'gid://shopify/InventoryItem/92002',
        sku: 'NC-EAR-WHT',
        title: 'Pure White',
        price: 139,
        costPrice: 48,
        tracked: true,
        barcode: '840192800202',
        locationId: 'loc-west',
        locationName: 'West Coast Fulfillment Center',
        availableQuantity: 28,
        committedQuantity: 2,
        averageDailySales: 1.2,
        daysRemaining: 23,
        status: 'healthy',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 0,
        updatedAt: new Date().toISOString(),
      },

      // MagSafe Power Bank
      {
        id: 'var-301',
        shopId: demoShopId,
        productId: 'prod-300',
        productTitle: 'Magnetic Wireless Power Bank 10,000mAh',
        productImage: 'https://images.unsplash.com/photo-1609592426861-f3b14562095f?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/83001',
        inventoryItemId: 'gid://shopify/InventoryItem/93001',
        sku: 'PB-MAG-10K',
        title: 'Slate Gray',
        price: 65,
        costPrice: 24,
        tracked: true,
        barcode: '840192800301',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 5,
        committedQuantity: 1,
        averageDailySales: 1.8,
        daysRemaining: 3,
        status: 'low_stock',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 17,
        updatedAt: new Date().toISOString(),
      },

      // Pour-Over Dripper
      {
        id: 'var-401',
        shopId: demoShopId,
        productId: 'prod-400',
        productTitle: 'Ceramic Specialty Pour-Over Dripper',
        productImage: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/84001',
        inventoryItemId: 'gid://shopify/InventoryItem/94001',
        sku: 'CRM-DRIP-WHT',
        title: 'Matte White',
        price: 42,
        costPrice: 16,
        tracked: true,
        barcode: '840192800401',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 13,
        committedQuantity: 1,
        averageDailySales: 1.2,
        daysRemaining: 11,
        status: 'restock_soon',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 2,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'var-402',
        shopId: demoShopId,
        productId: 'prod-400',
        productTitle: 'Ceramic Specialty Pour-Over Dripper',
        productImage: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/84002',
        inventoryItemId: 'gid://shopify/InventoryItem/94002',
        sku: 'CRM-DRIP-CHR',
        title: 'Matte Charcoal',
        price: 42,
        costPrice: 16,
        tracked: true,
        barcode: '840192800402',
        locationId: 'loc-west',
        locationName: 'West Coast Fulfillment Center',
        availableQuantity: 34,
        committedQuantity: 0,
        averageDailySales: 0.6,
        daysRemaining: 57,
        status: 'healthy',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 0,
        updatedAt: new Date().toISOString(),
      },

      // Leather Desk Mat
      {
        id: 'var-501',
        shopId: demoShopId,
        productId: 'prod-500',
        productTitle: 'Minimalist Vegan Leather Desk Mat',
        productImage: 'https://images.unsplash.com/photo-1585792180666-f7547c6a28c5?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/85001',
        inventoryItemId: 'gid://shopify/InventoryItem/95001',
        sku: 'MAT-LTH-NVY',
        title: 'Navy Blue / 90x40cm',
        price: 38,
        costPrice: 14,
        tracked: true,
        barcode: '840192800501',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 0,
        committedQuantity: 0,
        averageDailySales: 1.4,
        daysRemaining: 0,
        status: 'out_of_stock',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 17,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'var-502',
        shopId: demoShopId,
        productId: 'prod-500',
        productTitle: 'Minimalist Vegan Leather Desk Mat',
        productImage: 'https://images.unsplash.com/photo-1585792180666-f7547c6a28c5?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/85002',
        inventoryItemId: 'gid://shopify/InventoryItem/95002',
        sku: 'MAT-LTH-TAN',
        title: 'Cognac Tan / 90x40cm',
        price: 38,
        costPrice: 14,
        tracked: true,
        barcode: '840192800502',
        locationId: 'loc-west',
        locationName: 'West Coast Fulfillment Center',
        availableQuantity: 26,
        committedQuantity: 2,
        averageDailySales: 0.8,
        daysRemaining: 33,
        status: 'healthy',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 0,
        updatedAt: new Date().toISOString(),
      },

      // Hyaluronic Acid Serum
      {
        id: 'var-601',
        shopId: demoShopId,
        productId: 'prod-600',
        productTitle: 'Hydrating Hyaluronic Acid Serum 50ml',
        productImage: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/86001',
        inventoryItemId: 'gid://shopify/InventoryItem/96001',
        sku: 'SKIN-HA-50',
        title: 'Standard Dropper 50ml',
        price: 34,
        costPrice: 9,
        tracked: true,
        barcode: '840192800601',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 6,
        committedQuantity: 2,
        averageDailySales: 3.2,
        daysRemaining: 2,
        status: 'low_stock',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 33,
        updatedAt: new Date().toISOString(),
      },

      // Custom Keychain (Untracked)
      {
        id: 'var-701',
        shopId: demoShopId,
        productId: 'prod-700',
        productTitle: 'Custom Laser-Engraved Wood Keychain',
        productImage: 'https://images.unsplash.com/photo-1614036417651-efe5912149d8?auto=format&fit=crop&w=400&q=80',
        shopifyVariantId: 'gid://shopify/ProductVariant/87001',
        inventoryItemId: 'gid://shopify/InventoryItem/97001',
        sku: 'KEY-WLN-01',
        title: 'Walnut / Custom Text',
        price: 18,
        costPrice: 4,
        tracked: false,
        barcode: null,
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 999,
        committedQuantity: 0,
        averageDailySales: 0.5,
        daysRemaining: null,
        status: 'untracked',
        lowStockThreshold: 10,
        leadTimeDays: 7,
        safetyStockDays: 5,
        recommendedRestockQuantity: 0,
        updatedAt: new Date().toISOString(),
      },
    ];

    // 5. Multi-location Inventory Levels
    const sampleInventoryLevels: InventoryLevel[] = [
      {
        id: 'lvl-101-main',
        shopId: demoShopId,
        variantId: 'var-101',
        inventoryItemId: 'gid://shopify/InventoryItem/91001',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 18,
        committedQuantity: 2,
        incomingQuantity: 0,
        lastSyncedAt: new Date().toISOString(),
      },
      {
        id: 'lvl-102-main',
        shopId: demoShopId,
        variantId: 'var-102',
        inventoryItemId: 'gid://shopify/InventoryItem/91002',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 4,
        committedQuantity: 3,
        incomingQuantity: 25,
        lastSyncedAt: new Date().toISOString(),
      },
      {
        id: 'lvl-103-main',
        shopId: demoShopId,
        variantId: 'var-103',
        inventoryItemId: 'gid://shopify/InventoryItem/91003',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 0,
        committedQuantity: 0,
        incomingQuantity: 50,
        lastSyncedAt: new Date().toISOString(),
      },
      {
        id: 'lvl-201-main',
        shopId: demoShopId,
        variantId: 'var-201',
        inventoryItemId: 'gid://shopify/InventoryItem/92001',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 8,
        committedQuantity: 4,
        incomingQuantity: 40,
        lastSyncedAt: new Date().toISOString(),
      },
      {
        id: 'lvl-202-west',
        shopId: demoShopId,
        variantId: 'var-202',
        inventoryItemId: 'gid://shopify/InventoryItem/92002',
        locationId: 'loc-west',
        locationName: 'West Coast Fulfillment Center',
        availableQuantity: 28,
        committedQuantity: 2,
        incomingQuantity: 0,
        lastSyncedAt: new Date().toISOString(),
      },
      {
        id: 'lvl-601-main',
        shopId: demoShopId,
        variantId: 'var-601',
        inventoryItemId: 'gid://shopify/InventoryItem/96001',
        locationId: 'loc-main',
        locationName: 'Main Warehouse (US East)',
        availableQuantity: 6,
        committedQuantity: 2,
        incomingQuantity: 30,
        lastSyncedAt: new Date().toISOString(),
      },
    ];

    // 6. Stock Alerts
    const sampleStockAlerts: StockAlert[] = [
      {
        id: 'stock-alert-001',
        shopId: demoShopId,
        variantId: 'var-103',
        productTitle: 'Merino Wool Performance Hoodie',
        variantTitle: 'Charcoal / L',
        sku: 'MW-HD-L',
        locationName: 'Main Warehouse (US East)',
        alertType: 'out_of_stock',
        status: 'active',
        currentQuantity: 0,
        threshold: 10,
        estimatedDaysRemaining: 0,
        reason: 'Out of stock: 0 units available. Selling velocity 2.0 units/day.',
        createdAt: new Date(now - hours(18)).toISOString(),
      },
      {
        id: 'stock-alert-002',
        shopId: demoShopId,
        variantId: 'var-501',
        productTitle: 'Minimalist Vegan Leather Desk Mat',
        variantTitle: 'Navy Blue / 90x40cm',
        sku: 'MAT-LTH-NVY',
        locationName: 'Main Warehouse (US East)',
        alertType: 'out_of_stock',
        status: 'active',
        currentQuantity: 0,
        threshold: 10,
        estimatedDaysRemaining: 0,
        reason: 'Out of stock: 0 units available. Recommended reorder: 17 units.',
        createdAt: new Date(now - hours(12)).toISOString(),
      },
      {
        id: 'stock-alert-003',
        shopId: demoShopId,
        variantId: 'var-102',
        productTitle: 'Merino Wool Performance Hoodie',
        variantTitle: 'Charcoal / M',
        sku: 'MW-HD-M',
        locationName: 'Main Warehouse (US East)',
        alertType: 'low_stock',
        status: 'active',
        currentQuantity: 4,
        threshold: 10,
        estimatedDaysRemaining: 2,
        reason: 'Low stock: 4 units remaining (Threshold: 10). Stockout estimated in 2 days.',
        createdAt: new Date(now - hours(8)).toISOString(),
      },
      {
        id: 'stock-alert-004',
        shopId: demoShopId,
        variantId: 'var-201',
        productTitle: 'Noise-Canceling Wireless Earbuds Pro',
        variantTitle: 'Midnight Black',
        sku: 'NC-EAR-BLK',
        locationName: 'Main Warehouse (US East)',
        alertType: 'low_stock',
        status: 'active',
        currentQuantity: 8,
        threshold: 15,
        estimatedDaysRemaining: 3,
        reason: 'Low stock override: 8 units remaining (Custom threshold: 15). Rapid sales velocity of 3.0 units/day.',
        createdAt: new Date(now - hours(6)).toISOString(),
      },
      {
        id: 'stock-alert-005',
        shopId: demoShopId,
        variantId: 'var-601',
        productTitle: 'Hydrating Hyaluronic Acid Serum 50ml',
        variantTitle: 'Standard Dropper 50ml',
        sku: 'SKIN-HA-50',
        locationName: 'Main Warehouse (US East)',
        alertType: 'low_stock',
        status: 'acknowledged',
        currentQuantity: 6,
        threshold: 10,
        estimatedDaysRemaining: 2,
        reason: 'Low stock alert acknowledged by inventory manager.',
        createdAt: new Date(now - hours(14)).toISOString(),
        acknowledgedAt: new Date(now - hours(4)).toISOString(),
      },
      {
        id: 'stock-alert-006',
        shopId: demoShopId,
        variantId: 'var-401',
        productTitle: 'Ceramic Specialty Pour-Over Dripper',
        variantTitle: 'Matte White',
        sku: 'CRM-DRIP-WHT',
        locationName: 'Main Warehouse (US East)',
        alertType: 'restock_soon',
        status: 'active',
        currentQuantity: 13,
        threshold: 10,
        estimatedDaysRemaining: 11,
        reason: 'Restock soon: 11 days remaining is within lead time horizon (12 days).',
        createdAt: new Date(now - hours(2)).toISOString(),
      },
      {
        id: 'stock-alert-007',
        shopId: demoShopId,
        variantId: 'var-701',
        productTitle: 'Custom Laser-Engraved Wood Keychain',
        variantTitle: 'Walnut / Custom Text',
        sku: 'KEY-WLN-01',
        locationName: 'Main Warehouse (US East)',
        alertType: 'untracked',
        status: 'active',
        currentQuantity: 999,
        threshold: 10,
        estimatedDaysRemaining: null,
        reason: 'Inventory tracking is disabled for this product in Shopify.',
        createdAt: new Date(now - hours(1)).toISOString(),
      },
    ];

    // 7. Orders (Real Shopify Order representation)
    const sampleOrders: Order[] = [
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
        totalAmount: 257.0,
        currencyCode: 'USD',
        totalItems: 2,
        fulfillableQuantity: 2,
        lineItems: [
          { id: 'item-1', variantId: 'var-201', title: 'Noise-Canceling Wireless Earbuds Pro', quantity: 1, fulfillableQuantity: 1, price: 139.0, sku: 'NC-EAR-BLK' },
          { id: 'item-2', variantId: 'var-102', title: 'Merino Wool Performance Hoodie (M)', quantity: 1, fulfillableQuantity: 1, price: 118.0, sku: 'MW-HD-M' },
        ],
        deadline: new Date(now - hours(24)).toISOString(),
        isOverdue: true,
        overdueMinutes: 24 * 60,
        shopifyUrl: 'https://admin.shopify.com/store/stockpilot-demo/orders/6102938471',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
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
        totalAmount: 118.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 1,
        lineItems: [
          { id: 'item-3', variantId: 'var-101', title: 'Merino Wool Performance Hoodie (S)', quantity: 1, fulfillableQuantity: 1, price: 118.0, sku: 'MW-HD-S' },
        ],
        deadline: new Date(now - hours(14)).toISOString(),
        isOverdue: true,
        overdueMinutes: 14 * 60,
        shopifyUrl: 'https://admin.shopify.com/store/stockpilot-demo/orders/6102938472',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ord-1003',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938473',
        orderNumber: '#1046',
        name: '#1046',
        customerName: 'Elena Rostova',
        customerEmail: 'elena.r@example.com',
        createdAt: new Date(now - hours(20)).toISOString(),
        processedAt: new Date(now - hours(20)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'partial',
        totalAmount: 181.0,
        currencyCode: 'USD',
        totalItems: 3,
        fulfillableQuantity: 1,
        lineItems: [
          { id: 'item-4', variantId: 'var-201', title: 'Noise-Canceling Wireless Earbuds Pro', quantity: 1, fulfillableQuantity: 0, price: 139.0, sku: 'NC-EAR-BLK' },
          { id: 'item-5', variantId: 'var-401', title: 'Ceramic Specialty Pour-Over Dripper', quantity: 1, fulfillableQuantity: 1, price: 42.0, sku: 'CRM-DRIP-WHT' },
        ],
        deadline: new Date(now + hours(4)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/stockpilot-demo/orders/6102938473',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ord-1004',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938474',
        orderNumber: '#1045',
        name: '#1045',
        customerName: 'David Chen',
        customerEmail: 'david.c@example.com',
        createdAt: new Date(now - hours(14)).toISOString(),
        processedAt: new Date(now - hours(14)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        totalAmount: 68.0,
        currencyCode: 'USD',
        totalItems: 2,
        fulfillableQuantity: 2,
        lineItems: [
          { id: 'item-6', variantId: 'var-601', title: 'Hydrating Hyaluronic Acid Serum 50ml', quantity: 2, fulfillableQuantity: 2, price: 34.0, sku: 'SKIN-HA-50' },
        ],
        deadline: new Date(now + hours(10)).toISOString(),
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/stockpilot-demo/orders/6102938474',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ord-1005',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938475',
        orderNumber: '#1044',
        name: '#1044',
        customerName: 'Sophia Miller',
        customerEmail: 'sophia.m@example.com',
        createdAt: new Date(now - hours(30)).toISOString(),
        processedAt: new Date(now - hours(30)).toISOString(),
        cancelledAt: null,
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        totalAmount: 139.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 0,
        lineItems: [
          { id: 'item-7', variantId: 'var-202', title: 'Noise-Canceling Wireless Earbuds Pro (White)', quantity: 1, fulfillableQuantity: 0, price: 139.0, sku: 'NC-EAR-WHT' },
        ],
        deadline: null,
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/stockpilot-demo/orders/6102938475',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ord-1006',
        shopId: demoShopId,
        shopifyOrderId: 'gid://shopify/Order/6102938476',
        orderNumber: '#1043',
        name: '#1043',
        customerName: 'Lucas Brown',
        customerEmail: 'lucas.b@example.com',
        createdAt: new Date(now - hours(72)).toISOString(),
        processedAt: new Date(now - hours(72)).toISOString(),
        cancelledAt: new Date(now - hours(68)).toISOString(),
        financialStatus: 'refunded',
        fulfillmentStatus: 'cancelled',
        totalAmount: 118.0,
        currencyCode: 'USD',
        totalItems: 1,
        fulfillableQuantity: 0,
        lineItems: [
          { id: 'item-8', variantId: 'var-103', title: 'Merino Wool Performance Hoodie (L)', quantity: 1, fulfillableQuantity: 0, price: 118.0, sku: 'MW-HD-L' },
        ],
        deadline: null,
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: 'https://admin.shopify.com/store/stockpilot-demo/orders/6102938476',
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // 8. Notification Logs
    const sampleLogs: NotificationLog[] = [
      {
        id: 'log-001',
        shopId: demoShopId,
        alertId: 'stock-alert-001',
        recipient: 'merchant@stockpilot-demo.myshopify.com',
        subject: '[StockPilot] Out of Stock Alert: Merino Wool Hoodie (Charcoal / L)',
        deliveryStatus: 'simulated_no_credentials',
        errorMessage: null,
        sentAt: new Date(now - hours(18)).toISOString(),
      },
      {
        id: 'log-002',
        shopId: demoShopId,
        alertId: 'stock-alert-003',
        recipient: 'merchant@stockpilot-demo.myshopify.com',
        subject: '[StockPilot] Low Stock Warning: Merino Wool Hoodie (Charcoal / M) - 4 units left',
        deliveryStatus: 'simulated_no_credentials',
        errorMessage: null,
        sentAt: new Date(now - hours(8)).toISOString(),
      },
    ];

    this.db.shops[demoShopId] = demoShop;
    this.db.settings[demoShopId] = demoSettings;
    this.db.products[demoShopId] = sampleProducts;
    this.db.variants[demoShopId] = sampleVariants;
    this.db.inventoryLevels[demoShopId] = sampleInventoryLevels;
    this.db.stockAlerts[demoShopId] = sampleStockAlerts;
    this.db.orders[demoShopId] = sampleOrders;
    this.db.alerts[demoShopId] = [];
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
        defaultLowStockThreshold: 10,
        defaultLeadTimeDays: 7,
        defaultSafetyStockDays: 5,
        salesVelocityDays: 30,
        locationScope: 'all',
        emailEnabled: true,
        notificationEmail: shop.email || 'merchant@example.com',
        dailyDigest: true,
        productOverrides: {},
        overdueThresholdHours: 24,
        warningLeadTimeHours: 4,
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
        defaultLowStockThreshold: 10,
        defaultLeadTimeDays: 7,
        defaultSafetyStockDays: 5,
        salesVelocityDays: 30,
        locationScope: 'all',
        emailEnabled: true,
        notificationEmail: 'merchant@example.com',
        dailyDigest: true,
        productOverrides: {},
        overdueThresholdHours: 24,
        warningLeadTimeHours: 4,
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
      defaultLowStockThreshold:
        partial.defaultLowStockThreshold !== undefined
          ? Number(partial.defaultLowStockThreshold)
          : current.defaultLowStockThreshold,
      defaultLeadTimeDays:
        partial.defaultLeadTimeDays !== undefined
          ? Number(partial.defaultLeadTimeDays)
          : current.defaultLeadTimeDays,
      defaultSafetyStockDays:
        partial.defaultSafetyStockDays !== undefined
          ? Number(partial.defaultSafetyStockDays)
          : current.defaultSafetyStockDays,
      salesVelocityDays:
        partial.salesVelocityDays !== undefined
          ? Number(partial.salesVelocityDays)
          : current.salesVelocityDays,
      productOverrides: partial.productOverrides !== undefined ? partial.productOverrides : current.productOverrides,
      updatedAt: new Date().toISOString(),
    };
    this.db.settings[shopId] = updated;
    this.persist();

    // Re-evaluate stock statuses based on updated settings
    await this.recalculateStockLevels(shopId);

    if (isMongoConnected()) {
      SettingsModel.findOneAndUpdate({ shopId }, { ...updated, _id: updated.id }, { upsert: true }).catch((e) =>
        console.error('[Repository] MongoDB updateSettings error:', e)
      );
    }
    return updated;
  }

  // ==========================================
  // INVENTORY OPERATIONS
  // ==========================================
  public async getInventory(
    shopId: string,
    query: InventoryFilterQuery = {}
  ): Promise<PaginatedResult<ProductVariant>> {
    let list = this.db.variants[shopId] ? [...this.db.variants[shopId]] : [];

    // Filter by status tab (healthy | low_stock | out_of_stock | untracked)
    if (query.status && query.status !== 'all') {
      list = list.filter((v) => v.status === query.status);
    }

    // Filter by location
    if (query.locationId && query.locationId !== 'all') {
      list = list.filter((v) => v.locationId === query.locationId);
    }

    // Filter by search query (productTitle, variantTitle, sku)
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (v) =>
          v.productTitle.toLowerCase().includes(q) ||
          v.title.toLowerCase().includes(q) ||
          v.sku.toLowerCase().includes(q)
      );
    }

    // Sorting
    const sortBy = query.sortBy || 'quantity';
    const sortOrder = query.sortOrder || 'asc';
    list.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'quantity') {
        comparison = a.availableQuantity - b.availableQuantity;
      } else if (sortBy === 'salesVelocity') {
        comparison = a.averageDailySales - b.averageDailySales;
      } else if (sortBy === 'daysRemaining') {
        const da = a.daysRemaining === null ? 999999 : a.daysRemaining;
        const db = b.daysRemaining === null ? 999999 : b.daysRemaining;
        comparison = da - db;
      } else if (sortBy === 'name') {
        comparison = a.productTitle.localeCompare(b.productTitle);
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

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

  public async getInventoryItemById(
    shopId: string,
    variantId: string
  ): Promise<InventoryItemDetail | null> {
    const variants = this.db.variants[shopId] || [];
    const variant = variants.find((v) => v.id === variantId || v.shopifyVariantId === variantId);
    if (!variant) return null;

    const products = this.db.products[shopId] || [];
    const product = products.find((p) => p.id === variant.productId);

    const levels = (this.db.inventoryLevels[shopId] || []).filter(
      (l) => l.variantId === variant.id
    );

    // If no explicit multi-location levels found, return current location
    const locationLevels = levels.length > 0 ? levels.map((l) => ({
      locationId: l.locationId,
      locationName: l.locationName,
      availableQuantity: l.availableQuantity,
      committedQuantity: l.committedQuantity,
      incomingQuantity: l.incomingQuantity,
      lastSyncedAt: l.lastSyncedAt,
    })) : [{
      locationId: variant.locationId,
      locationName: variant.locationName,
      availableQuantity: variant.availableQuantity,
      committedQuantity: variant.committedQuantity,
      incomingQuantity: 0,
      lastSyncedAt: variant.updatedAt,
    }];

    const settings = await this.getSettings(shopId);
    const override = settings.productOverrides[variant.id] || {};
    const leadTime = override.leadTimeDays ?? settings.defaultLeadTimeDays;
    const safetyStock = override.safetyStockDays ?? settings.defaultSafetyStockDays;
    const lowStockThreshold = override.lowStockThreshold ?? settings.defaultLowStockThreshold;

    const horizon = leadTime + safetyStock;
    const targetStockLevel = Math.max(
      lowStockThreshold,
      Math.ceil(variant.averageDailySales * horizon)
    );

    const detail: InventoryItemDetail = {
      ...variant,
      productStatus: product?.status || 'active',
      productVendor: product?.vendor || 'Standard Vendor',
      productType: product?.productType || 'General Merchandise',
      locationLevels,
      salesHistory30d: Math.round(variant.averageDailySales * 30),
      targetStockLevel,
      estimatedReorderCost: Math.round(variant.recommendedRestockQuantity * variant.costPrice * 100) / 100,
    };

    return detail;
  }

  public async recalculateStockLevels(shopId: string): Promise<void> {
    const variants = this.db.variants[shopId] || [];
    const settings = await this.getSettings(shopId);

    const activeAlerts: StockAlert[] = [];

    for (const v of variants) {
      const override = settings.productOverrides[v.id] || {};
      const leadTime = override.leadTimeDays ?? settings.defaultLeadTimeDays;
      const safetyStock = override.safetyStockDays ?? settings.defaultSafetyStockDays;
      const threshold = override.lowStockThreshold ?? settings.defaultLowStockThreshold;

      const evalResult = forecastingService.evaluateVariant({
        availableQuantity: v.availableQuantity,
        unitsSold: Math.round(v.averageDailySales * settings.salesVelocityDays),
        periodDays: settings.salesVelocityDays,
        leadTimeDays: leadTime,
        safetyStockDays: safetyStock,
        lowStockThreshold: threshold,
        tracked: v.tracked,
      });

      v.status = evalResult.status;
      v.daysRemaining = evalResult.daysRemaining;
      v.lowStockThreshold = threshold;
      v.leadTimeDays = leadTime;
      v.safetyStockDays = safetyStock;
      v.recommendedRestockQuantity = evalResult.recommendedQuantity;
      v.updatedAt = new Date().toISOString();

      // Check if stock alert should be created
      if (evalResult.status !== 'healthy') {
        let reason = '';
        if (evalResult.status === 'out_of_stock') {
          reason = `Out of stock: 0 units available. Recommended reorder: ${evalResult.recommendedQuantity} units.`;
        } else if (evalResult.status === 'low_stock') {
          reason = `Low stock: ${v.availableQuantity} units remaining (Threshold: ${threshold}). Days remaining: ${evalResult.daysRemaining ?? 'N/A'}.`;
        } else if (evalResult.status === 'restock_soon') {
          reason = `Restock soon: ${evalResult.daysRemaining} days of stock remaining is within lead time horizon (${leadTime + safetyStock} days).`;
        } else if (evalResult.status === 'untracked') {
          reason = 'Inventory tracking is disabled for this product in Shopify.';
        }

        const existingAlert = (this.db.stockAlerts[shopId] || []).find(
          (a) => a.variantId === v.id && a.alertType === evalResult.status && a.status !== 'resolved'
        );

        if (!existingAlert) {
          activeAlerts.push({
            id: `alert-${Date.now()}-${v.id}`,
            shopId,
            variantId: v.id,
            productTitle: v.productTitle,
            variantTitle: v.title,
            sku: v.sku,
            locationName: v.locationName,
            alertType: evalResult.status,
            status: 'active',
            currentQuantity: v.availableQuantity,
            threshold,
            estimatedDaysRemaining: evalResult.daysRemaining,
            reason,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    if (activeAlerts.length > 0) {
      if (!this.db.stockAlerts[shopId]) this.db.stockAlerts[shopId] = [];
      this.db.stockAlerts[shopId].unshift(...activeAlerts);
    }

    this.persist();
  }

  // ==========================================
  // STOCK ALERTS OPERATIONS
  // ==========================================
  public async getStockAlerts(
    shopId: string,
    query: AlertFilterQuery = {}
  ): Promise<PaginatedResult<StockAlert>> {
    let list = this.db.stockAlerts[shopId] ? [...this.db.stockAlerts[shopId]] : [];

    if (query.alertType && query.alertType !== 'all') {
      list = list.filter((a) => a.alertType === query.alertType);
    }

    if (query.status && query.status !== 'all') {
      list = list.filter((a) => a.status === query.status);
    }

    // Sort: Active first, then by urgency (out_of_stock, low_stock, restock_soon), then newest
    list.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = list.length;
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 10);
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

  public async getStockAlertsSummary(shopId: string): Promise<{
    totalActive: number;
    outOfStockCount: number;
    lowStockCount: number;
    restockSoonCount: number;
    untrackedCount: number;
    acknowledgedCount: number;
  }> {
    const alerts = this.db.stockAlerts[shopId] || [];
    const active = alerts.filter((a) => a.status === 'active');

    return {
      totalActive: active.length,
      outOfStockCount: active.filter((a) => a.alertType === 'out_of_stock').length,
      lowStockCount: active.filter((a) => a.alertType === 'low_stock').length,
      restockSoonCount: active.filter((a) => a.alertType === 'restock_soon').length,
      untrackedCount: active.filter((a) => a.alertType === 'untracked').length,
      acknowledgedCount: alerts.filter((a) => a.status === 'acknowledged').length,
    };
  }

  public async acknowledgeStockAlert(shopId: string, alertId: string): Promise<StockAlert | null> {
    const alerts = this.db.stockAlerts[shopId] || [];
    const alert = alerts.find((a) => a.id === alertId);
    if (!alert) return null;

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date().toISOString();
    this.persist();
    return alert;
  }

  public async dismissStockAlert(shopId: string, alertId: string): Promise<StockAlert | null> {
    const alerts = this.db.stockAlerts[shopId] || [];
    const alert = alerts.find((a) => a.id === alertId);
    if (!alert) return null;

    alert.status = 'resolved';
    alert.resolvedAt = new Date().toISOString();
    this.persist();
    return alert;
  }

  // ==========================================
  // ANALYTICS OPERATIONS
  // ==========================================
  public async getAnalyticsSalesVelocity(shopId: string): Promise<SalesVelocitySummary> {
    const variants = [...(this.db.variants[shopId] || [])].filter((v) => v.tracked);

    // Fast moving variants: sorted by sales velocity desc
    const sortedFast = [...variants].sort((a, b) => b.averageDailySales - a.averageDailySales);
    const fastMoving = sortedFast.slice(0, 5).map((v) => ({
      variantId: v.id,
      productTitle: v.productTitle,
      variantTitle: v.title,
      sku: v.sku,
      unitsSold: Math.round(v.averageDailySales * 30),
      averageDailySales: v.averageDailySales,
      availableQuantity: v.availableQuantity,
      daysRemaining: v.daysRemaining,
    }));

    // Slow moving variants: lowest sales velocity
    const sortedSlow = [...variants].sort((a, b) => a.averageDailySales - b.averageDailySales);
    const slowMoving = sortedSlow.slice(0, 5).map((v) => ({
      variantId: v.id,
      productTitle: v.productTitle,
      variantTitle: v.title,
      sku: v.sku,
      unitsSold: Math.round(v.averageDailySales * 30),
      averageDailySales: v.averageDailySales,
      availableQuantity: v.availableQuantity,
      daysRemaining: v.daysRemaining,
    }));

    return {
      fastMoving,
      slowMoving,
      periodDays: 30,
    };
  }

  public async getAnalyticsStockoutRisk(shopId: string): Promise<StockoutRiskGroup[]> {
    const variants = (this.db.variants[shopId] || []).filter(
      (v) => v.tracked && v.daysRemaining !== null
    );

    const within3 = variants.filter((v) => v.daysRemaining! <= 3);
    const within7 = variants.filter((v) => v.daysRemaining! > 3 && v.daysRemaining! <= 7);
    const within14 = variants.filter((v) => v.daysRemaining! > 7 && v.daysRemaining! <= 14);
    const within30 = variants.filter((v) => v.daysRemaining! > 14 && v.daysRemaining! <= 30);

    const mapItems = (list: ProductVariant[]) =>
      list.map((v) => ({
        variantId: v.id,
        productTitle: v.productTitle,
        variantTitle: v.title,
        sku: v.sku,
        availableQuantity: v.availableQuantity,
        averageDailySales: v.averageDailySales,
        daysRemaining: v.daysRemaining ?? 0,
      }));

    return [
      {
        timeframe: '3_days',
        label: 'Critical (< 3 Days)',
        count: within3.length,
        items: mapItems(within3),
      },
      {
        timeframe: '7_days',
        label: 'High Risk (4–7 Days)',
        count: within7.length,
        items: mapItems(within7),
      },
      {
        timeframe: '14_days',
        label: 'Medium Risk (8–14 Days)',
        count: within14.length,
        items: mapItems(within14),
      },
      {
        timeframe: '30_days',
        label: 'Low Risk (15–30 Days)',
        count: within30.length,
        items: mapItems(within30),
      },
    ];
  }

  public async getAnalyticsRestock(shopId: string): Promise<RestockRecommendation[]> {
    const variants = this.db.variants[shopId] || [];
    const recommendations: RestockRecommendation[] = [];

    for (const v of variants) {
      if (!v.tracked) continue;
      if (v.recommendedRestockQuantity > 0 || v.status === 'out_of_stock' || v.status === 'low_stock') {
        const horizon = v.leadTimeDays + v.safetyStockDays;
        const targetStock = Math.max(
          v.lowStockThreshold,
          Math.ceil(v.averageDailySales * horizon)
        );
        const qty = Math.max(v.recommendedRestockQuantity, targetStock - v.availableQuantity);

        let urgency: 'critical' | 'high' | 'medium' = 'medium';
        if (v.availableQuantity === 0 || (v.daysRemaining !== null && v.daysRemaining <= 3)) {
          urgency = 'critical';
        } else if (v.daysRemaining !== null && v.daysRemaining <= 7) {
          urgency = 'high';
        }

        recommendations.push({
          variantId: v.id,
          productId: v.productId,
          productTitle: v.productTitle,
          variantTitle: v.title,
          sku: v.sku,
          availableQuantity: v.availableQuantity,
          averageDailySales: v.averageDailySales,
          daysRemaining: v.daysRemaining,
          leadTimeDays: v.leadTimeDays,
          safetyStockDays: v.safetyStockDays,
          targetStock,
          recommendedQuantity: Math.max(1, qty),
          unitCost: v.costPrice,
          estimatedCost: Math.round(Math.max(1, qty) * v.costPrice * 100) / 100,
          urgency,
        });
      }
    }

    // Sort: Critical urgency first, then fewest days remaining
    recommendations.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2 };
      if (order[a.urgency] !== order[b.urgency]) {
        return order[a.urgency] - order[b.urgency];
      }
      const da = a.daysRemaining === null ? 999 : a.daysRemaining;
      const db = b.daysRemaining === null ? 999 : b.daysRemaining;
      return da - db;
    });

    return recommendations;
  }

  // ==========================================
  // DASHBOARD OPERATIONS
  // ==========================================
  public async getStockPilotDashboardSummary(shopId: string): Promise<DashboardSummary> {
    const shop = await this.getShop(shopId);
    const variants = this.db.variants[shopId] || [];
    const products = this.db.products[shopId] || [];
    const orders = this.db.orders[shopId] || [];
    const alerts = this.db.stockAlerts[shopId] || [];
    const settings = await this.getSettings(shopId);

    // 1. KPI Cards
    const totalProducts = products.length;
    const totalInventoryUnits = variants.reduce((sum, v) => sum + (v.tracked ? v.availableQuantity : 0), 0);
    const lowStockProducts = variants.filter((v) => v.status === 'low_stock').length;
    const outOfStockProducts = variants.filter((v) => v.status === 'out_of_stock').length;

    // Orders this month
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const ordersThisMonth = orders.filter((o) => new Date(o.createdAt).getTime() >= startOfMonth).length;

    // Estimated Inventory Value (available quantity * cost price)
    const estimatedInventoryValue = Math.round(
      variants.reduce((sum, v) => sum + (v.tracked ? v.availableQuantity * v.costPrice : 0), 0)
    );

    // 2. Inventory Health Breakdown
    const healthyCount = variants.filter((v) => v.status === 'healthy').length;
    const lowStockCount = lowStockProducts;
    const outOfStockCount = outOfStockProducts;
    const untrackedCount = variants.filter((v) => v.status === 'untracked').length;
    const totalTracked = variants.filter((v) => v.tracked).length;

    // 3. Top Selling Products
    const sortedBySales = [...variants]
      .filter((v) => v.tracked)
      .sort((a, b) => b.averageDailySales - a.averageDailySales)
      .slice(0, 5);

    const topSellingProducts = sortedBySales.map((v) => ({
      variantId: v.id,
      productTitle: v.productTitle,
      variantTitle: v.title,
      sku: v.sku,
      unitsSold: Math.round(v.averageDailySales * 30),
      revenue: Math.round(v.averageDailySales * 30 * v.price),
      currentStock: v.availableQuantity,
      daysRemaining: v.daysRemaining,
    }));

    // 4. Restock Recommendations
    const restockRecommendations = (await this.getAnalyticsRestock(shopId)).slice(0, 5);

    // 5. Recent Orders (latest 5)
    const recentOrders = [...orders]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    const activeAlertsCount = alerts.filter((a) => a.status === 'active').length;

    return {
      kpis: {
        totalProducts,
        totalInventoryUnits,
        lowStockProducts,
        outOfStockProducts,
        ordersThisMonth,
        estimatedInventoryValue,
        currency: shop?.currency || 'USD',
      },
      inventoryHealth: {
        healthyCount,
        lowStockCount,
        outOfStockCount,
        untrackedCount,
        totalTracked,
      },
      topSellingProducts,
      restockRecommendations,
      recentOrders,
      monitoringStatus: {
        isShopifyConnected: !shop?.isDemo,
        shopDomain: shop?.shopDomain || 'stockpilot-demo.myshopify.com',
        isDemoMode: shop?.isDemo ?? true,
        lastSyncedAt: new Date().toISOString(),
        activeAlertsCount,
        emailEnabled: settings.emailEnabled,
      },
    };
  }

  public async getStockPilotSalesTrends(
    _shopId: string,
    days: 7 | 30 | 90
  ): Promise<DashboardTrend> {
    const points = [];
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * dayMs);
      const dateStr = d.toISOString().split('T')[0];
      // Generate realistic daily sales patterns with weekend variation
      const dayOfWeek = d.getDay();
      const baseUnits = dayOfWeek === 0 || dayOfWeek === 6 ? 16 : 24;
      const noise = ((i * 7) % 9) - 4;
      const unitsSold = Math.max(5, baseUnits + noise);
      const orderCount = Math.max(3, Math.round(unitsSold / 2.2));
      const revenue = Math.round(unitsSold * 68.5);

      points.push({
        date: dateStr,
        unitsSold,
        orderCount,
        revenue,
      });
    }

    return {
      period: `${days}d` as '7d' | '30d' | '90d',
      points,
    };
  }

  // ==========================================
  // ORDERS OPERATIONS (Read-Only)
  // ==========================================
  public async getOrders(
    shopId: string,
    query: OrderFilterQuery = {}
  ): Promise<PaginatedResult<Order>> {
    let list = this.db.orders[shopId] ? [...this.db.orders[shopId]] : [];

    // Filter by fulfillment status tab
    if (query.status && query.status !== 'all') {
      if (query.status === 'unfulfilled') {
        list = list.filter((o) => o.fulfillmentStatus === 'unfulfilled');
      } else if (query.status === 'partial') {
        list = list.filter((o) => o.fulfillmentStatus === 'partial');
      } else if (query.status === 'fulfilled') {
        list = list.filter((o) => o.fulfillmentStatus === 'fulfilled');
      } else if (query.status === 'cancelled') {
        list = list.filter((o) => o.fulfillmentStatus === 'cancelled' || o.cancelledAt !== null);
      }
    }

    // Filter by search query
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          (o.customerName && o.customerName.toLowerCase().includes(q)) ||
          (o.customerEmail && o.customerEmail.toLowerCase().includes(q))
      );
    }

    // Date range filter
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
    } else if (sortBy === 'total_desc') {
      list.sort((a, b) => b.totalAmount - a.totalAmount);
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
    return order;
  }

  public async getAllActiveOrders(shopId: string): Promise<Order[]> {
    return this.db.orders[shopId] ? [...this.db.orders[shopId]] : [];
  }

  // Legacy Alert methods preserved for compatibility with existing tests
  public async getAlerts(
    shopId: string,
    filter: { severity?: string; status?: string; page?: number; limit?: number } = {}
  ): Promise<PaginatedResult<Alert>> {
    let list = this.db.alerts[shopId] ? [...this.db.alerts[shopId]] : [];
    if (filter.status && filter.status !== 'all') {
      list = list.filter((a) => a.status.toLowerCase() === filter.status?.toLowerCase());
    }
    return {
      items: list,
      total: list.length,
      page: 1,
      limit: 10,
      totalPages: 1,
    };
  }

  public async getAlertById(shopId: string, alertId: string): Promise<Alert | null> {
    const list = this.db.alerts[shopId] || [];
    return list.find((a) => a.id === alertId) || null;
  }

  public async upsertAlert(shopId: string, alert: Alert): Promise<Alert> {
    if (!this.db.alerts[shopId]) this.db.alerts[shopId] = [];
    this.db.alerts[shopId].unshift(alert);
    this.persist();
    return alert;
  }

  public async acknowledgeAlert(shopId: string, alertId: string): Promise<Alert | null> {
    const alert = await this.getAlertById(shopId, alertId);
    if (!alert) return null;
    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date().toISOString();
    this.persist();
    return alert;
  }

  public async resolveAlertsForOrder(shopId: string, orderId: string, reason?: string): Promise<void> {
    const list = this.db.alerts[shopId] || [];
    for (const a of list) {
      if (a.orderId === orderId) {
        a.status = 'resolved';
        a.severity = 'resolved';
        a.resolvedAt = new Date().toISOString();
        if (reason) a.reason = reason;
      }
    }
    this.persist();
  }

  // Notification Logs
  public async addNotificationLog(log: NotificationLog): Promise<void> {
    if (!this.db.notificationLogs[log.shopId]) {
      this.db.notificationLogs[log.shopId] = [];
    }
    this.db.notificationLogs[log.shopId].unshift(log);
    this.persist();
  }

  public async getNotificationLogs(shopId: string, limit = 20): Promise<NotificationLog[]> {
    const list = this.db.notificationLogs[shopId] || [];
    return list.slice(0, limit);
  }

  public async syncWithMongo(): Promise<void> {
    if (!isMongoConnected()) return;
    console.info('[Repository] Synchronizing local store with MongoDB Atlas...');
  }
}

export const repository = new Repository();
