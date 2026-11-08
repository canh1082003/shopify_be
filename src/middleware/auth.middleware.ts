import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { ApiResponse } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';
import { AppError } from './error.middleware';
import { repository } from '../db/repository';

declare global {
  namespace Express {
    interface Request {
      shop?: JwtPayload;
      rawBody?: Buffer;
    }
  }
}

/**
 * Authentication Middleware: enforces valid Bearer JWT token on protected endpoints.
 * SEC-04: Verifies that the shop exists in repository and is NOT uninstalled or revoked.
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    const response: ApiResponse = {
      success: false,
      statusCode: HttpStatus.UNAUTHORIZED,
      errorCode: ErrorCode.AUTH_TOKEN_MISSING,
      message: 'Authentication required. Missing Authorization header (Format: Bearer <token>).',
      timestamp: new Date().toISOString(),
    };
    res.status(HttpStatus.UNAUTHORIZED).json(response);
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    const response: ApiResponse = {
      success: false,
      statusCode: HttpStatus.UNAUTHORIZED,
      errorCode: ErrorCode.AUTH_INVALID_HEADER,
      message: 'Invalid Authorization header format. Expected "Bearer <token>".',
      timestamp: new Date().toISOString(),
    };
    res.status(HttpStatus.UNAUTHORIZED).json(response);
    return;
  }

  const token = parts[1];

  try {
    const decoded = verifyToken(token, 'access');
    if (!decoded.shopId) {
      const response: ApiResponse = {
        success: false,
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: ErrorCode.AUTH_INVALID_TOKEN,
        message: 'Invalid token: missing required tenant identity claim (shopId).',
        timestamp: new Date().toISOString(),
      };
      res.status(HttpStatus.UNAUTHORIZED).json(response);
      return;
    }

    // SEC-04: Ensure shop exists and is active (not uninstalled or revoked)
    const shop = await repository.getShop(decoded.shopId);
    if (!shop || shop.uninstalledAt) {
      const response: ApiResponse = {
        success: false,
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: ErrorCode.TENANT_MISMATCH,
        message: 'Access denied: Store is uninstalled or nonexistent.',
        timestamp: new Date().toISOString(),
      };
      res.status(HttpStatus.UNAUTHORIZED).json(response);
      return;
    }

    req.shop = decoded;
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid or expired token';
    const isExpired = message.toLowerCase().includes('expired');

    const response: ApiResponse = {
      success: false,
      statusCode: HttpStatus.UNAUTHORIZED,
      errorCode: isExpired ? ErrorCode.AUTH_TOKEN_EXPIRED : ErrorCode.AUTH_INVALID_TOKEN,
      message: `Authentication failed: ${message}`,
      timestamp: new Date().toISOString(),
    };
    res.status(HttpStatus.UNAUTHORIZED).json(response);
  }
};

/**
 * Type-safe helper to extract authenticated tenant shopId from Request.
 * Throws AppError with HTTP 401 if authentication context is missing.
 */
export function getAuthenticatedShopId(req: Request): string {
  if (!req.shop || !req.shop.shopId) {
    throw new AppError(
      'Authentication required: Missing authenticated shop tenant context.',
      HttpStatus.UNAUTHORIZED,
      ErrorCode.AUTH_TOKEN_MISSING
    );
  }
  return req.shop.shopId;
}

/**
 * Validates that an optionally requested tenant ID strictly matches the authenticated session.
 * Throws AppError with HTTP 403 Forbidden if cross-tenant access is attempted.
 */
export function assertTenantMatch(req: Request, targetShopId?: string): void {
  const currentShopId = getAuthenticatedShopId(req);
  if (targetShopId && targetShopId !== currentShopId) {
    throw new AppError(
      'Access forbidden: Cross-tenant data access is strictly prohibited.',
      HttpStatus.FORBIDDEN,
      ErrorCode.TENANT_MISMATCH
    );
  }
}
