import { Request, Response, NextFunction } from 'express';
import { repository } from '../db/repository';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse, Settings } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export class SettingsController {
  public async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;

      const settings = await repository.getSettings(shopId);

      const response: ApiResponse<Settings> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Settings retrieved successfully',
        data: settings,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = (req as any).shop?.shopId || primaryShop.id;
      const {
        defaultLowStockThreshold,
        defaultLeadTimeDays,
        defaultSafetyStockDays,
        salesVelocityDays,
        locationScope,
        emailEnabled,
        notificationEmail,
        dailyDigest,
        productOverrides,
        overdueThresholdHours,
        warningLeadTimeHours,
      } = req.body;

      // Validation
      if (defaultLowStockThreshold !== undefined) {
        const val = Number(defaultLowStockThreshold);
        if (isNaN(val) || val < 0) {
          throw new AppError(
            'Default low stock threshold must be a non-negative number',
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR
          );
        }
      }

      if (defaultLeadTimeDays !== undefined) {
        const val = Number(defaultLeadTimeDays);
        if (isNaN(val) || val < 1 || val > 180) {
          throw new AppError(
            'Lead time must be between 1 and 180 days',
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR
          );
        }
      }

      if (defaultSafetyStockDays !== undefined) {
        const val = Number(defaultSafetyStockDays);
        if (isNaN(val) || val < 0 || val > 90) {
          throw new AppError(
            'Safety stock must be between 0 and 90 days',
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR
          );
        }
      }

      if (notificationEmail !== undefined && emailEnabled) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(notificationEmail)) {
          throw new AppError(
            'Please enter a valid notification email address',
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR
          );
        }
      }

      const updated = await repository.updateSettings(shopId, {
        defaultLowStockThreshold,
        defaultLeadTimeDays,
        defaultSafetyStockDays,
        salesVelocityDays,
        locationScope,
        emailEnabled,
        notificationEmail,
        dailyDigest,
        productOverrides,
        overdueThresholdHours,
        warningLeadTimeHours,
      });

      const response: ApiResponse<Settings> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'StockPilot inventory rules and notification settings updated successfully',
        data: updated,
        timestamp: new Date().toISOString(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const settingsController = new SettingsController();
