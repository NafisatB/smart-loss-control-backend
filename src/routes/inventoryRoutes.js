const express = require('express');
const router = express.Router();
const {
  createSKU,
  getAllSKUs,
  getInventorySummary,
  getInventoryBySKU,
  recordRestock,
  recordDecant,
  deleteSKU,
  reactivateSKU,
  updateSKUInventory,
  getLowStock
} = require('../controllers/inventoryController');
const { authenticateJWT, requireOwner } = require('../middleware/auth');

// All inventory routes require authentication
router.use(authenticateJWT);

// SKU Management
router.post('/skus', createSKU);
router.get('/skus', getAllSKUs);
router.patch('/skus/:sku_id', requireOwner, updateSKUInventory);
router.delete('/skus/:sku_id', requireOwner, deleteSKU);
router.patch('/skus/:sku_id/reactivate', requireOwner, reactivateSKU);

// Get inventory summary for current shop
router.get('/summary', getInventorySummary);

// Get low stock items (products at or below reorder level)
router.get('/low-stock', getLowStock);

// Get specific SKU inventory details
router.get('/sku/:sku_id', getInventoryBySKU);

// Record supplier restock
router.post('/restock', recordRestock);

// Record carton to bottle decant
router.post('/decant', recordDecant);

module.exports = router;
