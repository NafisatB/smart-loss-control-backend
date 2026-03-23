// controllers/authController.js

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { getDeviceInfo } = require('../utils/device');
const { generateToken, generateOTP } = require('../utils/jwt');
const { sendOTP, getServiceStatus } = require('../services/smsService');

// -----------------------------
// OWNER REGISTRATION & LOGIN
// -----------------------------

// Owner Registration (Step 1: Send OTP)
const registerOwner = async (req, res) => {
  const client = await pool.connect();
  try {
    const { full_name, shop_name, phone } = req.body;

    if (!phone || !full_name || !shop_name) {
      return res.status(400).json({ success: false, message: 'Phone number, full name, and shop name are required' });
    }

    // Check if owner exists
    const existingOwner = await client.query(
      'SELECT u.id, u.full_name, u.pin_hash FROM users u WHERE u.phone = $1 AND u.role = $2',
      [phone, 'OWNER']
    );

    if (existingOwner.rows.length > 0) {
      const owner = existingOwner.rows[0];
      if (!owner.pin_hash) {
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await client.query(
          `INSERT INTO otp_verifications (phone, otp_code, expires_at, full_name, shop_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [phone, otp, expiresAt, full_name, shop_name]
        );
        const smsResult = await sendOTP(phone, otp);
        return res.status(200).json({
          success: true,
          message: `OTP sent to ${phone}. Complete your registration by setting a PIN.`,
          sms_status: smsResult.status,
          sms_sid: smsResult.sid,
          sms_error: smsResult.error,
          registration_incomplete: true
        });
      }
      return res.status(409).json({ success: false, message: 'Phone already registered. Use login instead.' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await client.query(
      'INSERT INTO otp_verifications (phone, otp_code, expires_at, full_name, shop_name) VALUES ($1, $2, $3, $4, $5)',
      [phone, otp, expiresAt, full_name, shop_name]
    );

    const smsResult = await sendOTP(phone, otp);
    res.status(201).json({
      success: true,
      message: `Registration successful! OTP sent to ${phone}`,
      sms_status: smsResult.mode,
      sms_sid: smsResult.sid,
      sms_error: smsResult.error
    });

  } catch (error) {
    console.error('registerOwner error:', error);
    res.status(500).json({ success: false, message: 'Registration failed', error: error.message });
  } finally {
    client.release();
  }
};

// Owner OTP Verification (Step 2: Verify and Login)
const verifyOTP = async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP required' });

    const otpResult = await client.query(
      `SELECT * FROM otp_verifications 
       WHERE phone = $1 AND otp_code = $2 AND is_verified = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone, otp]
    );

    if (otpResult.rows.length === 0) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    const otpRecord = otpResult.rows[0];

    await client.query('UPDATE otp_verifications SET is_verified = true WHERE id = $1', [otpRecord.id]);

    let userResult = await client.query('SELECT * FROM users WHERE phone = $1 AND role = $2', [phone, 'OWNER']);
    let user;

    if (userResult.rows.length === 0) {
      // Create shop and user
      const shopResult = await client.query(
        'INSERT INTO shops (shop_name, owner_phone) VALUES ($1, $2) RETURNING id',
        [otpRecord.shop_name, phone]
      );
      const shopId = shopResult.rows[0].id;

      const newUserResult = await client.query(
        'INSERT INTO users (shop_id, full_name, phone, role) VALUES ($1, $2, $3, $4) RETURNING *',
        [shopId, otpRecord.full_name, phone, 'OWNER']
      );
      user = newUserResult.rows[0];
    } else {
      user = userResult.rows[0];
    }

    // 🔹 Device tracking
    const deviceInfo = getDeviceInfo(req);
    await client.query(
      `UPDATE users
       SET last_login_at = NOW(),
           last_login_device = $1,
           last_logout_at = NULL
       WHERE id = $2`,
      [deviceInfo, user.id]
    );

    const token = generateToken({
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      phone: user.phone
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        shop_id: user.shop_id,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        last_login_device: deviceInfo
      }
    });

  } catch (error) {
    console.error('verifyOTP error:', error);
    res.status(500).json({ success: false, message: 'OTP verification failed', error: error.message });
  } finally {
    client.release();
  }
};

