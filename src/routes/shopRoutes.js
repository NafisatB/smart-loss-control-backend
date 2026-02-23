const express = require('express');
const router = express.Router();
const {
  getShopProfile,
  updateShopProfile,
  getStaffList,
  getStaffDetails,
  revokeStaffAccess,
  reactivateStaffAccess
} = require('../controllers/shopController');
const { authenticateJWT, requireOwner } = require('../middleware/auth');

// All shop routes require authentication
router.use(authenticateJWT);

// Shop profile (accessible by owner and staff)
router.get('/me', getShopProfile);

// Update shop profile (owner only)
router.patch('/me', requireOwner, updateShopProfile);

// Staff management (owner only)
router.get('/staff', requireOwner, getStaffList);
router.get('/staff/:staff_id', requireOwner, getStaffDetails);
router.patch('/staff/:staff_id/revoke', requireOwner, revokeStaffAccess);
router.patch('/staff/:staff_id/reactivate', requireOwner, reactivateStaffAccess);

module.exports = router;
