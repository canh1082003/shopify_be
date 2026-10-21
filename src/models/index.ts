import mongoose, { Schema } from 'mongoose';
import {
  Shop,
  ShopifySession,
  Order,
  Alert,
  Settings,
  NotificationLog,
  LineItem,
} from '../types';

// ============================================================================
// 1. SHOP MODEL
// ============================================================================
export interface ShopDocument extends Omit<Shop, 'id'> {
  _id: string;
}

const ShopSchema = new Schema<ShopDocument>(
  {
    _id: { type: String, required: true },
    shopDomain: { type: String, required: true, unique: true, index: true },
    shopifyShopId: { type: String, default: null },
    name: { type: String, required: true },
    email: { type: String, default: null },
    timezone: { type: String, default: 'UTC' },
    currency: { type: String, default: 'USD' },
    plan: { type: String, default: 'basic' },
    installedAt: { type: String, required: true },
    uninstalledAt: { type: String, default: null },
    isDemo: { type: Boolean, default: false },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  {
    collection: 'shops',
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

export const ShopModel = mongoose.model<ShopDocument>('Shop', ShopSchema);

// ============================================================================
// 2. SHOPIFY SESSION MODEL
// ============================================================================
export interface SessionDocument extends Omit<ShopifySession, 'id'> {
  _id: string;
}

const SessionSchema = new Schema<SessionDocument>(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    sessionType: { type: String, enum: ['offline', 'online'], default: 'offline' },
    encryptedAccessToken: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    scope: { type: String, required: true },
    expiresAt: { type: String, default: null },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  {
    collection: 'shopify_sessions',
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

export const SessionModel = mongoose.model<SessionDocument>('ShopifySession', SessionSchema);

// ============================================================================
// 3. ORDER MODEL
// ============================================================================
export interface OrderDocument extends Omit<Order, 'id'> {
  _id: string;
}

const LineItemSchema = new Schema<LineItem>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    quantity: { type: Number, required: true },
    fulfillableQuantity: { type: Number, required: true },
    price: { type: Number, required: true },
    sku: { type: String, default: '' },
  },
  { _id: false }
);

const OrderSchema = new Schema<OrderDocument>(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    shopifyOrderId: { type: String, required: true },
    orderNumber: { type: String, required: true },
    name: { type: String, required: true },
    customerName: { type: String, default: null },
    customerEmail: { type: String, default: null },
    createdAt: { type: String, required: true },
    processedAt: { type: String, default: null },
    cancelledAt: { type: String, default: null },
    financialStatus: { type: String, required: true },
    fulfillmentStatus: { type: String, required: true },
    totalAmount: { type: Number, default: 0 },
    currencyCode: { type: String, default: 'USD' },
    totalItems: { type: Number, default: 1 },
    fulfillableQuantity: { type: Number, default: 1 },
    lineItems: { type: [LineItemSchema], default: [] },
    deadline: { type: String, default: null },
    isOverdue: { type: Boolean, default: false },
    overdueMinutes: { type: Number, default: 0 },
    shopifyUrl: { type: String, default: null },
    lastSyncedAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  {
    collection: 'orders',
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

OrderSchema.index({ shopId: 1, shopifyOrderId: 1 }, { unique: true });
OrderSchema.index({ shopId: 1, isOverdue: 1 });
OrderSchema.index({ shopId: 1, fulfillmentStatus: 1 });
OrderSchema.index({ shopId: 1, financialStatus: 1 });
OrderSchema.index({ shopId: 1, createdAt: -1 });

export const OrderModel = mongoose.model<OrderDocument>('Order', OrderSchema);

// ============================================================================
// 4. ALERT MODEL
// ============================================================================
export interface AlertDocument extends Omit<Alert, 'id'> {
  _id: string;
}

const AlertSchema = new Schema<AlertDocument>(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    orderNumber: { type: String, required: true },
    severity: { type: String, enum: ['warning', 'critical', 'resolved'], required: true },
    status: { type: String, enum: ['active', 'acknowledged', 'resolved'], required: true },
    reason: { type: String, required: true },
    elapsedHours: { type: Number, default: 0 },
    thresholdHours: { type: Number, default: 24 },
    createdAt: { type: String, required: true },
    acknowledgedAt: { type: String, default: null },
    resolvedAt: { type: String, default: null },
  },
  {
    collection: 'alerts',
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

AlertSchema.index({ shopId: 1, status: 1 });
AlertSchema.index({ shopId: 1, severity: 1 });
AlertSchema.index({ shopId: 1, createdAt: -1 });

export const AlertModel = mongoose.model<AlertDocument>('Alert', AlertSchema);

// ============================================================================
// 5. SETTINGS MODEL
// ============================================================================
export interface SettingsDocument extends Omit<Settings, 'id'> {
  _id: string;
}

const SettingsSchema = new Schema<SettingsDocument>(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, unique: true, index: true },
    overdueThresholdHours: { type: Number, default: 24 },
    warningLeadTimeHours: { type: Number, default: 4 },
    emailEnabled: { type: Boolean, default: true },
    notificationEmail: { type: String, default: 'merchant@example.com' },
    digestFrequency: { type: String, enum: ['immediate', 'daily', 'hourly'], default: 'immediate' },
    autoAcknowledge: { type: Boolean, default: false },
    excludeTags: { type: [String], default: [] },
    updatedAt: { type: String, required: true },
  },
  {
    collection: 'settings',
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

export const SettingsModel = mongoose.model<SettingsDocument>('Settings', SettingsSchema);

// ============================================================================
// 6. NOTIFICATION LOG MODEL
// ============================================================================
export interface NotificationLogDocument extends Omit<NotificationLog, 'id'> {
  _id: string;
}

const NotificationLogSchema = new Schema<NotificationLogDocument>(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    alertId: { type: String, default: null },
    recipient: { type: String, required: true },
    subject: { type: String, required: true },
    deliveryStatus: {
      type: String,
      enum: ['sent', 'failed', 'simulated_no_credentials'],
      required: true,
    },
    errorMessage: { type: String, default: null },
    sentAt: { type: String, required: true },
  },
  {
    collection: 'notification_logs',
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

NotificationLogSchema.index({ shopId: 1, sentAt: -1 });

export const NotificationLogModel = mongoose.model<NotificationLogDocument>(
  'NotificationLog',
  NotificationLogSchema
);
