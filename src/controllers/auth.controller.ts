import { Request, Response, NextFunction } from 'express';
import { generateTokenPair, verifyRefreshToken, verifyToken } from '../utils/jwt';
import { repository } from '../db/repository';
import { config } from '../config';
import { ApiResponse } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export class AuthController {
  /**
   * Request/Generate a secure authentication token pair (Access + Refresh token)
   */
  public async issueToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { shopDomain } = req.body || {};

      let shop = null;
      if (shopDomain) {
        shop = await repository.getShopByDomain(shopDomain);
        if (!shop) {
          const cleanShop = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
          shop = {
            id: `shop-${cleanShop.replace(/[^a-zA-Z0-9]/g, '_')}`,
            shopDomain: cleanShop,
            shopifyShopId: `gid://shopify/Shop/${Math.floor(Math.random() * 90000000 + 10000000)}`,
            name: cleanShop.split('.')[0],
            email: `contact@${cleanShop}`,
            timezone: 'Asia/Ho_Chi_Minh',
            currency: 'USD',
            plan: 'Standard',
            installedAt: new Date().toISOString(),
            uninstalledAt: null,
            isDemo: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await repository.upsertShop(shop);
        }
      }
      if (!shop) {
        shop = await repository.getPrimaryShop();
      }

      const tokenPair = generateTokenPair(
        {
          shopId: shop.id,
          shopDomain: shop.shopDomain,
          role: 'merchant_admin',
        },
        config.jwtExpiresInSeconds,
        7 * 24 * 3600 // 7 days refresh
      );

      const response: ApiResponse<{
        token: string;
        refreshToken: string;
        tokenType: 'Bearer';
        expiresIn: number;
        refreshExpiresIn: number;
        shop: {
          id: string;
          domain: string;
          name: string;
          isDemo: boolean;
        };
      }> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Authentication token issued successfully',
        data: {
          token: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          tokenType: 'Bearer',
          expiresIn: tokenPair.expiresIn,
          refreshExpiresIn: tokenPair.refreshExpiresIn,
          shop: {
            id: shop.id,
            domain: shop.shopDomain,
            name: shop.name,
            isDemo: shop.isDemo,
          },
        },
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Refresh an expired access token using a valid Refresh Token
   */
  public async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body || {};

      if (!refreshToken || typeof refreshToken !== 'string') {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: ErrorCode.VALIDATION_ERROR,
          message: 'Missing or invalid refreshToken in request body',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      let payload;
      try {
        payload = verifyRefreshToken(refreshToken);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid refresh token';
        const isExpired = errorMsg.toLowerCase().includes('expired');
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: isExpired ? ErrorCode.AUTH_REFRESH_EXPIRED : ErrorCode.AUTH_REFRESH_INVALID,
          message: `Refresh token verification failed: ${errorMsg}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const shop = await repository.getShop(payload.shopId);
      if (!shop) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ErrorCode.TENANT_MISMATCH,
          message: 'Shop associated with refresh token no longer exists',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Re-issue a fresh token pair
      const newTokenPair = generateTokenPair(
        {
          shopId: shop.id,
          shopDomain: shop.shopDomain,
          role: payload.role || 'merchant_admin',
        },
        config.jwtExpiresInSeconds,
        7 * 24 * 3600
      );

      const response: ApiResponse<{
        token: string;
        refreshToken: string;
        tokenType: 'Bearer';
        expiresIn: number;
      }> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Access token successfully refreshed',
        data: {
          token: newTokenPair.accessToken,
          refreshToken: newTokenPair.refreshToken,
          tokenType: 'Bearer',
          expiresIn: newTokenPair.expiresIn,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Explicitly verify if a Bearer token is currently valid
   */
  public async verifyTokenStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ErrorCode.AUTH_TOKEN_MISSING,
          message: 'Missing Authorization header',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ErrorCode.AUTH_INVALID_HEADER,
          message: 'Malformed Authorization header. Format: Bearer <token>',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const token = parts[1];
      try {
        const decoded = verifyToken(token, 'access');
        const shop = await repository.getShop(decoded.shopId);

        const now = Math.floor(Date.now() / 1000);
        const remainingSeconds = decoded.exp ? Math.max(0, decoded.exp - now) : config.jwtExpiresInSeconds;

        res.status(HttpStatus.OK).json({
          success: true,
          statusCode: HttpStatus.OK,
          message: 'Token is valid and active',
          data: {
            valid: true,
            shop: {
              id: decoded.shopId,
              domain: decoded.shopDomain,
              name: shop?.name || decoded.shopDomain,
            },
            expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
            remainingSeconds,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid token';
        const isExpired = errorMsg.toLowerCase().includes('expired');

        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: isExpired ? ErrorCode.AUTH_TOKEN_EXPIRED : ErrorCode.AUTH_INVALID_TOKEN,
          message: `Token validation failed: ${errorMsg}`,
          data: { valid: false, error: errorMsg },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      next(err);
    }
  }

  /**
   * Return current authenticated shop context
   */
  public async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shopContext = req.shop;
      if (!shopContext) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ErrorCode.AUTH_TOKEN_MISSING,
          message: 'Unauthorized: missing authentication context',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const shop = await repository.getShop(shopContext.shopId);

      const response: ApiResponse = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Authenticated shop profile retrieved successfully',
        data: {
          authenticatedAs: shopContext,
          shop,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
