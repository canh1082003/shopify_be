import { Router } from 'express';
import { analyticsController } from '../controllers/analytics.controller';

const router = Router();

router.get('/sales-velocity', analyticsController.getSalesVelocity.bind(analyticsController));
router.get('/stockout-risk', analyticsController.getStockoutRisk.bind(analyticsController));
router.get('/restock', analyticsController.getRestockSuggestions.bind(analyticsController));

export default router;
