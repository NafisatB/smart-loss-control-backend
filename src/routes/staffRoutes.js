const express = require('express')
const router = express.Router()
const { getMyStaffInfo } = require('../controllers/staffController')
const { authenticateJWT } = require('../middleware/auth')

router.get('/me', authenticateJWT, getMyStaffInfo)

module.exports = router