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
  reactivateSKU
} = require('../controllers/inventoryController');
const { authenticateJWT, requireOwner } = require('../middleware/auth');

// All inventory routes require authentication
router.use(authenticateJWT);

// SKU Management
router.post('/skus', createSKU);
router.get('/skus', getAllSKUs);
router.delete('/skus/:sku_id', requireOwner, deleteSKU);
router.patch('/skus/:sku_id/reactivate', requireOwner, reactivateSKU);

// Get inventory summary for current shop
router.get('/summary', getInventorySummary);

// Get specific SKU inventory details
router.get('/sku/:sku_id', getInventoryBySKU);

// Record supplier restock
router.post('/restock', recordRestock);

// Record carton to bottle decant
router.post('/decant', recordDecant);

module.exports = router;
