export interface Shop {
  id: string;
  shopDomain: string;
  shopifyShopId?: string | null;
  name: string;
  email?: string | null;
  timezone: string;
  currency: string;
  plan: string;
  installedAt: string;
  uninstalledAt?: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShopifySession {
  id: string;
  shopId: string;
  sessionType: 'offline' | 'online';
  encryptedAccessToken: string;
  iv: string;
  authTag: string;
  scope: string;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FinancialStatus =
  | 'paid'
  | 'authorized'
  | 'pending'
  | 'partially_refunded'
  | 'refunded'
  | 'voided';

export type FulfillmentStatus =
  | 'unfulfilled'
  | 'partial'
  | 'fulfilled'
  | 'restocked'
  | 'cancelled';

export interface LineItem {
  id: string;
  variantId?: string;
  title: string;
  quantity: number;
  fulfillableQuantity: number;
  price: number;
  sku?: string;
}

export interface Order {
  id: string;
  shopId: string;
  shopifyOrderId: string;
  orderNumber: string;
  name: string;
  customerName?: string | null;
  customerEmail?: string | null;
  createdAt: string;
  processedAt?: string | null;
  cancelledAt?: string | null;
  financialStatus: FinancialStatus;
  fulfillmentStatus: FulfillmentStatus;
  totalAmount: number;
  currencyCode: string;
  totalItems: number;
  fulfillableQuantity: number;
  lineItems: LineItem[];
  deadline?: string | null;
  isOverdue: boolean;
  overdueMinutes: number;
  shopifyUrl?: string | null;
  lastSyncedAt: string;
  updatedAt: string;
}

export type AlertSeverity = 'warning' | 'critical' | 'resolved';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  shopId: string;
  orderId: string;
  orderNumber: string;
  severity: AlertSeverity;
  status: AlertStatus;
  reason: string;
  elapsedHours: number;
  thresholdHours: number;
  createdAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
}

export type StockStatus =
  | 'healthy'
  | 'low_stock'
  | 'out_of_stock'
  | 'restock_soon'
  | 'untracked';

export type AlertType =
  | 'low_stock'
  | 'out_of_stock'
  | 'restock_soon'
  | 'untracked';

export interface ProductVariant {
  id: string;
  shopId: string;
  productId: string;
  productTitle: string;
  productImage?: string | null;
  shopifyVariantId: string;
  inventoryItemId: string;
  sku: string;
  title: string;
  price: number;
  costPrice: number;
  tracked: boolean;
  barcode?: string | null;
  locationId: string;
  locationName: string;
  availableQuantity: number;
  committedQuantity: number;
  averageDailySales: number;
  daysRemaining: number | null;
  status: StockStatus;
  lowStockThreshold: number;
  leadTimeDays: number;
  safetyStockDays: number;
  recommendedRestockQuantity: number;
  updatedAt: string;
}

export interface InventoryItemDetail extends ProductVariant {
  productStatus: 'active' | 'draft' | 'archived';
  productVendor: string;
  productType: string;
  locationLevels: Array<{
    locationId: string;
    locationName: string;
    availableQuantity: number;
    committedQuantity: number;
    incomingQuantity: number;
    lastSyncedAt: string;
  }>;
  salesHistory30d: number;
  targetStockLevel: number;
  estimatedReorderCost: number;
}

export interface Product {
  id: string;
  shopId: string;
  shopifyProductId: string;
  title: string;
  description?: string;
  vendor: string;
  productType: string;
  status: 'active' | 'draft' | 'archived';
  imageUrl?: string | null;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InventoryLevel {
  id: string;
  shopId: string;
  variantId: string;
  inventoryItemId: string;
  locationId: string;
  locationName: string;
  availableQuantity: number;
  committedQuantity: number;
  incomingQuantity: number;
  lastSyncedAt: string;
}

export interface StockAlert {
  id: string;
  shopId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  locationName: string;
  alertType: AlertType;
  status: AlertStatus;
  currentQuantity: number;
  threshold: number;
  estimatedDaysRemaining: number | null;
  reason: string;
  createdAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
}

export interface ProductOverride {
  lowStockThreshold?: number;
  leadTimeDays?: number;
  safetyStockDays?: number;
}

export interface Settings {
  id: string;
  shopId: string;
  defaultLowStockThreshold: number;
  defaultLeadTimeDays: number;
  defaultSafetyStockDays: number;
  salesVelocityDays: number;
  locationScope: 'all' | string;
  emailEnabled: boolean;
  notificationEmail: string;
  dailyDigest: boolean;
  productOverrides: Record<string, ProductOverride>;
  // Legacy fields for backward compatibility
  overdueThresholdHours: number;
  warningLeadTimeHours: number;
  autoAcknowledge?: boolean;
  excludeTags?: string[];
  digestFrequency?: 'immediate' | 'daily' | 'hourly';
  updatedAt: string;
}

export interface NotificationLog {
  id: string;
  shopId: string;
  alertId?: string | null;
  recipient: string;
  subject: string;
  deliveryStatus: 'sent' | 'failed' | 'simulated_no_credentials';
  errorMessage?: string | null;
  sentAt: string;
}

export interface DashboardKPIs {
  totalProducts: number;
  totalInventoryUnits: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  ordersThisMonth: number;
  estimatedInventoryValue: number;
  currency: string;
}

export interface InventoryHealthBreakdown {
  healthyCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  untrackedCount: number;
  totalTracked: number;
}

export interface TopSellingProduct {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  unitsSold: number;
  revenue: number;
  currentStock: number;
  daysRemaining: number | null;
}

export interface RestockRecommendation {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  availableQuantity: number;
  averageDailySales: number;
  daysRemaining: number | null;
  leadTimeDays: number;
  safetyStockDays: number;
  targetStock: number;
  recommendedQuantity: number;
  unitCost: number;
  estimatedCost: number;
  urgency: 'critical' | 'high' | 'medium';
}

export interface DashboardSummary {
  kpis: DashboardKPIs;
  inventoryHealth: InventoryHealthBreakdown;
  topSellingProducts: TopSellingProduct[];
  restockRecommendations: RestockRecommendation[];
  recentOrders: Order[];
  monitoringStatus: {
    isShopifyConnected: boolean;
    shopDomain: string;
    isDemoMode: boolean;
    lastSyncedAt: string;
    activeAlertsCount: number;
    emailEnabled: boolean;
    thresholdHours?: number;
  };
}

export interface TrendPoint {
  date: string;
  unitsSold: number;
  orderCount: number;
  revenue: number;
}

export interface DashboardTrend {
  period: '7d' | '30d' | '90d';
  points: TrendPoint[];
}

export interface StockoutRiskGroup {
  timeframe: '3_days' | '7_days' | '14_days' | '30_days';
  label: string;
  count: number;
  items: Array<{
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku: string;
    availableQuantity: number;
    averageDailySales: number;
    daysRemaining: number;
  }>;
}

export interface SalesVelocitySummary {
  fastMoving: Array<{
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku: string;
    unitsSold: number;
    averageDailySales: number;
    availableQuantity: number;
    daysRemaining: number | null;
  }>;
  slowMoving: Array<{
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku: string;
    unitsSold: number;
    averageDailySales: number;
    availableQuantity: number;
    daysRemaining: number | null;
  }>;
  periodDays: number;
}

export interface InventoryFilterQuery {
  status?: 'all' | 'healthy' | 'low_stock' | 'out_of_stock' | 'untracked';
  search?: string;
  locationId?: string;
  sortBy?: 'quantity' | 'salesVelocity' | 'daysRemaining' | 'name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface OrderFilterQuery {
  status?: 'all' | 'unfulfilled' | 'partial' | 'fulfilled' | 'cancelled' | 'overdue' | 'pending';
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'newest' | 'oldest' | 'total_desc' | 'overdue_desc';
  page?: number;
  limit?: number;
}

export interface AlertFilterQuery {
  alertType?: 'all' | AlertType;
  status?: 'all' | AlertStatus;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  statusCode?: number;
  errorCode?: string;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface HealthCheckData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  version: string;
  environment: string;
  memoryUsage: {
    rss: string;
    heapTotal: string;
    heapUsed: string;
  };
}

export interface ShopifyIntegrationStatus {
  isConfigured: boolean;
  isShopifyConnected: boolean;
  shopDomain: string;
  isDemoMode: boolean;
  appUrl: string;
  scopes: string[];
  lastSyncedAt: string;
  activeOrdersCount: number;
  totalProductsCount: number;
  totalVariantsCount: number;
}
