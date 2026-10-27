import { Request, Response, NextFunction } from 'express';
import { shopifyService } from '../services/shopify.service';
import { repository } from '../db/repository';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse, ShopifyIntegrationStatus } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export class IntegrationController {
  public async getStatus(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await shopifyService.getStatus();

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
      const shopDomain = req.query.shop as string;
      if (!shopDomain) {
        throw new AppError(
          'Query parameter "shop" is required (e.g. ?shop=yourstore.myshopify.com)',
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR
        );
      }

      const { authUrl, state } = shopifyService.generateAuthUrl(shopDomain);

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
      const { shop, code, state } = req.query as { shop?: string; code?: string; state?: string };

      if (!shop || !code) {
        throw new AppError(
          'Missing required OAuth callback parameters "shop" or "code"',
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR
        );
      }

      const result = await shopifyService.handleOAuthCallback(shop, code, state || '');

      // In production embedded app, redirect to embedded app host
      res.redirect(`http://localhost:5173/?shop=${encodeURIComponent(result.shop.shopDomain)}&installed=true`);
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

      const rawBody = JSON.stringify(req.body);
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
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;

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
