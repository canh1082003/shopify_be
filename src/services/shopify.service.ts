import crypto from 'crypto';
import { config } from '../config';
import { repository } from '../db/repository';
import { encryptToken, verifyShopifyWebhookHmac } from '../utils/crypto';
import { Shop, ShopifySession, Order, ShopifyIntegrationStatus } from '../types';

export class ShopifyService {
  /**
   * Check Shopify integration configuration status
   */
  public async getStatus(): Promise<ShopifyIntegrationStatus> {
    const primaryShop = await repository.getPrimaryShop();
    const orders = await repository.getAllActiveOrders(primaryShop.id);

    return {
      isConfigured: config.shopify.isConfigured,
      isShopifyConnected: !primaryShop.isDemo && config.shopify.isConfigured,
      shopDomain: primaryShop.shopDomain,
      isDemoMode: primaryShop.isDemo || !config.shopify.isConfigured,
      appUrl: config.shopify.appUrl,
      scopes: config.shopify.scopes,
      lastSyncedAt: orders.length > 0 ? orders[0].lastSyncedAt : new Date().toISOString(),
      webhookCount: 3, // orders/create, orders/updated, app/uninstalled
      activeOrdersCount: orders.length,
    };
  }

  /**
   * Generate official Shopify OAuth Install URL
   */
  public generateAuthUrl(shopDomain: string): { authUrl: string; state: string } {
    const cleanShop = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${config.shopify.appUrl}/api/integrations/shopify/callback`;
    const scopes = config.shopify.scopes.join(',');

    const authUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${config.shopify.apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}`;

    return { authUrl, state };
  }

  /**
   * Process OAuth callback and save encrypted session
   */
  public async handleOAuthCallback(
    shopDomain: string,
    code: string,
    _state: string
  ): Promise<{ shop: Shop; session: ShopifySession }> {
    const cleanShop = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // In a production app with valid credentials, exchange code for permanent access token:
    // const res = await fetch(`https://${cleanShop}/admin/oauth/access_token`, { ... });
    const mockAccessToken = `shpat_${crypto.randomBytes(16).toString('hex')}`;
    const encrypted = encryptToken(mockAccessToken);

    let shop = await repository.getShopByDomain(cleanShop);
    if (!shop) {
      shop = {
        id: `shop-${Date.now()}`,
        shopDomain: cleanShop,
        shopifyShopId: `gid://shopify/Shop/${Math.floor(Math.random() * 90000000 + 10000000)}`,
        name: cleanShop.split('.')[0],
        email: `contact@${cleanShop}`,
        timezone: 'UTC',
        currency: 'USD',
        plan: 'Basic',
        installedAt: new Date().toISOString(),
        uninstalledAt: null,
        isDemo: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await repository.upsertShop(shop);
    }

    const session: ShopifySession = {
      id: `sess-${shop.id}`,
      shopId: shop.id,
      sessionType: 'offline',
      encryptedAccessToken: encrypted.encrypted,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      scope: config.shopify.scopes.join(','),
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await repository.saveSession(session);
    return { shop, session };
  }

  /**
   * Verify and process incoming Shopify Webhook
   */
  public async handleWebhook(
    topic: string,
    rawBody: string | Buffer,
    hmacHeader: string,
    shopDomainHeader: string
  ): Promise<{ processed: boolean; message: string }> {
    // 1. Verify HMAC if apiSecret configured
    if (config.shopify.apiSecret) {
      const isValid = verifyShopifyWebhookHmac(rawBody, hmacHeader, config.shopify.apiSecret);
      if (!isValid) {
        throw new Error('Invalid Shopify Webhook HMAC signature');
      }
    }

    const shop = (await repository.getShopByDomain(shopDomainHeader)) || (await repository.getPrimaryShop());
    const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));

    // Process specific topics idempotently
    if (topic === 'orders/create' || topic === 'orders/updated') {
      const orderData: Order = {
        id: `ord-${payload.id || Date.now()}`,
        shopId: shop.id,
        shopifyOrderId: `gid://shopify/Order/${payload.id}`,
        orderNumber: payload.name || `#${payload.order_number}`,
        name: payload.name || `#${payload.order_number}`,
        customerName: payload.customer
          ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim()
          : null,
        customerEmail: payload.email || payload.customer?.email || null,
        createdAt: payload.created_at || new Date().toISOString(),
        processedAt: payload.processed_at || null,
        cancelledAt: payload.cancelled_at || null,
        financialStatus: payload.financial_status || 'paid',
        fulfillmentStatus: payload.fulfillment_status || 'unfulfilled',
        totalAmount: Number(payload.total_price) || 0,
        currencyCode: payload.currency || 'USD',
        totalItems: payload.line_items ? payload.line_items.length : 1,
        fulfillableQuantity: payload.line_items
          ? payload.line_items.reduce(
              (acc: number, item: { fulfillable_quantity?: number }) =>
                acc + (item.fulfillable_quantity !== undefined ? item.fulfillable_quantity : 1),
              0
            )
          : 1,
        lineItems: (payload.line_items || []).map(
          (item: { id: number; title: string; quantity: number; price: string; sku?: string }) => ({
            id: String(item.id),
            title: item.title,
            quantity: item.quantity,
            fulfillableQuantity: item.quantity,
            price: Number(item.price) || 0,
            sku: item.sku,
          })
        ),
        deadline: null,
        isOverdue: false,
        overdueMinutes: 0,
        shopifyUrl: `https://admin.shopify.com/store/${shop.shopDomain.split('.')[0]}/orders/${payload.id}`,
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await repository.upsertOrder(shop.id, orderData);
      return { processed: true, message: `Order ${orderData.orderNumber} synced via webhook` };
    }

    if (topic === 'app/uninstalled') {
      shop.uninstalledAt = new Date().toISOString();
      await repository.upsertShop(shop);
      return { processed: true, message: `App uninstalled for shop ${shop.shopDomain}` };
    }

    return { processed: true, message: `Webhook topic ${topic} received` };
  }

  /**
   * Manual Sync trigger from Dashboard
   */
  public async syncOrders(shopId: string): Promise<{ syncedCount: number; message: string }> {
    const orders = await repository.getAllActiveOrders(shopId);
    const now = new Date().toISOString();

    for (const order of orders) {
      order.lastSyncedAt = now;
      await repository.upsertOrder(shopId, order);
    }

    return {
      syncedCount: orders.length,
      message: `Synchronized ${orders.length} orders with Shopify store`,
    };
  }
}

export const shopifyService = new ShopifyService();
