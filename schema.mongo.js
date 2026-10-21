/**
 * Order Watchdog - MongoDB Schema & Initialization Script
 * 
 * Multi-tenant architecture for Shopify SaaS Order Fulfillment Monitoring
 * Target Database: MongoDB Atlas / Local MongoDB
 * 
 * Rules:
 * - Standalone collections (No relational foreign key constraints)
 * - Primary Key: `_id` on every document
 * - Multi-tenant indexing on `shopId`
 * 
 * Usage:
 * mongosh "<MONGODB_URI>" schema.mongo.js
 * Or run inside MongoDB Compass Aggregations/Script tab
 */

// Switch / create database
const dbName = 'shopify_order_watchdog';
const targetDb = db.getSiblingDB(dbName);

print(`[MongoDB Init] Initializing collections and indexes for database: ${dbName}`);

// ============================================================================
// 1. SHOPS COLLECTION
// ============================================================================
targetDb.createCollection('shops', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'shopDomain', 'name', 'installedAt', 'createdAt', 'updatedAt'],
      properties: {
        _id: { bsonType: 'string', description: 'Primary Key (UUID or Shop ID)' },
        shopDomain: { bsonType: 'string', description: 'Unique myshopify domain' },
        shopifyShopId: { bsonType: ['string', 'null'] },
        name: { bsonType: 'string' },
        email: { bsonType: ['string', 'null'] },
        timezone: { bsonType: 'string' },
        currency: { bsonType: 'string' },
        plan: { bsonType: 'string' },
        installedAt: { bsonType: 'string' },
        uninstalledAt: { bsonType: ['string', 'null'] },
        isDemo: { bsonType: 'bool' },
        createdAt: { bsonType: 'string' },
        updatedAt: { bsonType: 'string' }
      }
    }
  }
});

targetDb.shops.createIndex({ shopDomain: 1 }, { unique: true });
targetDb.shops.createIndex({ createdAt: -1 });

// ============================================================================
// 2. SHOPIFY SESSIONS COLLECTION
// ============================================================================
targetDb.createCollection('shopify_sessions', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'shopId', 'encryptedAccessToken', 'iv', 'authTag', 'scope', 'createdAt', 'updatedAt'],
      properties: {
        _id: { bsonType: 'string', description: 'Primary Key (Session ID)' },
        shopId: { bsonType: 'string', description: 'Target Shop ID' },
        sessionType: { enum: ['offline', 'online'] },
        encryptedAccessToken: { bsonType: 'string' },
        iv: { bsonType: 'string' },
        authTag: { bsonType: 'string' },
        scope: { bsonType: 'string' },
        expiresAt: { bsonType: ['string', 'null'] },
        createdAt: { bsonType: 'string' },
        updatedAt: { bsonType: 'string' }
      }
    }
  }
});

targetDb.shopify_sessions.createIndex({ shopId: 1 });

// ============================================================================
// 3. ORDERS COLLECTION
// ============================================================================
targetDb.createCollection('orders', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'shopId', 'shopifyOrderId', 'orderNumber', 'name', 'createdAt', 'financialStatus', 'fulfillmentStatus', 'lastSyncedAt', 'updatedAt'],
      properties: {
        _id: { bsonType: 'string', description: 'Primary Key (Order ID)' },
        shopId: { bsonType: 'string', description: 'Target Shop ID' },
        shopifyOrderId: { bsonType: 'string' },
        orderNumber: { bsonType: 'string' },
        name: { bsonType: 'string' },
        customerName: { bsonType: ['string', 'null'] },
        customerEmail: { bsonType: ['string', 'null'] },
        createdAt: { bsonType: 'string' },
        processedAt: { bsonType: ['string', 'null'] },
        cancelledAt: { bsonType: ['string', 'null'] },
        financialStatus: { bsonType: 'string' },
        fulfillmentStatus: { bsonType: 'string' },
        totalAmount: { bsonType: 'number' },
        currencyCode: { bsonType: 'string' },
        totalItems: { bsonType: 'int' },
        fulfillableQuantity: { bsonType: 'int' },
        lineItems: { bsonType: 'array' },
        deadline: { bsonType: ['string', 'null'] },
        isOverdue: { bsonType: 'bool' },
        overdueMinutes: { bsonType: 'int' },
        shopifyUrl: { bsonType: ['string', 'null'] },
        lastSyncedAt: { bsonType: 'string' },
        updatedAt: { bsonType: 'string' }
      }
    }
  }
});

