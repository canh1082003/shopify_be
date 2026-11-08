import { Request, Response, NextFunction } from 'express';
import { shopifyService } from '../services/shopify.service';
import { repository } from '../db/repository';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse, ShopifyIntegrationStatus } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';
import { config } from '../config';
import { getAuthenticatedShopId } from '../middleware/auth.middleware';
import {
  validateAndNormalizeShopDomain,
  verifyShopifyOAuthHmac,
  getOAuthCookieName,
  parseCookies,
  buildOAuthCookieHeader,
  buildClearOAuthCookieHeader,
  verifyOAuthStateFormat,
  buildSecureEmbeddedAppRedirect,
  sha256,
} from '../utils/shopifyOAuth';

export class IntegrationController {
  public async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shopId = getAuthenticatedShopId(req);
      const status = await shopifyService.getStatus(shopId);

      const response: ApiResponse<ShopifyIntegrationStatus> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Shopify integration status retrieved',
        data: status,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async getAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawShop = req.query.shop;
      const normalizedShop = validateAndNormalizeShopDomain(rawShop);

      const { authUrl, state, nonce, browserNonce } = await shopifyService.generateAuthUrl(normalizedShop);

      // Set host-only, Path=/, HttpOnly, Secure, SameSite=Lax cookie for browser binding (Finding 1)
      res.setHeader('Set-Cookie', buildOAuthCookieHeader(nonce, browserNonce));

      // If requested directly from browser, redirect immediately to Shopify authorize screen
      if (req.query.redirect === 'true' || req.headers.accept?.includes('text/html')) {
        res.redirect(authUrl);
        return;
      }

      const response: ApiResponse<{ authUrl: string; state: string }> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Shopify OAuth URL generated',
        data: { authUrl, state },
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async handleOAuthCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as Record<string, any>;
      const { shop, code, state, hmac, host } = query;

      // 1. Mandatory HMAC query parameter verification
      if (!hmac || typeof hmac !== 'string' || !hmac.trim()) {
        throw new AppError(
          'Missing or invalid HMAC signature in OAuth callback',
          HttpStatus.UNAUTHORIZED,
          ErrorCode.AUTH_INVALID_TOKEN
        );
      }

      // 2. Cryptographic HMAC verification using SHOPIFY_API_SECRET
      const isValidHmac = verifyShopifyOAuthHmac(query, config.shopify.apiSecret);
      if (!isValidHmac) {
        throw new AppError(
          'Shopify OAuth HMAC signature verification failed',
          HttpStatus.UNAUTHORIZED,
          ErrorCode.AUTH_INVALID_TOKEN
        );
      }

      // 3. Strict Shop Domain validation
      const normalizedShop = validateAndNormalizeShopDomain(shop);

      // 4. Authorization code presence check
      if (!code || typeof code !== 'string' || !code.trim()) {
        throw new AppError(
          'Missing authorization code in OAuth callback',
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR
        );
      }

      // 5. CSRF State presence check & HMAC format/signature check
      if (!state || typeof state !== 'string' || !state.trim()) {
        throw new AppError(
          'Missing OAuth state parameter',
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR
        );
      }

      const stateVerification = verifyOAuthStateFormat(state, normalizedShop, config.shopify.apiSecret);
      if (!stateVerification) {
        throw new AppError(
          'Invalid, expired, or tampered OAuth state parameter',
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR
        );
      }

      const { nonce } = stateVerification;

      // 6. Browser-bound cookie verification (Strict RFC 6265bis __Host- cookie)
      const cookies = parseCookies(req.headers.cookie);
      const cookieName = getOAuthCookieName(nonce);
      const browserNonce = cookies[cookieName];

      // Always clear transaction cookie upon terminal callback evaluation
      res.setHeader('Set-Cookie', buildClearOAuthCookieHeader(nonce));

      if (!browserNonce || typeof browserNonce !== 'string' || !browserNonce.trim()) {
        throw new AppError(
          'OAuth transaction was not initiated by this browser session or cookie expired',
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR
        );
      }

      // 7. Atomic Replay Protection & Transaction Consumption (Finding 2)
      const stateHash = sha256(state);
      const browserNonceHash = sha256(browserNonce.trim());

      const consumed = await repository.consumeOAuthTransaction(
        nonce,
        normalizedShop,
        stateHash,
        browserNonceHash
      );

      if (!consumed) {
        throw new AppError(
          'OAuth transaction is invalid, expired, cross-browser, or already consumed',
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR
        );
      }

      // 8. Secure Token Exchange & Real Shop Identity Retrieval (Findings 3 & 5)
      const result = await shopifyService.handleOAuthCallback(normalizedShop, code, state);

      // 9. Secure Configuration-Driven Dynamic Embedded App Redirect (Finding 6)
      const redirectUrl = buildSecureEmbeddedAppRedirect(
        result.shop.shopDomain,
        host,
        config.shopify.appHandle,
        config.clientOrigin
      );

      res.redirect(redirectUrl);
    } catch (err) {
      next(err);
    }
  }

  public async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const topic = req.headers['x-shopify-topic'] as string;
      const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;
      const shopDomain = req.headers['x-shopify-shop-domain'] as string;

      if (!topic) {
        throw new AppError('Missing X-Shopify-Topic header', HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR);
      }

      // Exact raw request body bytes captured before JSON parsing
      const rawBody = req.rawBody;
      if (!rawBody || !Buffer.isBuffer(rawBody)) {
        throw new AppError(
          'Raw request body buffer is required for Shopify webhook HMAC verification',
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR
        );
      }

      const result = await shopifyService.handleWebhook(topic, rawBody, hmacHeader, shopDomain);

      res.status(HttpStatus.OK).json({
        success: true,
        statusCode: HttpStatus.OK,
        message: result.message,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public async triggerSync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shopId = getAuthenticatedShopId(req);
      const result = await shopifyService.syncAll(shopId);

      const response: ApiResponse<typeof result> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: result.message,
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const integrationController = new IntegrationController();
