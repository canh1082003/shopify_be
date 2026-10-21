import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';

const router = Router();

router.get('/summary', (req, res, next) => dashboardController.getSummary(req, res, next));
router.get('/trends', (req, res, next) => dashboardController.getTrends(req, res, next));

export default router;
