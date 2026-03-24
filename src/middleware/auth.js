const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

// Verify JWT token
const authenticateJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'Authorization header missing'
    });
  }

  const token = authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token missing'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, shop_id, role, phone, name }

    // Optional: set shop context per request if needed for RLS
    if (decoded.shop_id) {
      const client = await pool.connect();
      try {
        await client.query('SELECT set_config($1, $2, false)', [
          'app.current_shop_id',
          decoded.shop_id
        ]);
      } finally {
        client.release();
      }
    }

    next();
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Check if user is OWNER
const requireOwner = (req, res, next) => {
  if (req.user.role !== 'OWNER') {
    return res.status(403).json({
      success: false,
      message: 'Owner access required'
    });
  }
  next();
};

// Check if user is STAFF
const requireStaff = (req, res, next) => {
  if (req.user.role !== 'STAFF') {
    return res.status(403).json({
      success: false,
      message: 'Staff access required'
    });
  }
  next();
};

module.exports = {
  authenticateJWT,
  requireOwner,
  requireStaff
};
