import { Router } from 'express';
import { alertController } from '../controllers/alert.controller';

const router = Router();

router.get('/', alertController.getAlerts.bind(alertController));
router.get('/summary', alertController.getSummary.bind(alertController));
router.patch('/:id/acknowledge', alertController.acknowledge.bind(alertController));
router.patch('/:id/dismiss', alertController.dismiss.bind(alertController));

export default router;
