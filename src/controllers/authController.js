const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { getDeviceInfo } = require('../utils/device');
const { generateToken, generateOTP } = require('../utils/jwt');
const { sendOTP } = require('../services/smsService');

/**
 * OWNER: Registration (Step 1: Send OTP)
 */
const registerOwner = async (req, res) => {
  const client = await pool.connect();
  try {
    const { full_name, shop_name, phone } = req.body;
    if (!phone || !full_name || !shop_name) {
      return res.status(400).json({ success: false, message: 'Phone number, full name, and shop name are required' });
    }

    const existingOwner = await client.query(
      'SELECT id, full_name, pin_hash FROM users WHERE phone = $1 AND role = $2',
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
          registration_incomplete: true,
        });
      }
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered. Please use the login endpoint instead.',
      });
    }

    const existingShop = await client.query('SELECT id FROM shops WHERE owner_phone = $1', [phone]);
    if (existingShop.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered to another shop owner',
      });
    }

    const existingUser = await client.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      return res.status(409).json({
        success: false,
        message: `This phone number is already registered as ${user.role} in another shop`,
      });
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
    });
  } catch (error) {
    console.error('Register owner error:', error);
    res.status(500).json({ success: false, message: 'Registration failed', error: error.message });
  } finally {
    client.release();
  }
};

/**
 * OWNER: Login via OTP (Step 1: Send OTP)
 */
const loginOwner = async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone is required' });

    const existingOwner = await client.query(
      'SELECT u.id, u.full_name, u.shop_id, s.shop_name FROM users u JOIN shops s ON u.shop_id = s.id WHERE u.phone = $1 AND u.role = $2',
      [phone, 'OWNER']
    );

    if (existingOwner.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No account found. Please register first.' });
    }

    const owner = existingOwner.rows[0];
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await client.query('INSERT INTO otp_verifications (phone, otp_code, expires_at) VALUES ($1, $2, $3)', [
      phone,
      otp,
      expiresAt,
    ]);
    const smsResult = await sendOTP(phone, otp);

    res.json({
      success: true,
      message: `OTP sent to ${phone}`,
      owner_name: owner.full_name,
      shop_name: owner.shop_name,
      sms_status: smsResult.mode,
    });
  } catch (error) {
    console.error('Login owner error:', error);
    res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  } finally {
    client.release();
  }
};

/**
 * OTP Verification (Owners)
 */
const verifyOTP = async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP required' });

    const otpResult = await client.query(
      `SELECT * FROM otp_verifications WHERE phone=$1 AND otp_code=$2 AND is_verified=false AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1`,
      [phone, otp]
    );
    if (otpResult.rows.length === 0) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

    const otpRecord = otpResult.rows[0];
    await client.query('UPDATE otp_verifications SET is_verified=true WHERE id=$1', [otpRecord.id]);

    let userResult = await client.query('SELECT * FROM users WHERE phone=$1 AND role=$2', [phone, 'OWNER']);
    let user;

    if (userResult.rows.length === 0) {
      const shopResult = await client.query(
        'INSERT INTO shops (shop_name, owner_phone) VALUES ($1, $2) RETURNING id',
        [otpRecord.shop_name, phone]
      );
      const shopId = shopResult.rows[0].id;

      const newUser = await client.query(
        'INSERT INTO users (shop_id, full_name, phone, role) VALUES ($1, $2, $3, $4) RETURNING *',
        [shopId, otpRecord.full_name, phone, 'OWNER']
      );
      user = newUser.rows[0];
    } else {
      user = userResult.rows[0];
    }

    // Track device + online status
    const deviceInfo = getDeviceInfo(req);
    await client.query('UPDATE users SET last_login_at=NOW(), last_device=$1, is_online=true WHERE id=$2', [
      deviceInfo,
      user.id,
    ]);

    const token = generateToken({
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      phone: user.phone,
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
      },
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'OTP verification failed', error: error.message });
  } finally {
    client.release();
  }
};

/**
 * OWNER: PIN Login (Daily)
 */
const loginOwnerWithPIN = async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin)
      return res.status(400).json({ success: false, message: 'Phone and PIN required' });

    const userResult = await client.query('SELECT * FROM users WHERE phone=$1 AND role=$2', [phone, 'OWNER']);
    if (userResult.rows.length === 0)
      return res.status(401).json({ success: false, message: 'Invalid phone or PIN' });

    const user = userResult.rows[0];
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);
    if (!pinMatch) return res.status(401).json({ success: false, message: 'Invalid phone or PIN' });

    const deviceInfo = getDeviceInfo(req);
    await client.query('UPDATE users SET last_login_at=NOW(), last_device=$1, is_online=true WHERE id=$2', [
      deviceInfo,
      user.id,
    ]);

    const token = generateToken({
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      phone: user.phone,
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
      },
    });
  } catch (error) {
    console.error('Owner PIN login error:', error);
    res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  } finally {
    client.release();
  }
};

/**
 * STAFF: PIN Login
 */
const loginWithPIN = async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin)
      return res.status(400).json({ success: false, message: 'Phone number and PIN required' });

    const userResult = await client.query('SELECT * FROM users WHERE phone=$1 AND role=$2', [phone, 'STAFF']);
    if (userResult.rows.length === 0)
      return res.status(401).json({ success: false, message: 'Invalid phone or PIN' });

    const user = userResult.rows[0];
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);
    if (!pinMatch) return res.status(401).json({ success: false, message: 'Invalid phone or PIN' });

    const deviceInfo = getDeviceInfo(req);
    await client.query('UPDATE users SET last_login_at=NOW(), last_device=$1, is_online=true WHERE id=$2', [
      deviceInfo,
      user.id,
    ]);

    const token = generateToken({
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      phone: user.phone,
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
      },
    });
  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  } finally {
    client.release();
  }
};

/**
 * USER: Logout (mark offline)
 */
const logoutUser = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.user;
    await client.query('UPDATE users SET is_online=false WHERE id=$1', [id]);
    res.json({ success: true, message: 'User logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: 'Logout failed', error: error.message });
  } finally {
    client.release();
  }
};

module.exports = {
  registerOwner,
  loginOwner,
  verifyOTP,
  loginOwnerWithPIN,
  loginWithPIN,
  logoutUser,
};
