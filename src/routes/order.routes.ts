import { Router } from 'express';
import { orderController } from '../controllers/order.controller';

const router = Router();

router.get('/', (req, res, next) => orderController.getOrders(req, res, next));
router.get('/:id', (req, res, next) => orderController.getOrderById(req, res, next));

export default router;
