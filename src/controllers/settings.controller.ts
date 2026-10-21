import { Request, Response, NextFunction } from 'express';
import { repository } from '../db/repository';
import { monitorService } from '../services/monitor.service';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse, Settings } from '../types';
import { HttpStatus, ErrorCode } from '../constants/httpStatus';

export class SettingsController {
  public async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;

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
      const shopId = req.shop?.shopId || primaryShop.id;
      const {
        overdueThresholdHours,
        warningLeadTimeHours,
        emailEnabled,
        notificationEmail,
        digestFrequency,
        autoAcknowledge,
        excludeTags,
      } = req.body;

      // Validation
      if (overdueThresholdHours !== undefined) {
        const threshold = Number(overdueThresholdHours);
        if (isNaN(threshold) || threshold <= 0 || threshold > 720) {
          throw new AppError(
            'Overdue threshold must be between 1 and 720 hours (30 days)',
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR
          );
        }
      }

      if (warningLeadTimeHours !== undefined) {
        const lead = Number(warningLeadTimeHours);
        const threshold = overdueThresholdHours !== undefined ? Number(overdueThresholdHours) : 24;
        if (isNaN(lead) || lead < 0 || lead >= threshold) {
          throw new AppError(
            `Warning lead time must be between 0 and less than threshold (${threshold}h)`,
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
        overdueThresholdHours,
        warningLeadTimeHours,
        emailEnabled,
        notificationEmail,
        digestFrequency,
        autoAcknowledge,
        excludeTags,
      });

      // Immediately re-evaluate orders with the new threshold
      await monitorService.evaluateShopOrders(shopId);

      const response: ApiResponse<Settings> = {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Settings updated successfully and order watchdog re-evaluated',
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
