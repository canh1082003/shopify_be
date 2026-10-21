import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { ApiResponse } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

declare global {
  namespace Express {
    interface Request {
      shop?: JwtPayload;
    }
  }
}

/**
 * Authentication Middleware: enforces valid Bearer JWT token on protected endpoints
 */
export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
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
