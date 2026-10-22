import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';

const router = Router();

router.get('/summary', dashboardController.getSummary.bind(dashboardController));
router.get('/sales-trend', dashboardController.getSalesTrend.bind(dashboardController));
router.get('/trends', dashboardController.getTrends.bind(dashboardController));

export default router;