// Set PIN (Step 3)
const setPIN = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id: user_id, phone, role } = req.user;
    const { pin } = req.body;

    if (!pin || !/^\d{4}$/.test(pin)) return res.status(400).json({ success: false, message: 'PIN must be 4 digits' });
    if (role !== 'OWNER') return res.status(403).json({ success: false, message: 'Only owners can set PIN' });

    const userResult = await client.query('SELECT * FROM users WHERE id = $1 AND role = $2', [user_id, 'OWNER']);
    if (userResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Owner not found' });

    const existingUser = userResult.rows[0];
    if (existingUser.pin_hash) return res.status(400).json({ success: false, message: 'PIN already set' });

    const pinHash = await bcrypt.hash(pin, 10);
    await client.query('UPDATE users SET pin_hash = $1 WHERE id = $2', [pinHash, user_id]);

    // 🔹 Device tracking
    const deviceInfo = getDeviceInfo(req);
    await client.query(
      `UPDATE users
       SET last_login_at = NOW(),
           last_login_device = $1,
           last_logout_at = NULL
       WHERE id = $2`,
      [deviceInfo, user_id]
    );

    const token = generateToken({
      id: existingUser.id,
      shop_id: existingUser.shop_id,
      role: existingUser.role,
      phone: existingUser.phone
    });

    res.json({
      success: true,
      message: 'PIN set successfully',
      token,
      user: {
        id: existingUser.id,
        shop_id: existingUser.shop_id,
        full_name: existingUser.full_name,
        phone: existingUser.phone,
        role: existingUser.role,
        last_login_device: deviceInfo
      }
    });

  } catch (error) {
    console.error('setPIN error:', error);
    res.status(500).json({ success: false, message: 'Failed to set PIN', error: error.message });
  } finally {
    client.release();
  }
};

// Owner login with PIN
const loginOwnerWithPIN = async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin || !/^\d{4}$/.test(pin)) return res.status(400).json({ success: false, message: 'Phone and 4-digit PIN required' });

    const userResult = await client.query('SELECT * FROM users WHERE phone = $1 AND role = $2', [phone, 'OWNER']);
    if (userResult.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid phone or PIN' });

    const user = userResult.rows[0];
    if (!user.pin_hash) return res.status(400).json({ success: false, message: 'PIN not set' });

    const pinMatch = await bcrypt.compare(pin, user.pin_hash);
    if (!pinMatch) return res.status(401).json({ success: false, message: 'Invalid phone or PIN' });

    // 🔹 Device tracking
    const deviceInfo = getDeviceInfo(req);
    await client.query(
      `UPDATE users
       SET last_login_at = NOW(),
           last_login_device = $1,
           last_logout_at = NULL
       WHERE id = $2`,
      [deviceInfo, user.id]
    );

    const token = generateToken({ id: user.id, shop_id: user.shop_id, role: user.role, phone: user.phone });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        shop_id: user.shop_id,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        last_login_device: deviceInfo
      }
    });

  } catch (error) {
    console.error('loginOwnerWithPIN error:', error);
    res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  } finally {
    client.release();
  }
};

// Reset Owner PIN
const resetOwnerPin = async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, new_pin } = req.body;
    if (!phone || !new_pin || !/^\d{4}$/.test(new_pin)) return res.status(400).json({ success: false, message: 'Phone and 4-digit PIN required' });

    const userResult = await client.query(
      `SELECT u.* FROM users u WHERE u.phone = $1 AND u.role = 'OWNER'`,
      [phone]
    );

    if (userResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Owner not found' });

    const user = userResult.rows[0];
    const pinHash = await bcrypt.hash(new_pin, 10);
    await client.query('UPDATE users SET pin_hash = $1 WHERE id = $2', [pinHash, user.id]);

    // 🔹 Device tracking
    const deviceInfo = getDeviceInfo(req);
    await client.query(
      `UPDATE users
       SET last_login_at = NOW(),
           last_login_device = $1,
           last_logout_at = NULL
       WHERE id = $2`,
      [deviceInfo, user.id]
    );

    const token = generateToken({ id: user.id, shop_id: user.shop_id, role: user.role, phone: user.phone });

    res.json({
      success: true,
      message: 'PIN reset successfully',
      token,
      user: {
        id: user.id,
        shop_id: user.shop_id,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        last_login_device: deviceInfo
      }
    });

  } catch (error) {
    console.error('resetOwnerPin error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset PIN', error: error.message });
  } finally {
    client.release();
  }
};

