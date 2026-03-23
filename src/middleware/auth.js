const jwt = require('jsonwebtoken');

// Verify JWT token
const authenticateJWT = (req, res, next) => {
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
    console.log('DECODED TOKEN:', decoded);
    req.user = decoded; // { id, shop_id, role, phone/name }
    next();
  } catch (error) {
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }
};

// Check if user is owner
const requireOwner = (req, res, next) => {
  if (req.user.role !== 'OWNER') {
    return res.status(403).json({ 
      success: false, 
      message: 'Owner access required' 
    });
  }
  next();
};

// Check if user is staff
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
