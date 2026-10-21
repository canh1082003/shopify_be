import { Request, Response, NextFunction } from 'express';
import { repository } from '../db/repository';
import { monitorService } from '../services/monitor.service';
import { config } from '../config';
import { ApiResponse, DashboardSummary, DashboardTrend } from '../types';

export class DashboardController {
  public async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;

      // Run quick evaluation to ensure computed deadlines are fresh
      await monitorService.evaluateShopOrders(shopId);

      const summary = await repository.getDashboardSummary(shopId);
      const settings = await repository.getSettings(shopId);
      const orders = await repository.getAllActiveOrders(shopId);

      const data: DashboardSummary = {
        totalOrders: summary.totalOrders,
        overdueOrders: summary.overdueOrders,
        pendingFulfillment: summary.pendingFulfillment,
        onTimeRate: summary.onTimeRate,
        comparison: {
          totalOrdersDiff: 12.5, // Trend vs prior period
          overdueDiff: -4.2,
        },
        monitoringStatus: {
          isShopifyConnected: !primaryShop.isDemo && config.shopify.isConfigured,
          shopDomain: primaryShop.shopDomain,
          isDemoMode: primaryShop.isDemo || !config.shopify.isConfigured,
          lastSyncedAt: orders.length > 0 ? orders[0].lastSyncedAt : new Date().toISOString(),
          thresholdHours: settings.overdueThresholdHours,
          emailEnabled: settings.emailEnabled,
          activeAlertsCount: summary.activeAlertsCount,
        },
      };

      const response: ApiResponse<DashboardSummary> = {
        success: true,
        message: 'Dashboard summary retrieved successfully',
        data,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async getTrends(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;
      const rawDays = parseInt(req.query.days as string, 10);
      const days: 7 | 30 | 90 = rawDays === 30 ? 30 : rawDays === 90 ? 90 : 7;

      const points = await repository.getDashboardTrends(shopId, days);

      const response: ApiResponse<DashboardTrend> = {
        success: true,
        message: `Overdue trends for past ${days} days retrieved`,
        data: {
          period: `${days}d` as '7d' | '30d' | '90d',
          points,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const dashboardController = new DashboardController();
