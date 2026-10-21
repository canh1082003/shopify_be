import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { ApiResponse } from '../types';

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
      message: 'Authentication required. Missing Authorization header (Format: Bearer <token>).',
      timestamp: new Date().toISOString(),
    };
    res.status(401).json(response);
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    const response: ApiResponse = {
      success: false,
      message: 'Invalid Authorization header format. Expected "Bearer <token>".',
      timestamp: new Date().toISOString(),
    };
    res.status(401).json(response);
    return;
  }

  const token = parts[1];

  try {
    const decoded = verifyToken(token);
    req.shop = decoded;
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid or expired token';
    const response: ApiResponse = {
      success: false,
      message: `Authentication failed: ${message}`,
      timestamp: new Date().toISOString(),
    };
    res.status(401).json(response);
  }
};
