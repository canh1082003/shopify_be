import { Router } from 'express';
import { inventoryController } from '../controllers/inventory.controller';

const router = Router();

router.get('/', inventoryController.getInventory.bind(inventoryController));
router.get('/:id', inventoryController.getInventoryItem.bind(inventoryController));
router.patch('/:id/override', inventoryController.updateVariantOverride.bind(inventoryController));

export default router;
