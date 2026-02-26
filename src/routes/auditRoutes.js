const express = require('express');
const router = express.Router();
const {
  verifyPhysicalCount,
  getAuditHistory
} = require('../controllers/auditController');
const { authenticateJWT } = require('../middleware/auth');

// All audit routes require authentication
router.use(authenticateJWT);

// Verify physical count (spot check)
router.post('/verify', verifyPhysicalCount);

// Get audit history
router.get('/history', getAuditHistory);

module.exports = router;
