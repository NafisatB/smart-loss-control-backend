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
  getSMSStatus,
  verifyOwnerPhone,     // <-- NEW
  resetOwnerPin         // <-- NEW
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

// Owner PIN Login (Daily login with phone + PIN)
router.post('/login-owner-pin', loginOwnerWithPIN);

// -----------------------------------
// ⭐ ADDED ROUTES FOR CREATE NEW PIN
// -----------------------------------

// Step 1 — Check if owner exists by phone
router.post('/verify-owner-phone', verifyOwnerPhone);

// Step 2 — Reset PIN directly (Create New PIN screen)
router.post('/reset-owner-pin', resetOwnerPin);

// -----------------------------------

// Generate QR Code (Owner only)
router.post('/generate-qr', authenticateJWT, requireOwner, generateQRCode);

// Validate QR Code (Public)
router.post('/validate-qr', validateQRCode);

// Check QR Code Status (Public)
router.get('/qr-status/:qr_token', checkQRStatus);

// SMS Service Status
router.get('/sms-status', getSMSStatus);

// Staff Get by Phone
router.post('/staff/get-by-phone', getStaffByPhone);

// Staff Login (PIN)
router.post('/login-pin', loginWithPIN);

// Staff Link (QR Code Onboarding)
router.post('/staff/link', linkStaff);

module.exports = router;
