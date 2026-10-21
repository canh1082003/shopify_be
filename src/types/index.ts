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

export interface LineItem {
  id: string;
  title: string;
  quantity: number;
  fulfillableQuantity: number;
  price: number;
  sku?: string;
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
  | 'restocked';

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
  deadline: string | null;
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

export interface Settings {
  id: string;
  shopId: string;
  overdueThresholdHours: number; // 12, 24, 48, or custom hours
  warningLeadTimeHours: number; // e.g. 4h before deadline
  emailEnabled: boolean;
  notificationEmail: string;
  digestFrequency: 'immediate' | 'daily' | 'hourly';
  autoAcknowledge: boolean;
  excludeTags: string[];
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

export interface DashboardSummary {
  totalOrders: number;
  overdueOrders: number;
  pendingFulfillment: number;
  onTimeRate: number;
  comparison: {
    totalOrdersDiff?: number;
    overdueDiff?: number;
  } | null;
  monitoringStatus: {
    isShopifyConnected: boolean;
    shopDomain: string;
    isDemoMode: boolean;
    lastSyncedAt: string;
    thresholdHours: number;
    emailEnabled: boolean;
    activeAlertsCount: number;
  };
}

export interface TrendPoint {
  date: string;
  overdueCount: number;
  fulfilledCount: number;
  totalCount: number;
}

export interface DashboardTrend {
  period: '7d' | '30d' | '90d';
  points: TrendPoint[];
}

export interface OrderFilterQuery {
  status?: 'all' | 'overdue' | 'pending' | 'fulfilled';
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'newest' | 'oldest' | 'overdue_desc';
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
  webhookCount: number;
  activeOrdersCount: number;
}
