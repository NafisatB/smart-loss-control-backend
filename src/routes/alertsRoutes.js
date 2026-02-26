const express = require('express');
const router = express.Router();
const { 
  getAlerts, 
  getAlertsSummary,
  getAlertDetails,
  resolveAlert 
} = require('../controllers/alertsController');
const { authenticateJWT, requireOwner } = require('../middleware/auth');

// All alert routes require authentication
router.use(authenticateJWT);

// Get alerts for current shop (with filters)
router.get('/', getAlerts);

// Get alerts summary (for dashboard)
router.get('/summary', getAlertsSummary);

// Get single alert details
router.get('/:id', getAlertDetails);

// Resolve an alert (owner only)
router.patch('/:id/resolve', requireOwner, resolveAlert);

module.exports = router;
