const express = require('express');
const router = express.Router();
const { getDashboardOverview } = require('../controllers/dashboardController');
const { authenticateJWT } = require('../middleware/auth');

// All dashboard routes require authentication
router.use(authenticateJWT);

// Get dashboard overview (owner and staff can view)
router.get('/overview', getDashboardOverview);

module.exports = router;
