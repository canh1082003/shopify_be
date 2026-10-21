import { Request, Response, NextFunction } from 'express';
import { repository } from '../db/repository';
import { monitorService } from '../services/monitor.service';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse, Alert, PaginatedResult } from '../types';

export class AlertController {
  public async getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;

      await monitorService.evaluateShopOrders(shopId);

      const severity = req.query.severity as string | undefined;
      const status = req.query.status as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const result = await repository.getAlerts(shopId, {
        severity,
        status,
        page,
        limit,
      });

      const response: ApiResponse<PaginatedResult<Alert>> = {
        success: true,
        message: 'Alerts retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;

      await monitorService.evaluateShopOrders(shopId);

      const allAlerts = (await repository.getAlerts(shopId, { limit: 500 })).items;

      const summary = {
        totalActive: allAlerts.filter((a) => a.status === 'active').length,
        criticalCount: allAlerts.filter((a) => a.severity === 'critical' && a.status === 'active').length,
        warningCount: allAlerts.filter((a) => a.severity === 'warning' && a.status === 'active').length,
        acknowledgedCount: allAlerts.filter((a) => a.status === 'acknowledged').length,
        resolvedCount: allAlerts.filter((a) => a.status === 'resolved').length,
      };

      const response: ApiResponse<typeof summary> = {
        success: true,
        message: 'Alerts summary retrieved',
        data: summary,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async acknowledge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;
      const { id } = req.params;

      const updated = await repository.acknowledgeAlert(shopId, id);
      if (!updated) {
        throw new AppError(`Alert with ID "${id}" not found`, 404);
      }

      const response: ApiResponse<Alert> = {
        success: true,
        message: `Alert ${updated.orderNumber} has been acknowledged. The underlying order remains unfulfilled until fulfilled in Shopify.`,
        data: updated,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const alertController = new AlertController();
