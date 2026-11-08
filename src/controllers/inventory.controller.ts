import { Request, Response } from 'express';
import { repository } from '../db/repository';
import { ApiResponse, InventoryFilterQuery } from '../types';
import { getAuthenticatedShopId, assertTenantMatch } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export class InventoryController {
  public async getInventory(req: Request, res: Response): Promise<void> {
    try {
      const shopId = getAuthenticatedShopId(req);
      if (req.query.shopId && typeof req.query.shopId === 'string') {
        assertTenantMatch(req, req.query.shopId);
      }

      const query: InventoryFilterQuery = {
        status: (req.query.status as any) || 'all',
        search: (req.query.search as string) || '',
        locationId: (req.query.locationId as string) || 'all',
        sortBy: (req.query.sortBy as any) || 'quantity',
        sortOrder: (req.query.sortOrder as any) || 'asc',
        page: parseInt(req.query.page as string, 10) || 1,
        limit: parseInt(req.query.limit as string, 10) || 10,
      };

      const result = await repository.getInventory(shopId, query);

      const response: ApiResponse<typeof result> = {
        success: true,
        message: 'Inventory items retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    } catch (error: any) {
      console.error('[InventoryController] getInventory error:', error);
      const status = error.statusCode || 500;
      res.status(status).json({
        success: false,
        message: 'Failed to retrieve inventory items',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  public async getInventoryItem(req: Request, res: Response): Promise<void> {
    try {
      const shopId = getAuthenticatedShopId(req);
      const { id } = req.params;

      const item = await repository.getInventoryItemById(shopId, id);
      if (!item) {
        res.status(404).json({
          success: false,
          message: `Inventory item variant ${id} not found`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const response: ApiResponse<typeof item> = {
        success: true,
        message: 'Inventory item details retrieved successfully',
        data: item,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    } catch (error: any) {
      console.error('[InventoryController] getInventoryItem error:', error);
      const status = error.statusCode || 500;
      res.status(status).json({
        success: false,
        message: 'Failed to retrieve inventory item details',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * SEC-02: Verifies variant ownership before updating inventory rule overrides.
   */
  public async updateVariantOverride(req: Request, res: Response): Promise<void> {
    try {
      const shopId = getAuthenticatedShopId(req);
      const { id } = req.params;

      // 1. SEC-02: Verify variant ownership
      const existingVariant = await repository.getInventoryItemById(shopId, id);
      if (!existingVariant) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: ErrorCode.RESOURCE_NOT_FOUND,
          message: `Inventory variant "${id}" not found or does not belong to your store.`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 2. Input validation
      const { lowStockThreshold, leadTimeDays, safetyStockDays } = req.body;
      if (lowStockThreshold !== undefined) {
        const val = Number(lowStockThreshold);
        if (isNaN(val) || val < 0) {
          throw new AppError(
            'Low stock threshold must be a non-negative number',
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR
          );
        }
      }
      if (leadTimeDays !== undefined) {
        const val = Number(leadTimeDays);
        if (isNaN(val) || val < 1 || val > 180) {
          throw new AppError(
            'Lead time must be between 1 and 180 days',
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR
          );
        }
      }
      if (safetyStockDays !== undefined) {
        const val = Number(safetyStockDays);
        if (isNaN(val) || val < 0 || val > 90) {
          throw new AppError(
            'Safety stock must be between 0 and 90 days',
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR
          );
        }
      }

      // 3. Update settings overrides
      const settings = await repository.getSettings(shopId);
      const overrides = { ...settings.productOverrides };

      overrides[id] = {
        lowStockThreshold:
          lowStockThreshold !== undefined ? Number(lowStockThreshold) : overrides[id]?.lowStockThreshold,
        leadTimeDays:
          leadTimeDays !== undefined ? Number(leadTimeDays) : overrides[id]?.leadTimeDays,
        safetyStockDays:
          safetyStockDays !== undefined ? Number(safetyStockDays) : overrides[id]?.safetyStockDays,
      };

      await repository.updateSettings(shopId, { productOverrides: overrides });
      const updatedItem = await repository.getInventoryItemById(shopId, id);

      const response: ApiResponse<typeof updatedItem> = {
        success: true,
        message: 'Variant inventory rules updated successfully',
        data: updatedItem,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    } catch (error: any) {
      console.error('[InventoryController] updateVariantOverride error:', error);
      const status = error.statusCode || 500;
      res.status(status).json({
        success: false,
        message: 'Failed to update variant inventory rules',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const inventoryController = new InventoryController();
