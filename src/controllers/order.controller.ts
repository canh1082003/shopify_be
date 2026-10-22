import { Request, Response, NextFunction } from 'express';
import { repository } from '../db/repository';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse, Order, PaginatedResult } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export class OrderController {
  public async getOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;

      const status = req.query.status as any;
      const search = req.query.search as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const sortBy = req.query.sortBy as any;
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
        statusCode: HttpStatus.OK,
        message: 'Shopify read-only orders retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async getOrderById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;
      const { id } = req.params;

      const order = await repository.getOrderById(shopId, id);
      if (!order) {
        throw new AppError(`Order with ID "${id}" not found`, HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND);
      }

      const response: ApiResponse<Order> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Order context retrieved successfully',
        data: order,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const orderController = new OrderController();