// -----------------------------
// STAFF LOGIN & LINKING
// -----------------------------

// Staff login with PIN
const loginWithPIN = async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin || !/^\d{4}$/.test(pin)) return res.status(400).json({ success: false, message: 'Phone and 4-digit PIN required' });

    const userResult = await client.query('SELECT * FROM users WHERE phone = $1 AND role = $2', [phone, 'STAFF']);
    if (userResult.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid phone or PIN' });

    const user = userResult.rows[0];
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);
    if (!pinMatch) return res.status(401).json({ success: false, message: 'Invalid phone or PIN' });

    // 🔹 Device tracking
    const deviceInfo = getDeviceInfo(req);
    await client.query(
      `UPDATE users
       SET last_login_at = NOW(),
           last_login_device = $1,
           last_logout_at = NULL
       WHERE id = $2`,
      [deviceInfo, user.id]
    );

    const token = generateToken({ id: user.id, shop_id: user.shop_id, role: user.role, staff_name: user.full_name });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        shop_id: user.shop_id,
        name: user.full_name,
        phone: user.phone,
        role: user.role,
        last_login_device: deviceInfo
      }
    });

  } catch (error) {
    console.error('loginWithPIN error:', error);
    res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  } finally {
    client.release();
  }
};

// Staff link via QR onboarding
const linkStaff = async (req, res) => {
  const client = await pool.connect();
  try {
    const { qr_token, device_id, staff_name, phone, pin } = req.body;
    if (!qr_token || !device_id || !staff_name || !phone || !pin) return res.status(400).json({ success: false, message: 'All fields required' });

    const qrResult = await client.query('SELECT * FROM qr_codes WHERE code = $1 AND is_used = false AND expires_at > NOW()', [qr_token]);
    if (qrResult.rows.length === 0) return res.status(400).json({ success: false, message: 'Invalid or expired QR code' });

    const qrCode = qrResult.rows[0];
    const shopId = qrCode.shop_id;

    const pinHash = await bcrypt.hash(pin, 10);
    const userResult = await client.query(
      `INSERT INTO users (shop_id, full_name, phone, role, pin_hash) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [shopId, staff_name, phone, 'STAFF', pinHash]
    );
    const user = userResult.rows[0];

    await client.query('INSERT INTO devices (user_id, device_id) VALUES ($1, $2)', [user.id, device_id]);
    await client.query('UPDATE qr_codes SET is_used = true WHERE id = $1', [qrCode.id]);

    // 🔹 Device tracking
    const deviceInfo = getDeviceInfo(req);
    await client.query(
      `UPDATE users
       SET last_login_at = NOW(),
           last_login_device = $1,
           last_logout_at = NULL
       WHERE id = $2`,
      [deviceInfo, user.id]
    );

    const token = generateToken({ id: user.id, shop_id: user.shop_id, role: user.role, staff_name: user.full_name });

    res.status(201).json({
      success: true,
      message: 'Staff device linked successfully',
      token,
      staff: {
        id: user.id,
        shop_id: user.shop_id,
        full_name: user.full_name,
        phone: user.phone,
        device_id,
        role: user.role,
        last_login_device: deviceInfo
      }
    });

  } catch (error) {
    console.error('linkStaff error:', error);
    res.status(500).json({ success: false, message: 'Staff linking failed', error: error.message });
  } finally {
    client.release();
  }
};

// -----------------------------
// EXPORTS
// -----------------------------
module.exports = {
  registerOwner,
  verifyOTP,
  setPIN,
  loginOwnerWithPIN,
  loginWithPIN,
  resetOwnerPin,
  linkStaff
};