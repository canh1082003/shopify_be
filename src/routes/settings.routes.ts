import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller';

const router = Router();

router.get('/', (req, res, next) => settingsController.getSettings(req, res, next));
router.put('/', (req, res, next) => settingsController.updateSettings(req, res, next));

export default router;
