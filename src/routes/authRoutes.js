const express = require('express');
const router = express.Router();
const {
  registerOwner,
  verifyOTP,
  setPIN,
  loginOwnerWithPIN,
  loginOwner,
  loginWithPIN,
  getStaffByPhone,
  linkStaff,
  generateQRCode,
  validateQRCode,
  checkQRStatus,
  getSMSStatus
} = require('../controllers/authController');
const { authenticateJWT, requireOwner } = require('../middleware/auth');

// Owner Registration (NEW OWNERS - Step 1: Send OTP)
router.post('/register-owner', registerOwner);

// Owner Login (EXISTING OWNERS - Step 1: Send OTP)
router.post('/login-owner', loginOwner);

// Owner OTP Verification (Step 2: Verify OTP)
router.post('/verify-otp', verifyOTP);

// Owner Set PIN (Step 3: Set PIN after OTP verification - requires JWT token)
router.post('/set-pin', authenticateJWT, setPIN);

// Owner PIN Login (Daily login with phone + PIN, no OTP needed)
router.post('/login-owner-pin', loginOwnerWithPIN);

// Generate QR Code for Staff Onboarding (Owner only)
router.post('/generate-qr', authenticateJWT, requireOwner, generateQRCode);

// Validate QR Code (Public endpoint - checks if QR is valid and not expired)
router.post('/validate-qr', validateQRCode);

// Check QR Code Status (Public endpoint for countdown)
router.get('/qr-status/:qr_token', checkQRStatus);

// SMS Service Status (Development endpoint)
router.get('/sms-status', getSMSStatus);

// Get Staff by Phone (for login flow - Step 1)
router.post('/staff/get-by-phone', getStaffByPhone);

// Staff PIN Login (Step 2)
router.post('/login-pin', loginWithPIN);

// Staff Link (QR Code Onboarding)
router.post('/staff/link', linkStaff);

module.exports = router;
