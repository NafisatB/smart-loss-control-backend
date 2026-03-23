// src/controllers/authController.js
require('dotenv').config();
const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Helper to generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { user_id: user.id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Helper to hash PIN
const hashPIN = async (pin) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(pin, salt);
};

// ====================== OWNER ======================

// Send OTP for owner registration/login
const sendOwnerOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    // Check if phone already exists
    const existing = await pool.query(
      'SELECT * FROM users WHERE phone = $1 OR phone = $2',
      [phone, phone]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Phone already registered' });
    }

    // Generate OTP
    const otp = Math.floor(1000 + Math.random() * 9000);

    // Store OTP in DB
    await pool.query(
      'INSERT INTO otp_verifications (phone, otp, verified, created_at) VALUES ($1, $2, $3, NOW())',
      [phone, otp, false]
    );

    // TODO: integrate SMS API here
    console.log(`OTP for ${phone}: ${otp}`);

    res.json({ message: 'OTP sent successfully', phone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Verify Owner OTP
const verifyOwnerOTP = async (req, res) => {
  try {
    const { phone, otp, full_name, shop_name } = req.body;

    // Check OTP
    const otpEntry = await pool.query(
      'SELECT * FROM otp_verifications WHERE phone = $1 ORDER BY created_at DESC LIMIT 1',
      [phone]
    );

    if (!otpEntry.rows.length || otpEntry.rows[0].verified) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    if (otpEntry.rows[0].otp !== otp) {
      return res.status(400).json({ message: 'OTP mismatch' });
    }

    // Mark OTP as verified
    await pool.query(
      'UPDATE otp_verifications SET verified = true WHERE id = $1',
      [otpEntry.rows[0].id]
    );

    // Create owner and shop if new
    const owner = await pool.query(
      'INSERT INTO users (id, full_name, phone, role, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [uuidv4(), full_name, phone, 'owner']
    );

    const shop = await pool.query(
      'INSERT INTO shops (id, owner_id, shop_name, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [uuidv4(), owner.rows[0].id, shop_name]
    );

    res.json({
      message: 'Owner registered successfully',
      owner: owner.rows[0],
      shop: shop.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Set Owner PIN
const setOwnerPIN = async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ message: 'PIN must be 4 digits' });
    }

    const hashed = await hashPIN(pin);

    const owner = await pool.query(
      'UPDATE users SET pin = $1, last_login_device = $2 WHERE phone = $3 RETURNING *',
      [hashed, req.headers['user-agent'], phone]
    );

    res.json({ message: 'PIN set successfully', owner: owner.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Owner login with PIN
const ownerLogin = async (req, res) => {
  try {
    const { phone, pin } = req.body;

    const ownerRes = await pool.query(
      'SELECT * FROM users WHERE phone = $1 AND role = $2',
      [phone, 'owner']
    );

    const owner = ownerRes.rows[0];

    if (!owner || !owner.pin) {
      return res.status(401).json({ message: 'PIN not set or invalid' });
    }

    const match = await bcrypt.compare(pin, owner.pin);
    if (!match) return res.status(401).json({ message: 'Incorrect PIN' });

    // Update last device
    await pool.query(
      'UPDATE users SET last_login_device = $1 WHERE id = $2',
      [req.headers['user-agent'], owner.id]
    );

    const token = generateToken(owner);

    res.json({ message: 'Login successful', token, owner });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ====================== STAFF ======================

// Staff login with PIN
const staffLogin = async (req, res) => {
  try {
    const { phone, pin } = req.body;

    const staffRes = await pool.query(
      'SELECT * FROM users WHERE phone = $1 AND role = $2 AND is_active = true',
      [phone, 'staff']
    );

    const staff = staffRes.rows[0];
    if (!staff || !staff.pin) return res.status(401).json({ message: 'Invalid PIN' });

    const match = await bcrypt.compare(pin, staff.pin);
    if (!match) return res.status(401).json({ message: 'Incorrect PIN' });

    await pool.query(
      'UPDATE users SET last_login_device = $1 WHERE id = $2',
      [req.headers['user-agent'], staff.id]
    );

    const token = generateToken(staff);

    res.json({ message: 'Staff login successful', token, staff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Export all controller functions
module.exports = {
  sendOwnerOTP,
  verifyOwnerOTP,
  setOwnerPIN,
  ownerLogin,
  staffLogin
};