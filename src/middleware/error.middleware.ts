import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';
import { config } from '../config';

export class AppError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const notFoundHandler = (req: Request, res: Response): void => {
  const response: ApiResponse = {
    success: false,
    message: `Resource not found: [${req.method}] ${req.originalUrl}`,
    timestamp: new Date().toISOString(),
  };
  res.status(404).json(response);
};

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[Error] ${statusCode} - ${message}`);
  if (!config.isProduction && err.stack) {
    console.error(err.stack);
  }

  const response: ApiResponse = {
    success: false,
    message,
    error: config.isProduction ? undefined : err.stack,
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(response);
};
