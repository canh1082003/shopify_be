import { Request, Response } from 'express';
import { repository } from '../db/repository';
import { ApiResponse, InventoryFilterQuery } from '../types';

export class InventoryController {
  public async getInventory(req: Request, res: Response): Promise<void> {
    try {
      const shopId = (req as any).shopId;
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
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve inventory items',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  public async getInventoryItem(req: Request, res: Response): Promise<void> {
    try {
      const shopId = (req as any).shopId;
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
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve inventory item details',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  public async updateVariantOverride(req: Request, res: Response): Promise<void> {
    try {
      const shopId = (req as any).shopId;
      const { id } = req.params;
      const { lowStockThreshold, leadTimeDays, safetyStockDays } = req.body;

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
      res.status(500).json({
        success: false,
        message: 'Failed to update variant inventory rules',
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const inventoryController = new InventoryController();
