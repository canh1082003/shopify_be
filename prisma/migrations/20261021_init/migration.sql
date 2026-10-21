-- CreateTable Shop
CREATE TABLE IF NOT EXISTS "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "plan" TEXT NOT NULL DEFAULT 'basic',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable ShopifySession
CREATE TABLE IF NOT EXISTS "ShopifySession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL DEFAULT 'offline',
    "encryptedAccessToken" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable Order
CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "financialStatus" TEXT NOT NULL,
    "fulfillmentStatus" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "totalItems" INTEGER NOT NULL DEFAULT 1,
    "fulfillableQuantity" INTEGER NOT NULL DEFAULT 1,
    "lineItemsJson" TEXT NOT NULL DEFAULT '[]',
    "deadline" TIMESTAMP(3),
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    "overdueMinutes" INTEGER NOT NULL DEFAULT 0,
    "shopifyUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable Alert
CREATE TABLE IF NOT EXISTS "Alert" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "elapsedHours" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "thresholdHours" DOUBLE PRECISION NOT NULL DEFAULT 24.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable Settings
CREATE TABLE IF NOT EXISTS "Settings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "overdueThresholdHours" DOUBLE PRECISION NOT NULL DEFAULT 24.0,
    "warningLeadTimeHours" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notificationEmail" TEXT NOT NULL DEFAULT 'merchant@example.com',
    "digestFrequency" TEXT NOT NULL DEFAULT 'immediate',
    "autoAcknowledge" BOOLEAN NOT NULL DEFAULT false,
    "excludeTags" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable NotificationLog
CREATE TABLE IF NOT EXISTS "NotificationLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "alertId" TEXT,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_key" ON "Shop"("shopDomain");
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopifyShopId_key" ON "Shop"("shopifyShopId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_shopId_shopifyOrderId_key" ON "Order"("shopId", "shopifyOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "Settings_shopId_key" ON "Settings"("shopId");

-- AddForeignKeys
ALTER TABLE "ShopifySession" ADD CONSTRAINT "ShopifySession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
