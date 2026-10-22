import { Request, Response, NextFunction } from 'express';
import { repository } from '../db/repository';
import { ApiResponse, DashboardSummary, DashboardTrend } from '../types';
import { HttpStatus } from '../constants/httpStatus';

export class DashboardController {
  public async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;

      const data = await repository.getStockPilotDashboardSummary(shopId);

      const response: ApiResponse<DashboardSummary> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'StockPilot overview dashboard summary retrieved successfully',
        data,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async getSalesTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;
      const rawDays = parseInt(req.query.days as string, 10);
      const days: 7 | 30 | 90 = rawDays === 30 ? 30 : rawDays === 90 ? 90 : 7;

      const data: DashboardTrend = await repository.getStockPilotSalesTrends(shopId, days);

      const response: ApiResponse<DashboardTrend> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: `Sales trends for past ${days} days retrieved successfully`,
        data,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  // Alias for backward compatibility
  public async getTrends(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.getSalesTrend(req, res, next);
  }
}

export const dashboardController = new DashboardController();
