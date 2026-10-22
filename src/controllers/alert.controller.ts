import { Request, Response, NextFunction } from 'express';
import { repository } from '../db/repository';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse, StockAlert, PaginatedResult } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export class AlertController {
  public async getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;

      const alertType = req.query.alertType as any;
      const status = req.query.status as any;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const result = await repository.getStockAlerts(shopId, {
        alertType,
        status,
        page,
        limit,
      });

      const response: ApiResponse<PaginatedResult<StockAlert>> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Stock alerts retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;

      const summary = await repository.getStockAlertsSummary(shopId);

      const response: ApiResponse<typeof summary> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Stock alerts summary retrieved successfully',
        data: summary,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async acknowledge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;
      const { id } = req.params;

      const updated = await repository.acknowledgeStockAlert(shopId, id);
      if (!updated) {
        // Fallback for legacy alert tests
        const legacyAlert = await repository.acknowledgeAlert(shopId, id);
        if (!legacyAlert) {
          throw new AppError(`Alert with ID "${id}" not found`, HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND);
        }
        res.status(HttpStatus.OK).json({
          success: true,
          statusCode: HttpStatus.OK,
          message: 'Alert acknowledged',
          data: legacyAlert,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const response: ApiResponse<StockAlert> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: `Alert for ${updated.sku || updated.productTitle} has been acknowledged. Shopify inventory remains unchanged.`,
        data: updated,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async dismiss(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;
      const { id } = req.params;

      const updated = await repository.dismissStockAlert(shopId, id);
      if (!updated) {
        throw new AppError(`Alert with ID "${id}" not found`, HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND);
      }

      const response: ApiResponse<StockAlert> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: `Alert for ${updated.sku || updated.productTitle} has been dismissed.`,
        data: updated,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const alertController = new AlertController();
