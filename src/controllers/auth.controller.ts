import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { generateTokenPair, verifyRefreshToken, verifyToken } from '../utils/jwt';
import { verifyShopifySessionToken } from '../utils/shopifyToken';
import { repository } from '../db/repository';
import { ApiResponse } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';
import { getAuthenticatedShopId } from '../middleware/auth.middleware';

// Short-lived StockPilot access token lifetime: 15 minutes (900 seconds)
const SHORT_LIVED_ACCESS_TOKEN_SECONDS = 900;
// Refresh token lifetime: 7 days
const REFRESH_TOKEN_SECONDS = 7 * 24 * 3600;
// Maximum absolute session lifetime from initial App Bridge login: 7 days
const ABSOLUTE_SESSION_LIFETIME_SECONDS = 7 * 24 * 3600;
// Concurrent refresh request grace window: 10 seconds
const CONCURRENT_REFRESH_GRACE_MS = 10000;

export class AuthController {
  /**
   * Securely exchanges a verified Shopify App Bridge Session Token for a StockPilot JWT token pair.
   * Derives tenant identity strictly from the verified Shopify Session Token (dest claim).
   * Generates a new Token Family for multi-session and multi-device rotation support.
   */
  public async issueToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // 1. Extract the raw Shopify App Bridge Session Token
      let rawSessionToken: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        rawSessionToken = authHeader.substring(7).trim();
      } else if (req.body && typeof req.body.sessionToken === 'string') {
        rawSessionToken = req.body.sessionToken.trim();
      }

      if (!rawSessionToken) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ErrorCode.AUTH_TOKEN_MISSING,
          message: 'Missing Shopify App Bridge session token in Authorization header or body.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 2. Cryptographically verify the Shopify Session Token claims
      let sessionClaims;
      try {
        sessionClaims = verifyShopifySessionToken(rawSessionToken);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid session token';
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ErrorCode.AUTH_INVALID_TOKEN,
          message: `Shopify session token verification failed: ${errorMsg}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const verifiedDomain = sessionClaims.shopDomain;

      // 3. Confirm that the verified shop is installed and active in database
      const shop = await repository.getShopByDomain(verifiedDomain);
      if (!shop || shop.uninstalledAt) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: 'AUTH_SHOP_NOT_INSTALLED',
          message: `Shop '${verifiedDomain}' is not installed or has uninstalled the application. Please complete Shopify OAuth installation.`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 4. SEC-01: Verify that an active offline session exists belonging to THIS shop (no global fallback)
      const session = await repository.getSession(shop.id);
      if (!session) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: 'AUTH_SESSION_INVALID',
          message: `No active Shopify credentials found for '${verifiedDomain}'. Re-authorization via OAuth is required.`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 5. SEC-05: Create a new Token Family for multi-session Refresh Token Rotation
      const familyId = `fam-${crypto.randomUUID()}`;
      const jti = `jti-${crypto.randomUUID()}`;
      const nowSec = Math.floor(Date.now() / 1000);
      const absoluteExpiresAt = nowSec + ABSOLUTE_SESSION_LIFETIME_SECONDS;

      await repository.saveTokenFamily({
        familyId,
        shopId: shop.id,
        currentJti: jti,
        revoked: false,
        createdAt: new Date().toISOString(),
        absoluteExpiresAt,
      });

      const tokenPair = generateTokenPair(
        {
          shopId: shop.id,
          shopDomain: shop.shopDomain,
          role: 'merchant_admin',
        },
        SHORT_LIVED_ACCESS_TOKEN_SECONDS,
        REFRESH_TOKEN_SECONDS,
        familyId,
        jti,
        absoluteExpiresAt
      );

      const response: ApiResponse<{
        token: string;
        refreshToken: string;
        tokenType: 'Bearer';
        expiresIn: number;
        refreshExpiresIn: number;
        familyId: string;
        shop: {
          id: string;
          domain: string;
          name: string;
          isDemo: boolean;
        };
      }> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'StockPilot authentication token issued successfully',
        data: {
          token: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          tokenType: 'Bearer',
          expiresIn: tokenPair.expiresIn,
          refreshExpiresIn: tokenPair.refreshExpiresIn,
          familyId,
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
   * Refresh an expired access token using a valid Refresh Token.
   * Implements Token Family Rotation, Replay Detection, and Multi-Session isolation.
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

      // SEC-04: Block uninstalled or nonexistent shops
      const shop = await repository.getShop(payload.shopId);
      if (!shop || shop.uninstalledAt) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ErrorCode.TENANT_MISMATCH,
          message: 'Shop associated with refresh token no longer exists or was uninstalled',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // SEC-01: Verify active offline session belongs to THIS shop
      const session = await repository.getSession(shop.id);
      if (!session) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: 'AUTH_SESSION_REVOKED',
          message: 'Shopify offline session was revoked. Fresh OAuth authorization is required.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // SEC-05: Multi-Session Token Family verification & Replay Detection
      if (!payload.familyId || !payload.jti) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ErrorCode.AUTH_REFRESH_INVALID,
          message: 'Legacy or invalid refresh token missing token family tracking.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      let family = await repository.getTokenFamily(payload.familyId, shop.id);
      if (!family) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: 'AUTH_REFRESH_REVOKED',
          message: 'Session token family not found or expired. Please re-authenticate.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (family.revoked) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: 'AUTH_REFRESH_REVOKED',
          message: `This session has been revoked (${family.revokedReason || 'security policy'}). Please re-authenticate.`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Enforce Absolute Session Timeout (e.g. 7 days max lifetime)
      const nowSec = Math.floor(Date.now() / 1000);
      if (family.absoluteExpiresAt && nowSec > family.absoluteExpiresAt) {
        await repository.revokeTokenFamily(family.familyId, 'Absolute session lifetime reached', shop.id);
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: 'AUTH_SESSION_EXPIRED',
          message: 'Maximum session lifetime reached. Please re-authenticate via Shopify App Bridge.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Check JTI for Atomic Rotation vs. Replay
      if (payload.jti === family.currentJti) {
        // Valid rotation request! Atomically advance to new JTI
        const newJti = `jti-${crypto.randomUUID()}`;
        const rotatedFamily = await repository.rotateTokenFamily(
          family.familyId,
          shop.id,
          payload.jti,
          newJti
        );

        if (rotatedFamily) {
          const newTokenPair = generateTokenPair(
            {
              shopId: shop.id,
              shopDomain: shop.shopDomain,
              role: payload.role || 'merchant_admin',
            },
            SHORT_LIVED_ACCESS_TOKEN_SECONDS,
            REFRESH_TOKEN_SECONDS,
            rotatedFamily.familyId,
            newJti,
            rotatedFamily.absoluteExpiresAt
          );

          res.status(HttpStatus.OK).json({
            success: true,
            statusCode: HttpStatus.OK,
            message: 'Access token successfully rotated and refreshed',
            data: {
              token: newTokenPair.accessToken,
              refreshToken: newTokenPair.refreshToken,
              tokenType: 'Bearer',
              expiresIn: newTokenPair.expiresIn,
              familyId: rotatedFamily.familyId,
            },
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // CAS returned null: another concurrent request rotated it simultaneously.
        // Reload current family state to evaluate grace window.
        const reloadedFamily = await repository.getTokenFamily(family.familyId, shop.id);
        if (reloadedFamily) {
          family = reloadedFamily;
        }
      }

      if (payload.jti === family.previousJti) {
        // Safe concurrent refresh handling (within grace window of 10 seconds)
        const rotatedTime = family.rotatedAt ? new Date(family.rotatedAt).getTime() : 0;
        if (Date.now() - rotatedTime < CONCURRENT_REFRESH_GRACE_MS) {
          const newTokenPair = generateTokenPair(
            {
              shopId: shop.id,
              shopDomain: shop.shopDomain,
              role: payload.role || 'merchant_admin',
            },
            SHORT_LIVED_ACCESS_TOKEN_SECONDS,
            REFRESH_TOKEN_SECONDS,
            family.familyId,
            family.currentJti,
            family.absoluteExpiresAt
          );

          res.status(HttpStatus.OK).json({
            success: true,
            statusCode: HttpStatus.OK,
            message: 'Access token renewed within concurrent refresh grace window',
            data: {
              token: newTokenPair.accessToken,
              refreshToken: newTokenPair.refreshToken,
              tokenType: 'Bearer',
              expiresIn: newTokenPair.expiresIn,
              familyId: family.familyId,
            },
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }

      // If neither current nor within previous grace window -> REPLAY DETECTED!
      // Revoke ONLY the compromised token family, keeping other devices safe
      await repository.revokeTokenFamily(family.familyId, 'Refresh token reuse detected (Replay Attack)', shop.id);
      res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: 'AUTH_REPLAY_DETECTED',
        message: 'Security Alert: Refresh token reuse detected. This specific session has been revoked.',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Explicitly verify if a Bearer token is currently valid.
   * SEC-06: Strictly rejects uninstalled or nonexistent shops.
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
          data: { valid: false, error: 'Missing Authorization header' },
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
          data: { valid: false, error: 'Malformed Authorization header' },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const token = parts[1];
      try {
        const decoded = verifyToken(token, 'access');

        // SEC-06: Verify that the shop exists and is NOT uninstalled
        const shop = await repository.getShop(decoded.shopId);
        if (!shop || shop.uninstalledAt) {
          res.status(HttpStatus.UNAUTHORIZED).json({
            success: false,
            statusCode: HttpStatus.UNAUTHORIZED,
            errorCode: ErrorCode.TENANT_MISMATCH,
            message: 'Store is uninstalled or nonexistent',
            data: { valid: false, error: 'Store is uninstalled or nonexistent' },
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        const remainingSeconds = decoded.exp ? Math.max(0, decoded.exp - now) : SHORT_LIVED_ACCESS_TOKEN_SECONDS;

        res.status(HttpStatus.OK).json({
          success: true,
          statusCode: HttpStatus.OK,
          message: 'Token is valid and active',
          data: {
            valid: true,
            shop: {
              id: decoded.shopId,
              domain: decoded.shopDomain,
              name: shop.name || decoded.shopDomain,
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
      const shopId = getAuthenticatedShopId(req);
      const shop = await repository.getShop(shopId);

      const response: ApiResponse = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Authenticated shop profile retrieved successfully',
        data: {
          authenticatedAs: req.shop,
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
