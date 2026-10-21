import { Request, Response } from 'express';
import { ApiResponse, HealthCheckData } from '../types';
import { config } from '../config';
import { HttpStatus } from '../constants/httpStatus';

export class HealthController {
  public check(_req: Request, res: Response): void {
    const memory = process.memoryUsage();
    const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

    const data: HealthCheckData = {
      status: 'healthy',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: config.nodeEnv,
      memoryUsage: {
        rss: formatMb(memory.rss),
        heapTotal: formatMb(memory.heapTotal),
        heapUsed: formatMb(memory.heapUsed),
      },
    };

    const response: ApiResponse<HealthCheckData> = {
      success: true,
      statusCode: HttpStatus.OK,
      message: 'Server is running smoothly',
      data,
      timestamp: new Date().toISOString(),
    };

    res.status(HttpStatus.OK).json(response);
  }
}

export const healthController = new HealthController();
