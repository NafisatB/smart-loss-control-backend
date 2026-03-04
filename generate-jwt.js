// generate-jwt.js
require('dotenv').config();   // loads .env variables
const jwt = require('jsonwebtoken');

const payload = {
  id: 'b30457cf-923f-4628-bce2-1ac92ce9e188',       // pick an existing user ID from your DB
  shop_id: '73f28782-bfa7-40d2-af81-12f7e8d589c0',  // pick the shop ID
  role: 'OWNER',            // or STAFF
  full_name: 'Alice'
};

const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
console.log('Your test JWT token:\n', token);