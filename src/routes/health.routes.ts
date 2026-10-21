import { Router } from 'express';
import { healthController } from '../controllers/health.controller';

const router = Router();

router.get('/', (req, res) => healthController.check(req, res));

export default router;
