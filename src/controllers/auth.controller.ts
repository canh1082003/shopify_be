import { Request, Response, NextFunction } from 'express';
import { generateToken } from '../utils/jwt';
import { repository } from '../db/repository';
import { config } from '../config';
import { ApiResponse } from '../types';

export class AuthController {
  /**
   * Request/Generate a secure authentication token for a merchant or store session
   */
  public async issueToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { shopDomain } = req.body || {};

      let shop = null;
      if (shopDomain) {
        shop = await repository.getShopByDomain(shopDomain);
      }
      if (!shop) {
        shop = await repository.getPrimaryShop();
      }

      const token = generateToken(
        {
          shopId: shop.id,
          shopDomain: shop.shopDomain,
          role: 'merchant_admin',
        },
        config.jwtExpiresInSeconds
      );

      const response: ApiResponse<{
        token: string;
        tokenType: 'Bearer';
        expiresIn: number;
        shop: {
          id: string;
          domain: string;
          name: string;
          isDemo: boolean;
        };
      }> = {
        success: true,
        message: 'Authentication token issued successfully',
        data: {
          token,
          tokenType: 'Bearer',
          expiresIn: config.jwtExpiresInSeconds,
          shop: {
            id: shop.id,
            domain: shop.shopDomain,
            name: shop.name,
            isDemo: shop.isDemo,
          },
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Verify token and return current authenticated shop context
   */
  public async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shopContext = req.shop;
      if (!shopContext) {
        res.status(401).json({ success: false, message: 'Unauthorized', timestamp: new Date().toISOString() });
        return;
      }

      const shop = await repository.getShop(shopContext.shopId);

      const response: ApiResponse = {
        success: true,
        message: 'Token verified successfully',
        data: {
          authenticatedAs: shopContext,
          shop,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
