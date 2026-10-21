import { Request, Response, NextFunction } from 'express';
import { emailService } from '../services/email.service';
import { repository } from '../db/repository';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse } from '../types';

export class NotificationController {
  public async sendTestNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;
      const { email } = req.body;

      const targetEmail = email || (await repository.getSettings(shopId)).notificationEmail;

      if (!targetEmail) {
        throw new AppError('A valid recipient email address is required', 400);
      }

      const result = await emailService.sendTestEmail(shopId, targetEmail);

      const response: ApiResponse<typeof result> = {
        success: result.success,
        message: result.message,
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public async getLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const primaryShop = await repository.getPrimaryShop();
      const shopId = req.shop?.shopId || primaryShop.id;

      const logs = await repository.getNotificationLogs(shopId);

      const response: ApiResponse<typeof logs> = {
        success: true,
        message: 'Notification logs retrieved',
        data: logs,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const notificationController = new NotificationController();
