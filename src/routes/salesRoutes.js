const express = require('express');
const router = express.Router();
const {
  recordSale,
  syncSales,
  getSalesHistory,
  getSalesSummary,
  getProfitSummary
} = require('../controllers/salesController');
const { authenticateJWT } = require('../middleware/auth');

// All sales routes require authentication
router.use(authenticateJWT);

// Record single sale (online)
router.post('/record', recordSale);

// Sync offline sales (bulk upload)
router.post('/sync', syncSales);

// Get sales history (with filters and pagination)
router.get('/history', getSalesHistory);

// Get sales summary (for dashboard)
router.get('/summary', getSalesSummary);

// Get profit summary (revenue vs profit analysis)
router.get('/profit-summary', getProfitSummary);

module.exports = router;