const express = require('express');
const router = express.Router();
const {
  getDeviationReport,
  getStaffPerformanceReport,
  getInventoryTurnoverReport,
  getSalesTrendReport
} = require('../controllers/reportsController');
const { authenticateJWT, requireOwner } = require('../middleware/auth');

// All report routes require authentication and owner role
router.use(authenticateJWT);
router.use(requireOwner);

// Deviation report (variance trends)
router.get('/deviation', getDeviationReport);

// Staff performance report
router.get('/staff-performance', getStaffPerformanceReport);

// Inventory turnover report
router.get('/inventory-turnover', getInventoryTurnoverReport);

// Sales trend report
router.get('/sales-trend', getSalesTrendReport);

module.exports = router;
