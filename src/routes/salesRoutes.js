const express = require('express');
const router = express.Router();
const {
  syncSales,
  getSalesHistory,
  getSalesSummary
} = require('../controllers/salesController');
const { authenticateJWT } = require('../middleware/auth');

// All sales routes require authentication
router.use(authenticateJWT);

// Sync offline sales (bulk upload)
router.post('/sync', syncSales);

// Get sales history (with filters and pagination)
router.get('/history', getSalesHistory);

// Get sales summary (for dashboard)
router.get('/summary', getSalesSummary);

module.exports = router;