import { Request, Response, NextFunction } from 'express';
import { repository } from '../db/repository';
import { monitorService } from '../services/monitor.service';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse, Order, PaginatedResult } from '../types';

export class OrderController {
  public async getOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;

      // Refresh computed states
      await monitorService.evaluateShopOrders(shopId);

      const status = req.query.status as 'all' | 'overdue' | 'pending' | 'fulfilled' | undefined;
      const search = req.query.search as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const sortBy = req.query.sortBy as 'newest' | 'oldest' | 'overdue_desc' | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const result = await repository.getOrders(shopId, {
        status,
        search,
        dateFrom,
        dateTo,
        sortBy,
        page,
        limit,
      });

      const response: ApiResponse<PaginatedResult<Order>> = {
        success: true,
        message: 'Orders retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async getOrderById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;
      const { id } = req.params;

      const order = await repository.getOrderById(shopId, id);
      if (!order) {
        throw new AppError(`Order with ID "${id}" not found`, 404);
      }

      const response: ApiResponse<Order> = {
        success: true,
        message: 'Order details retrieved',
        data: order,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const orderController = new OrderController();
