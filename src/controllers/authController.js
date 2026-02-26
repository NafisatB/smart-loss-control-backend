const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { generateToken, generateOTP } = require('../utils/jwt');
const { sendOTP } = require('../services/smsService');

// Owner Registration (NEW OWNERS ONLY - Step 1: Send OTP)
const registerOwner = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { full_name, shop_name, phone } = req.body;

    // Validation - ALL fields required for registration
    if (!phone || !full_name || !shop_name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number, full name, and shop name are required for registration' 
      });
    }

    // SECURITY: Check if phone is already registered as OWNER
    const existingOwner = await client.query(
      'SELECT u.id, u.full_name, u.pin_hash FROM users u WHERE u.phone = $1 AND u.role = $2',
      [phone, 'OWNER']
    );

    if (existingOwner.rows.length > 0) {
      const owner = existingOwner.rows[0];
      
      // If owner exists but has NO PIN, allow them to complete registration
      if (!owner.pin_hash) {
        console.log(`[REGISTRATION] Owner exists without PIN, allowing OTP for completion: ${phone}`);
        
        // Generate OTP
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        // Store OTP (reuse existing flow)
        await client.query(
          `INSERT INTO otp_verifications (phone, otp_code, expires_at, full_name, shop_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [phone, otp, expiresAt, full_name, shop_name]
        );

        // Send OTP
        const smsResult = await sendOTP(phone, otp);

        return res.status(200).json({
          success: true,
          message: `OTP sent to ${phone}. Complete your registration by setting a PIN.`,
          dev_otp: process.env.NODE_ENV === 'development' ? otp : undefined,
          sms_status: smsResult.status,
          sms_sid: smsResult.sid,
          sms_error: smsResult.error,
          registration_incomplete: true // Flag to frontend
        });
      }
      
      // Owner exists with PIN - they should login instead
      return res.status(409).json({ 
        success: false, 
        message: 'This phone number is already registered. Please use the login endpoint instead.' 
      });
    }

    // SECURITY: Check if phone is already used in shops table (owner_phone)
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

    // SECURITY: Check if phone is used by any user (OWNER or STAFF) in any shop
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

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP with registration data (user will be created AFTER OTP verification)
    await client.query(
      'INSERT INTO otp_verifications (phone, otp_code, expires_at, full_name, shop_name) VALUES ($1, $2, $3, $4, $5)',
      [phone, otp, expiresAt, full_name, shop_name]
    );

    console.log(`[SECURITY] Registration initiated for: ${full_name}, phone: ${phone}, shop: ${shop_name} (awaiting OTP verification)`);

    // Send OTP via SMS
    const smsResult = await sendOTP(phone, otp);
    
    // Response based on SMS result
    const response = {
      success: true,
      message: `Registration successful! OTP sent to ${phone}`,
      sms_status: smsResult.mode
    };

    // Include SMS details for debugging (but NOT the OTP itself)
    if (smsResult.mode === 'production' || smsResult.mode === 'sandbox') {
      if (smsResult.messageId) {
        response.message_id = smsResult.messageId;
      }
    } else if (smsResult.mode === 'fallback') {
      response.sms_error = smsResult.error;
      response.fallback_note = 'SMS failed, check Africa\'s Talking dashboard or server console';
    }

    res.status(201).json(response);

  } catch (error) {
    console.error('Register owner error:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'shops_owner_phone_key') {
        return res.status(409).json({ 
          success: false, 
          message: 'This phone number is already registered to another shop' 
        });
      }
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

// Owner Login (EXISTING OWNERS - Step 1: Send OTP)
const loginOwner = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { phone } = req.body;

    // Validation - only phone required for login
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }

    // Check if owner exists
    const existingOwner = await client.query(
      'SELECT u.id, u.full_name, u.shop_id, s.shop_name FROM users u JOIN shops s ON u.shop_id = s.id WHERE u.phone = $1 AND u.role = $2',
      [phone, 'OWNER']
    );

    if (existingOwner.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No account found with this phone number. Please register first.' 
      });
    }

    const owner = existingOwner.rows[0];
    console.log(`[SECURITY] Owner login: ${owner.full_name} (${owner.shop_name}) requesting OTP for phone ${phone}`);

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP
    await client.query(
      'INSERT INTO otp_verifications (phone, otp_code, expires_at) VALUES ($1, $2, $3)',
      [phone, otp, expiresAt]
    );

    // Send OTP via SMS
    const smsResult = await sendOTP(phone, otp);
    
    // Response based on SMS result
    const response = {
      success: true,
      message: `OTP sent to ${phone}`,
      owner_name: owner.full_name,
      shop_name: owner.shop_name,
      sms_status: smsResult.mode
    };

    // Include OTP in development mode or if SMS failed
    if (process.env.NODE_ENV === 'development' || !smsResult.success) {
      response.dev_otp = otp;
    }

    // Include SMS details for debugging
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

// Owner OTP Verification (Step 2: Verify and Login)
const verifyOTP = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { phone, otp } = req.body;

    // Validation
    if (!phone || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone and OTP are required' 
      });
    }

    // Security: Check for too many failed attempts (rate limiting)
    const recentAttempts = await client.query(
      `SELECT COUNT(*) as attempt_count 
       FROM otp_verifications 
       WHERE phone = $1 
       AND created_at > NOW() - INTERVAL '15 minutes'`,
      [phone]
    );

    if (parseInt(recentAttempts.rows[0].attempt_count) > 5) {
      return res.status(429).json({ 
        success: false, 
        message: 'Too many OTP requests. Please wait 15 minutes and try again.' 
      });
    }

    // Check OTP
    const otpResult = await client.query(
      `SELECT * FROM otp_verifications 
       WHERE phone = $1 AND otp_code = $2 AND is_verified = false 
       AND expires_at > NOW() 
       ORDER BY created_at DESC LIMIT 1`,
      [phone, otp]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or expired OTP' 
      });
    }

    const otpRecord = otpResult.rows[0];

    // Mark OTP as verified
    await client.query(
      'UPDATE otp_verifications SET is_verified = true WHERE id = $1',
      [otpRecord.id]
    );

    // Check if user already exists (for existing owners using login-owner flow)
    let userResult = await client.query(
      'SELECT id, shop_id, full_name, phone, role FROM users WHERE phone = $1 AND role = $2',
      [phone, 'OWNER']
    );

    let user;

    if (userResult.rows.length === 0) {
      // NEW REGISTRATION: Create shop and user now (after OTP verification)
      if (!otpRecord.full_name || !otpRecord.shop_name) {
        return res.status(400).json({
          success: false,
          message: 'Registration data not found. Please register again.'
        });
      }

      // Create shop
      const shopResult = await client.query(
        'INSERT INTO shops (shop_name, owner_phone) VALUES ($1, $2) RETURNING id',
        [otpRecord.shop_name, phone]
      );
      const shopId = shopResult.rows[0].id;

      // Create owner user
      const newUserResult = await client.query(
        'INSERT INTO users (shop_id, full_name, phone, role) VALUES ($1, $2, $3, $4) RETURNING id, shop_id, full_name, phone, role',
        [shopId, otpRecord.full_name, phone, 'OWNER']
      );

      user = newUserResult.rows[0];
      console.log(`[SECURITY] New owner created after OTP verification: ${user.full_name}, phone: ${phone}, shop: ${otpRecord.shop_name}`);
    } else {
      // EXISTING OWNER: Using login-owner flow
      user = userResult.rows[0];
      console.log(`[SECURITY] Existing owner verified OTP: ${user.full_name}, phone: ${phone}`);
    }

    // Update last login
    await client.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate JWT token
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
        role: user.role
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

// Set PIN for Owner (Step 3: After OTP verification during registration)
const setPIN = async (req, res) => {
  const client = await pool.connect();

  try {
    // Get user from JWT token (set by authenticateJWT middleware)
    const { id: user_id, phone, role } = req.user;
    const { pin } = req.body;

    console.log('[SET-PIN] Request from user:', { user_id, phone, role, pin: pin ? '****' : 'missing' });

    // Validation
    if (!pin) {
      return res.status(400).json({
        success: false,
        message: 'PIN is required'
      });
    }

    // Validate PIN format: exactly 4 digits
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits (0-9)'
      });
    }

    // Verify user is an OWNER
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can set PIN through this endpoint'
      });
    }

    // Check if user exists and get current PIN status
    const userResult = await client.query(
      'SELECT id, shop_id, full_name, phone, role, pin_hash FROM users WHERE id = $1 AND role = $2',
      [user_id, 'OWNER']
    );

    if (userResult.rows.length === 0) {
      console.log('[SET-PIN] User not found:', user_id);
      return res.status(404).json({
        success: false,
        message: 'Owner not found.'
      });
    }

    const user = userResult.rows[0];
    console.log('[SET-PIN] User found:', { id: user.id, phone: user.phone, has_pin: !!user.pin_hash });

    // Check if PIN is already set
    if (user.pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'PIN already set. Use the PIN reset endpoint to change it.'
      });
    }

    // If PIN is not set, allow setting it even without recent OTP verification
    // This handles the case where user registered, verified OTP, but didn't set PIN
    // They can come back later and set PIN using their token
    console.log('[SET-PIN] PIN not set yet, allowing user to set PIN');

    // Hash the PIN
    const saltRounds = 10;
    const pinHash = await bcrypt.hash(pin, saltRounds);

    // Store the PIN hash
    await client.query(
      'UPDATE users SET pin_hash = $1 WHERE id = $2',
      [pinHash, user.id]
    );

    console.log(`[SECURITY] PIN set for owner: ${user.full_name}, phone: ${phone}`);

    // Update last login
    await client.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate JWT token
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

// Owner PIN Login (Daily login with phone + PIN)
const loginOwnerWithPIN = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { phone, pin } = req.body;

    // Validation
    if (!phone || !pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone and PIN are required' 
      });
    }

    // Validate PIN format (4 digits)
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ 
        success: false, 
        message: 'PIN must be exactly 4 digits' 
      });
    }

    // Get owner user
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

    // Check if active
    if (!user.is_active) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account is deactivated' 
      });
    }

    // Check if PIN is set
    if (!user.pin_hash) {
      return res.status(400).json({ 
        success: false, 
        message: 'PIN not set. Please complete registration by setting your PIN.' 
      });
    }

    // Verify PIN
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);

    if (!pinMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid phone or PIN' 
      });
    }

    // Update last login
    await client.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    console.log(`[SECURITY] Owner logged in with PIN: ${user.full_name}, phone: ${phone}`);

    // Generate JWT token
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
        role: user.role
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

// Staff PIN Login
const loginWithPIN = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { phone, pin } = req.body;

    // Validation
    if (!phone || !pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number and PIN are required' 
      });
    }

    // Validate PIN format (4 digits)
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ 
        success: false, 
        message: 'PIN must be exactly 4 digits' 
      });
    }

    // Get staff user by phone
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

    // Check if active
    if (!user.is_active) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account is deactivated' 
      });
    }

    // Verify PIN
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);

    if (!pinMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid phone number or PIN' 
      });
    }

    // Update last login
    await client.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    console.log(`[SECURITY] Staff logged in: ${user.full_name}, phone: ${phone}`);

    // Generate JWT token
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
        role: user.role
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

// Get Staff Name by Phone (for login flow)
const getStaffByPhone = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { phone } = req.body;

    // Validation
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }

    // Get staff user by phone
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

    // Check if active
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

// Staff Link (QR Code Onboarding)
const linkStaff = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { qr_token, device_id, staff_name, phone, pin } = req.body;

    // Validation
    if (!qr_token || !device_id || !staff_name || !phone || !pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required (QR token, device ID, name, phone, PIN)' 
      });
    }

    // Validate PIN format
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ 
        success: false, 
        message: 'PIN must be exactly 4 digits' 
      });
    }

    // Verify QR code
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

    // Check if staff name already exists in this shop
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

    // Check if phone number already exists in this shop
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

    // Hash PIN
    const pinHash = await bcrypt.hash(pin, 10);

    // Create staff user with phone
    const userResult = await client.query(
      `INSERT INTO users (shop_id, full_name, phone, role, pin_hash) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, shop_id, full_name, phone, role`,
      [shopId, staff_name, phone, 'STAFF', pinHash]
    );

    const user = userResult.rows[0];

    // Link device
    await client.query(
      'INSERT INTO devices (user_id, device_id) VALUES ($1, $2)',
      [user.id, device_id]
    );

    // Mark QR code as used
    await client.query(
      'UPDATE qr_codes SET is_used = true WHERE id = $1',
      [qrCode.id]
    );

    console.log(`[SECURITY] Staff linked: ${user.full_name}, phone: ${phone}, shop_id: ${shopId}`);

    // Generate JWT token
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
        device_id: device_id,
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

// Generate QR Code for Staff Onboarding (Owner only)
const generateQRCode = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;

    // Only owners can generate QR codes
    if (role !== 'OWNER') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only shop owners can generate QR codes' 
      });
    }

    // Generate unique QR token
    const qrToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Store QR code in database
    const qrResult = await client.query(
      `INSERT INTO qr_codes (shop_id, code, expires_at) 
       VALUES ($1, $2, $3) 
       RETURNING id, code, expires_at`,
      [shop_id, qrToken, expiresAt]
    );

    const qrCode = qrResult.rows[0];

    // Calculate remaining time
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

// Check QR Code Status (Public endpoint for countdown)
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

    // Get QR code details
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

    // Check if expired
    const isExpired = remainingMs <= 0;
    const isUsed = qrCode.is_used;

    let status = 'active';
    if (isUsed) status = 'used';
    else if (isExpired) status = 'expired';

    // Calculate remaining time
    const remainingHours = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60)));
    const remainingMinutes = Math.max(0, Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60)));
    const remainingSeconds = Math.max(0, Math.floor((remainingMs % (1000 * 60)) / 1000));

    res.json({
      success: true,
      qr_status: {
        token: qrCode.code,
        status: status,
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
      message: status === 'active' 
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

// SMS Service Status (Development endpoint)
const getSMSStatus = async (req, res) => {
  const { getServiceStatus } = require('../services/smsService');
  
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

/**
 * Validate QR Code
 * Checks if QR code is valid and not expired
 * Public endpoint - no authentication required
 */
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

    // Check if QR code exists and is valid
    const qrResult = await client.query(
      `SELECT * FROM qr_codes 
       WHERE code = $1`,
      [qr_token]
    );

    if (qrResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid QR code' 
      });
    }

    const qrCode = qrResult.rows[0];

    // Check if already used
    if (qrCode.is_used) {
      return res.status(400).json({ 
        success: false, 
        message: 'QR code has already been used' 
      });
    }

    // Check if expired
    if (new Date(qrCode.expires_at) < new Date()) {
      return res.status(400).json({ 
        success: false, 
        message: 'QR code has expired. Please ask your manager for a new one.' 
      });
    }

    // QR code is valid
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

module.exports = {
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
};
