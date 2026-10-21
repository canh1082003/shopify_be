import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';

const router = Router();

router.post('/test', (req, res, next) => notificationController.sendTestNotification(req, res, next));
router.get('/logs', (req, res, next) => notificationController.getLogs(req, res, next));

export default router;
