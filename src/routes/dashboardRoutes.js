const express = require('express');
const router = express.Router();
const { getDashboardOverview, getTopSelling } = require('../controllers/dashboardController');
const { authenticateJWT } = require('../middleware/auth');

// All dashboard routes require authentication
router.use(authenticateJWT);

// Get dashboard overview (owner and staff can view)
router.get('/overview', getDashboardOverview);

// Get top selling products
router.get('/top-selling', getTopSelling);

module.exports = router;
