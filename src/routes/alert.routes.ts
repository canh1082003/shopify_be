import { Router } from 'express';
import { alertController } from '../controllers/alert.controller';

const router = Router();

router.get('/summary', (req, res, next) => alertController.getSummary(req, res, next));
router.get('/', (req, res, next) => alertController.getAlerts(req, res, next));
router.patch('/:id/acknowledge', (req, res, next) => alertController.acknowledge(req, res, next));

export default router;