targetDb.orders.createIndex({ shopId: 1, shopifyOrderId: 1 }, { unique: true });
targetDb.orders.createIndex({ shopId: 1, isOverdue: 1 });
targetDb.orders.createIndex({ shopId: 1, fulfillmentStatus: 1 });
targetDb.orders.createIndex({ shopId: 1, financialStatus: 1 });
targetDb.orders.createIndex({ shopId: 1, createdAt: -1 });

// ============================================================================
// 4. ALERTS COLLECTION
// ============================================================================
targetDb.createCollection('alerts', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'shopId', 'orderId', 'orderNumber', 'severity', 'status', 'reason', 'createdAt'],
      properties: {
        _id: { bsonType: 'string', description: 'Primary Key (Alert ID)' },
        shopId: { bsonType: 'string', description: 'Target Shop ID' },
        orderId: { bsonType: 'string', description: 'Order ID' },
        orderNumber: { bsonType: 'string' },
        severity: { enum: ['warning', 'critical', 'resolved'] },
        status: { enum: ['active', 'acknowledged', 'resolved'] },
        reason: { bsonType: 'string' },
        elapsedHours: { bsonType: 'number' },
        thresholdHours: { bsonType: 'number' },
        createdAt: { bsonType: 'string' },
        acknowledgedAt: { bsonType: ['string', 'null'] },
        resolvedAt: { bsonType: ['string', 'null'] }
      }
    }
  }
});

targetDb.alerts.createIndex({ shopId: 1, status: 1 });
targetDb.alerts.createIndex({ shopId: 1, severity: 1 });
targetDb.alerts.createIndex({ shopId: 1, createdAt: -1 });

// ============================================================================
// 5. SETTINGS COLLECTION
// ============================================================================
targetDb.createCollection('settings', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'shopId', 'overdueThresholdHours', 'warningLeadTimeHours', 'emailEnabled', 'notificationEmail', 'updatedAt'],
      properties: {
        _id: { bsonType: 'string', description: 'Primary Key (Settings ID)' },
        shopId: { bsonType: 'string', description: 'Target Shop ID (1-to-1 unique)' },
        overdueThresholdHours: { bsonType: 'number' },
        warningLeadTimeHours: { bsonType: 'number' },
        emailEnabled: { bsonType: 'bool' },
        notificationEmail: { bsonType: 'string' },
        digestFrequency: { enum: ['immediate', 'daily', 'hourly'] },
        autoAcknowledge: { bsonType: 'bool' },
        excludeTags: { bsonType: 'array' },
        updatedAt: { bsonType: 'string' }
      }
    }
  }
});

targetDb.settings.createIndex({ shopId: 1 }, { unique: true });

// ============================================================================
// 6. NOTIFICATION LOGS COLLECTION
// ============================================================================
targetDb.createCollection('notification_logs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'shopId', 'recipient', 'subject', 'deliveryStatus', 'sentAt'],
      properties: {
        _id: { bsonType: 'string', description: 'Primary Key (Log ID)' },
        shopId: { bsonType: 'string', description: 'Target Shop ID' },
        alertId: { bsonType: ['string', 'null'] },
        recipient: { bsonType: 'string' },
        subject: { bsonType: 'string' },
        deliveryStatus: { enum: ['sent', 'failed', 'simulated_no_credentials'] },
        errorMessage: { bsonType: ['string', 'null'] },
        sentAt: { bsonType: 'string' }
      }
    }
  }
});

targetDb.notification_logs.createIndex({ shopId: 1, sentAt: -1 });

print('[MongoDB Init] All 6 collections and indexes created successfully!');
