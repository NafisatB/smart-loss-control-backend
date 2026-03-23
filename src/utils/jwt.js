const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Generate JWT token
// auth/utils.js
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      shop_id: user.shop_id,
      role: user.role,
      phone: user.phone,
      name: user.name
    },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  )
}

// Generate OTP (4-digit, cryptographically secure)
const generateOTP = () => {
  return crypto.randomInt(1000, 9999).toString();
};

module.exports = { 
  generateToken, 
  generateOTP 
};