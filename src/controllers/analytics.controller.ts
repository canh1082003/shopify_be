import { Request, Response } from 'express';
import { repository } from '../db/repository';
import { ApiResponse } from '../types';

export class AnalyticsController {
  public async getSalesVelocity(req: Request, res: Response): Promise<void> {
    try {
      const shopId = (req as any).shopId;
      const data = await repository.getAnalyticsSalesVelocity(shopId);

      const response: ApiResponse<typeof data> = {
        success: true,
        message: 'Sales velocity analysis retrieved successfully',
        data,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    } catch (error: any) {
      console.error('[AnalyticsController] getSalesVelocity error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve sales velocity analysis',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  public async getStockoutRisk(req: Request, res: Response): Promise<void> {
    try {
      const shopId = (req as any).shopId;
      const data = await repository.getAnalyticsStockoutRisk(shopId);

      const response: ApiResponse<typeof data> = {
        success: true,
        message: 'Stockout risk matrix retrieved successfully',
        data,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    } catch (error: any) {
      console.error('[AnalyticsController] getStockoutRisk error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve stockout risk matrix',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  public async getRestockSuggestions(req: Request, res: Response): Promise<void> {
    try {
      const shopId = (req as any).shopId;
      const data = await repository.getAnalyticsRestock(shopId);

      const response: ApiResponse<typeof data> = {
        success: true,
        message: 'Restock recommendations calculated successfully',
        data,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    } catch (error: any) {
      console.error('[AnalyticsController] getRestockSuggestions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve restock recommendations',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const analyticsController = new AnalyticsController();
