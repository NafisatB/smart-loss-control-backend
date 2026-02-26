const express = require('express');
const router = express.Router();
const { triggerCount } = require('../controllers/aiController');
const { authenticateJWT } = require('../middleware/auth');

// All AI routes require authentication
router.use(authenticateJWT);

/**
 * GET /ai/trigger-count
 * Check if staff should be prompted for spot check
 * Implements data science anomaly detection algorithm
 */
router.get('/trigger-count', triggerCount);

module.exports = router;
