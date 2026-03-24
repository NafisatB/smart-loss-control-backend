const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { getDeviceInfo } = require('../utils/device');
const { generateToken, generateOTP } = require('../utils/jwt');
const { sendOTP, getServiceStatus } = require('../services/smsService');

// Helper: update login tracking
const updateLoginTracking = async (client, userId, req) => {
  const deviceInfo = getDeviceInfo(req);

  await client.query(
    `UPDATE users
     SET last_login_at = NOW(),
         last_login_device = $1,
         is_online = true,
         last_logout_at = NULL
     WHERE id = $2`,
    [deviceInfo, userId]
  );

  return deviceInfo;
};

// Owner Registration
const registerOwner = async (req, res) => {
  const client = await pool.connect();

  try {
    const { full_name, shop_name, phone } = req.body;

    if (!phone || !full_name || !shop_name) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, full name, and shop name are required for registration'
      });
    }

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
          sms_status: smsResult.status || smsResult.mode,
          sms_sid: smsResult.sid,
          sms_error: smsResult.error,
          registration_incomplete: true
        });
      }

      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered. Please use the login endpoint instead.'
      });
    }

    const existingShop = await client.query(
      'SELECT id, shop_name, owner_phone FROM shops WHERE owner_phone = $1',
      [phone]
    );

    if (existingShop.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered to another shop owner'
      });
    }

    const existingUser = await client.query(
      'SELECT id, full_name, role, shop_id FROM users WHERE phone = $1',
      [phone]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      return res.status(409).json({
        success: false,
        message: `This phone number is already registered as ${user.role} in another shop`
      });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await client.query(
      `INSERT INTO otp_verifications (phone, otp_code, expires_at, full_name, shop_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [phone, otp, expiresAt, full_name, shop_name]
    );

    const smsResult = await sendOTP(phone, otp);

    const response = {
      success: true,
      message: `Registration successful! OTP sent to ${phone}`,
      sms_status: smsResult.mode
    };

    if ((smsResult.mode === 'production' || smsResult.mode === 'sandbox') && smsResult.messageId) {
      response.message_id = smsResult.messageId;
    } else if (smsResult.mode === 'fallback') {
      response.sms_error = smsResult.error;
      response.fallback_note = 'SMS failed, check dashboard or server console';
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Register owner error:', error);

    if (error.code === '23505' && error.constraint === 'shops_owner_phone_key') {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered to another shop'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Owner Login (OTP request)
const loginOwner = async (req, res) => {
  const client = await pool.connect();

  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const existingOwner = await client.query(
      `SELECT u.id, u.full_name, u.shop_id, s.shop_name
       FROM users u
       JOIN shops s ON u.shop_id = s.id
       WHERE u.phone = $1 AND u.role = $2`,
      [phone, 'OWNER']
    );

    if (existingOwner.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this phone number. Please register first.'
      });
    }

    const owner = existingOwner.rows[0];
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await client.query(
      'INSERT INTO otp_verifications (phone, otp_code, expires_at) VALUES ($1, $2, $3)',
      [phone, otp, expiresAt]
    );

    const smsResult = await sendOTP(phone, otp);

    const response = {
      success: true,
      message: `OTP sent to ${phone}`,
      owner_name: owner.full_name,
      shop_name: owner.shop_name,
      sms_status: smsResult.mode
    };

    if (smsResult.mode === 'production') {
      response.sms_sid = smsResult.sid;
    } else if (smsResult.mode === 'fallback') {
      response.sms_error = smsResult.error;
      response.fallback_note = 'SMS failed, check console for OTP';
    }

    res.json(response);
  } catch (error) {
    console.error('Login owner error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Owner OTP Verification
const verifyOTP = async (req, res) => {
  const client = await pool.connect();

  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone and OTP are required'
      });
    }

    const recentAttempts = await client.query(
      `SELECT COUNT(*) as attempt_count
       FROM otp_verifications
       WHERE phone = $1
       AND created_at > NOW() - INTERVAL '15 minutes'`,
      [phone]
    );

    if (parseInt(recentAttempts.rows[0].attempt_count, 10) > 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please wait 15 minutes and try again.'
      });
    }

    const otpResult = await client.query(
      `SELECT * FROM otp_verifications
       WHERE phone = $1
         AND otp_code = $2
         AND is_verified = false
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone, otp]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    const otpRecord = otpResult.rows[0];

    await client.query(
      'UPDATE otp_verifications SET is_verified = true WHERE id = $1',
      [otpRecord.id]
    );

    let userResult = await client.query(
      'SELECT id, shop_id, full_name, phone, role FROM users WHERE phone = $1 AND role = $2',
      [phone, 'OWNER']
    );

    let user;

    if (userResult.rows.length === 0) {
      if (!otpRecord.full_name || !otpRecord.shop_name) {
        return res.status(400).json({
          success: false,
          message: 'Registration data not found. Please register again.'
        });
      }

      const shopResult = await client.query(
        'INSERT INTO shops (shop_name, owner_phone) VALUES ($1, $2) RETURNING id',
        [otpRecord.shop_name, phone]
      );
      const shopId = shopResult.rows[0].id;

      const newUserResult = await client.query(
        `INSERT INTO users (shop_id, full_name, phone, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, shop_id, full_name, phone, role`,
        [shopId, otpRecord.full_name, phone, 'OWNER']
      );

      user = newUserResult.rows[0];
    } else {
      user = userResult.rows[0];
    }

    const deviceInfo = await updateLoginTracking(client, user.id, req);

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
        device: deviceInfo,
        is_online: true
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'OTP verification failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Set PIN
const setPIN = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id: user_id, phone, role } = req.user;
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({
        success: false,
        message: 'PIN is required'
      });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits (0-9)'
      });
    }

    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can set PIN through this endpoint'
      });
    }

    const userResult = await client.query(
      'SELECT id, shop_id, full_name, phone, role, pin_hash FROM users WHERE id = $1 AND role = $2',
      [user_id, 'OWNER']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found.'
      });
    }

    const user = userResult.rows[0];

    if (user.pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'PIN already set. Use the PIN reset endpoint to change it.'
      });
    }

    const pinHash = await bcrypt.hash(pin, 10);

    await client.query(
      'UPDATE users SET pin_hash = $1 WHERE id = $2',
      [pinHash, user.id]
    );

    const token = generateToken({
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      phone: user.phone
    });

    res.json({
      success: true,
      message: 'PIN set successfully. You can now login with your phone and PIN.',
      token,
      user: {
        id: user.id,
        shop_id: user.shop_id,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Set PIN error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set PIN',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Owner PIN Login
const loginOwnerWithPIN = async (req, res) => {
  const client = await pool.connect();

  try {
    const { phone, pin } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({
        success: false,
        message: 'Phone and PIN are required'
      });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits'
      });
    }

    const userResult = await client.query(
      `SELECT id, shop_id, full_name, phone, role, pin_hash, is_active
       FROM users
       WHERE phone = $1 AND role = $2`,
      [phone, 'OWNER']
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or PIN'
      });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    if (!user.pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'PIN not set. Please complete registration by setting your PIN.'
      });
    }

    const pinMatch = await bcrypt.compare(pin, user.pin_hash);

    if (!pinMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or PIN'
      });
    }

    const deviceInfo = await updateLoginTracking(client, user.id, req);

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
        device: deviceInfo,
        is_online: true
      }
    });
  } catch (error) {
    console.error('Owner PIN login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Verify owner phone
const verifyOwnerPhone = async (req, res) => {
  const client = await pool.connect();

  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const result = await client.query(
      `SELECT u.full_name, s.shop_name
       FROM users u
       JOIN shops s ON u.shop_id = s.id
       WHERE u.phone = $1 AND u.role = 'OWNER'`,
      [phone]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        exists: false
      });
    }

    const owner = result.rows[0];

    return res.json({
      success: true,
      exists: true,
      full_name: owner.full_name,
      shop_name: owner.shop_name
    });
  } catch (error) {
    console.error('verifyOwnerPhone error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify phone',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Reset owner PIN
const resetOwnerPin = async (req, res) => {
  const client = await pool.connect();

  try {
    const { phone, new_pin } = req.body;

    if (!phone || !new_pin) {
      return res.status(400).json({
        success: false,
        message: 'Phone and new PIN are required'
      });
    }

    if (!/^\d{4}$/.test(new_pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits'
      });
    }

    const userResult = await client.query(
      `SELECT u.id, u.full_name, u.shop_id, u.role, s.shop_name
       FROM users u
       JOIN shops s ON u.shop_id = s.id
       WHERE u.phone = $1 AND u.role = 'OWNER'`,
      [phone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found'
      });
    }

    const user = userResult.rows[0];
    const pinHash = await bcrypt.hash(new_pin, 10);

    await client.query(
      "UPDATE users SET pin_hash = $1 WHERE phone = $2 AND role = 'OWNER'",
      [pinHash, phone]
    );

    const token = generateToken({
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      phone
    });

    return res.json({
      success: true,
      message: 'PIN reset successfully',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        phone,
        role: user.role,
        shop_id: user.shop_id,
        shop_name: user.shop_name
      }
    });
  } catch (error) {
    console.error('resetOwnerPin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset PIN',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Staff PIN Login
const loginWithPIN = async (req, res) => {
  const client = await pool.connect();

  try {
    const { phone, pin } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and PIN are required'
      });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits'
      });
    }

    const userResult = await client.query(
      `SELECT id, shop_id, full_name, phone, role, pin_hash, is_active
       FROM users
       WHERE phone = $1 AND role = $2`,
      [phone, 'STAFF']
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or PIN'
      });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    const pinMatch = await bcrypt.compare(pin, user.pin_hash);

    if (!pinMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or PIN'
      });
    }

    const deviceInfo = await updateLoginTracking(client, user.id, req);

    const token = generateToken({
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      staff_name: user.full_name
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        shop_id: user.shop_id,
        name: user.full_name,
        phone: user.phone,
        role: user.role,
        device: deviceInfo,
        is_online: true
      }
    });
  } catch (error) {
    console.error('Login with PIN error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Get staff by phone
const getStaffByPhone = async (req, res) => {
  const client = await pool.connect();

  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const userResult = await client.query(
      `SELECT id, shop_id, full_name, phone, role, is_active
       FROM users
       WHERE phone = $1 AND role = $2`,
      [phone, 'STAFF']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No staff found with this phone number'
      });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    res.json({
      success: true,
      staff: {
        id: user.id,
        name: user.full_name,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Get staff by phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get staff information',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Staff Link
const linkStaff = async (req, res) => {
  const client = await pool.connect();

  try {
    const { qr_token, device_id, staff_name, phone, pin } = req.body;

    if (!qr_token || !device_id || !staff_name || !phone || !pin) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required (QR token, device ID, name, phone, PIN)'
      });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits'
      });
    }

    const qrResult = await client.query(
      `SELECT * FROM qr_codes
       WHERE code = $1 AND is_used = false AND expires_at > NOW()`,
      [qr_token]
    );

    if (qrResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired QR code'
      });
    }

    const qrCode = qrResult.rows[0];
    const shopId = qrCode.shop_id;

    const existingStaffName = await client.query(
      'SELECT id FROM users WHERE shop_id = $1 AND full_name = $2 AND role = $3',
      [shopId, staff_name, 'STAFF']
    );

    if (existingStaffName.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Staff name already exists in this shop'
      });
    }

    const existingStaffPhone = await client.query(
      'SELECT id FROM users WHERE shop_id = $1 AND phone = $2 AND role = $3',
      [shopId, phone, 'STAFF']
    );

    if (existingStaffPhone.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already registered for another staff member in this shop'
      });
    }

    const pinHash = await bcrypt.hash(pin, 10);

    const userResult = await client.query(
      `INSERT INTO users (shop_id, full_name, phone, role, pin_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, shop_id, full_name, phone, role`,
      [shopId, staff_name, phone, 'STAFF', pinHash]
    );

    const user = userResult.rows[0];

    await client.query(
      'INSERT INTO devices (user_id, device_id) VALUES ($1, $2)',
      [user.id, device_id]
    );

    await client.query(
      'UPDATE qr_codes SET is_used = true WHERE id = $1',
      [qrCode.id]
    );

    const token = generateToken({
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      staff_name: user.full_name
    });

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
        role: user.role
      }
    });
  } catch (error) {
    console.error('Link staff error:', error);
    res.status(500).json({
      success: false,
      message: 'Staff linking failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Generate QR code
const generateQRCode = async (req, res) => {
  const client = await pool.connect();

  try {
    const { shop_id, role } = req.user;

    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can generate QR codes'
      });
    }

    const qrToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const qrResult = await client.query(
      `INSERT INTO qr_codes (shop_id, code, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, code, expires_at`,
      [shop_id, qrToken, expiresAt]
    );

    const qrCode = qrResult.rows[0];
    const now = new Date();
    const remainingMs = new Date(qrCode.expires_at) - now;
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    res.status(201).json({
      success: true,
      message: 'QR code generated successfully',
      qr_code: {
        id: qrCode.id,
        token: qrCode.code,
        expires_at: qrCode.expires_at,
        expires_in_minutes: 30,
        remaining_time: {
          hours: remainingHours,
          minutes: remainingMinutes,
          total_minutes: Math.floor(remainingMs / (1000 * 60))
        }
      },
      instructions: {
        usage: 'Share this QR code with staff to link their devices',
        expiry: `QR code expires in ${remainingMinutes}m`,
        staff_flow: 'Staff scans QR → Enters name + PIN → Device linked'
      }
    });
  } catch (error) {
    console.error('Generate QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'QR code generation failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Check QR status
const checkQRStatus = async (req, res) => {
  const client = await pool.connect();

  try {
    const { qr_token } = req.params;

    if (!qr_token) {
      return res.status(400).json({
        success: false,
        message: 'QR token is required'
      });
    }

    const qrResult = await client.query(
      `SELECT id, shop_id, code, expires_at, is_used, created_at
       FROM qr_codes
       WHERE code = $1`,
      [qr_token]
    );

    if (qrResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'QR code not found'
      });
    }

    const qrCode = qrResult.rows[0];
    const now = new Date();
    const expiresAt = new Date(qrCode.expires_at);
    const remainingMs = expiresAt - now;
    const isExpired = remainingMs <= 0;
    const isUsed = qrCode.is_used;

    let status = 'active';
    if (isUsed) status = 'used';
    else if (isExpired) status = 'expired';

    const remainingHours = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60)));
    const remainingMinutes = Math.max(0, Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60)));
    const remainingSeconds = Math.max(0, Math.floor((remainingMs % (1000 * 60)) / 1000));

    res.json({
      success: true,
      qr_status: {
        token: qrCode.code,
        status,
        is_expired: isExpired,
        is_used: isUsed,
        expires_at: qrCode.expires_at,
        created_at: qrCode.created_at,
        remaining_time: {
          hours: remainingHours,
          minutes: remainingMinutes,
          seconds: remainingSeconds,
          total_seconds: Math.max(0, Math.floor(remainingMs / 1000))
        }
      },
      message:
        status === 'active'
          ? `QR code valid for ${remainingMinutes}m ${remainingSeconds}s`
          : status === 'used'
            ? 'QR code has been used'
            : 'QR code has expired'
    });
  } catch (error) {
    console.error('Check QR status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check QR status',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// SMS service status
const getSMSStatus = async (req, res) => {
  try {
    const status = getServiceStatus();

    res.json({
      success: true,
      sms_service: status,
      environment: process.env.NODE_ENV || 'development',
      message: status.configured
        ? 'SMS service is configured and ready'
        : 'SMS service not configured - using development mode'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get SMS status',
      error: error.message
    });
  }
};

// Validate QR code
const validateQRCode = async (req, res) => {
  const client = await pool.connect();

  try {
    const { qr_token } = req.body;

    if (!qr_token) {
      return res.status(400).json({
        success: false,
        message: 'QR token is required'
      });
    }

    const qrResult = await client.query(
      `SELECT * FROM qr_codes WHERE code = $1`,
      [qr_token]
    );

    if (qrResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invalid QR code'
      });
    }

    const qrCode = qrResult.rows[0];

    if (qrCode.is_used) {
      return res.status(400).json({
        success: false,
        message: 'QR code has already been used'
      });
    }

    if (new Date(qrCode.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'QR code has expired. Please ask your manager for a new one.'
      });
    }

    res.json({
      success: true,
      message: 'QR code is valid',
      expires_at: qrCode.expires_at
    });
  } catch (error) {
    console.error('Validate QR error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate QR code',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Logout user
const logoutUser = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.user;

    await client.query(
      `UPDATE users
       SET is_online = false,
           last_logout_at = NOW()
       WHERE id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: 'User logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

module.exports = {
  registerOwner,
  verifyOTP,
  setPIN,
  loginOwnerWithPIN,
  loginOwner,
  loginWithPIN,
  verifyOwnerPhone,
  resetOwnerPin,
  getStaffByPhone,
  linkStaff,
  generateQRCode,
  validateQRCode,
  checkQRStatus,
  getSMSStatus,
  logoutUser
};
