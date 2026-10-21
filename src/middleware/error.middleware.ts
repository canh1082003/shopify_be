import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';
import { config } from '../config';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export class AppError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR, errorCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const notFoundHandler = (req: Request, res: Response): void => {
  const response: ApiResponse = {
    success: false,
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: ErrorCode.RESOURCE_NOT_FOUND,
    message: `Resource not found: [${req.method}] ${req.originalUrl}`,
    timestamp: new Date().toISOString(),
  };
  res.status(HttpStatus.NOT_FOUND).json(response);
};

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const statusCode = err instanceof AppError ? err.statusCode : HttpStatus.INTERNAL_SERVER_ERROR;
  const errorCode = err instanceof AppError ? err.errorCode : ErrorCode.INTERNAL_SERVER_ERROR;
  const message = err.message || 'Internal Server Error';

  console.error(`[Error] ${statusCode} [${errorCode || 'UNKNOWN'}]: ${message}`);
  if (!config.isProduction && err.stack) {
    console.error(err.stack);
  }

  const response: ApiResponse = {
    success: false,
    statusCode,
    errorCode,
    message,
    error: config.isProduction ? undefined : err.stack,
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(response);
};
