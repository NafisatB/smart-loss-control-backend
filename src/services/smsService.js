const AfricasTalking = require('africastalking');

// Initialize Africa's Talking client
let atClient = null;
let smsService = null;

// Check if Africa's Talking is configured
const isAfricasTalkingConfigured = () => {
  return process.env.AT_API_KEY && 
         process.env.AT_USERNAME && 
         process.env.AT_API_KEY !== 'your_api_key_here';
};

// Check if in sandbox mode
const isSandboxMode = () => {
  return process.env.AT_SANDBOX === 'true' || process.env.NODE_ENV === 'development';
};

// Initialize Africa's Talking client if configured
if (isAfricasTalkingConfigured()) {
  try {
    atClient = AfricasTalking({
      apiKey: process.env.AT_API_KEY,
      username: process.env.AT_USERNAME
    });
    
    smsService = atClient.SMS;
    
    const mode = isSandboxMode() ? 'SANDBOX' : 'PRODUCTION';
    console.log(`✅ Africa's Talking SMS service initialized (${mode} mode)`);
    console.log(`   Username: ${process.env.AT_USERNAME}`);
    
  } catch (error) {
    console.error('❌ Africa\'s Talking initialization failed:', error.message);
  }
} else {
  console.log('⚠️  Africa\'s Talking not configured - using development mode (console logging)');
  console.log('   Set AT_API_KEY and AT_USERNAME in .env to enable SMS');
}

/**
 * Send OTP via Africa's Talking SMS
 * @param {string} phoneNumber - Recipient phone number (e.g., +254712345678)
 * @param {string} otp - 4-digit OTP code
 * @returns {Promise<Object>} - Success/failure result
 */
async function sendOTP(phoneNumber, otp) {
  const message = `Your Smart Loss Control verification code is: ${otp}. Valid for 5 minutes. Do not share this code.`;
  
  // Development mode - log to console
  if (!isAfricasTalkingConfigured()) {
    console.log(`📱 OTP (DEV MODE) to ${phoneNumber}: ${otp}`);
    return {
      success: true,
      mode: 'development',
      channel: 'console',
      message: 'OTP logged to console (development mode)',
      messageId: 'dev_' + Date.now()
    };
  }

  // Send via Africa's Talking
  try {
    const options = {
      to: [phoneNumber],
      message: message
    };
    
    // Only add 'from' if sender ID is configured
    if (process.env.AT_SENDER_ID) {
      options.from = process.env.AT_SENDER_ID;
    }

    const result = await smsService.send(options);
    
    // Africa's Talking returns an array of recipients
    const recipient = result.SMSMessageData.Recipients[0];
    
    if (recipient.status === 'Success' || recipient.statusCode === 101) {
      const mode = isSandboxMode() ? 'sandbox' : 'production';
      console.log(`✅ SMS OTP sent to ${phoneNumber} (${mode}), MessageId: ${recipient.messageId}`);
      
      return {
        success: true,
        mode: mode,
        channel: 'sms',
        message: `OTP sent via Africa's Talking SMS (${mode})`,
        messageId: recipient.messageId,
        status: recipient.status,
        statusCode: recipient.statusCode,
        cost: recipient.cost || 'N/A'
      };
    } else {
      console.error(`❌ SMS OTP failed for ${phoneNumber}:`, recipient.status);
      return fallbackToConsole(phoneNumber, otp, recipient.status);
    }

  } catch (error) {
    console.error('❌ Africa\'s Talking SMS error:', error.message);
    return fallbackToConsole(phoneNumber, otp, error.message);
  }
}

/**
 * Fallback to console logging when SMS fails
 */
function fallbackToConsole(phoneNumber, otp, errorReason = 'Unknown error') {
  console.log(`📱 FALLBACK OTP to ${phoneNumber}: ${otp}`);
  console.log(`   Reason: ${errorReason}`);
  
  return {
    success: false,
    mode: 'fallback',
    channel: 'console',
    message: 'SMS failed, OTP logged to console',
    fallback_otp: otp,
    error: errorReason
  };
}

/**
 * Send notification via Africa's Talking SMS (for alerts, etc.)
 * @param {string} phoneNumber - Recipient phone number
 * @param {string} message - Message content
 * @returns {Promise<Object>} - Success/failure result
 */
async function sendNotification(phoneNumber, message) {
  // Development mode - log to console
  if (!isAfricasTalkingConfigured()) {
    console.log(`📱 NOTIFICATION (DEV MODE) to ${phoneNumber}: ${message}`);
    return {
      success: true,
      mode: 'development',
      channel: 'console',
      message: 'Notification logged to console'
    };
  }

  // Send via Africa's Talking
  try {
    const options = {
      to: [phoneNumber],
      message: message
    };
    
    // Only add 'from' if sender ID is configured
    if (process.env.AT_SENDER_ID) {
      options.from = process.env.AT_SENDER_ID;
    }

    const result = await smsService.send(options);
    const recipient = result.SMSMessageData.Recipients[0];
    
    if (recipient.status === 'Success' || recipient.statusCode === 101) {
      const mode = isSandboxMode() ? 'sandbox' : 'production';
      console.log(`✅ SMS notification sent to ${phoneNumber} (${mode}), MessageId: ${recipient.messageId}`);
      
      return {
        success: true,
        mode: mode,
        channel: 'sms',
        message: `Notification sent via Africa's Talking SMS (${mode})`,
        messageId: recipient.messageId,
        status: recipient.status,
        cost: recipient.cost || 'N/A'
      };
    } else {
      console.error(`❌ SMS notification failed for ${phoneNumber}:`, recipient.status);
      
      return {
        success: false,
        mode: 'error',
        channel: 'sms',
        message: 'SMS notification failed',
        error: recipient.status
      };
    }

  } catch (error) {
    console.error('❌ Africa\'s Talking notification error:', error.message);
    
    return {
      success: false,
      mode: 'error',
      channel: 'sms',
      message: 'SMS notification failed',
      error: error.message
    };
  }
}

/**
 * Get messaging service status
 * @returns {Object} - Service configuration status
 */
function getServiceStatus() {
  return {
    configured: isAfricasTalkingConfigured(),
    mode: isAfricasTalkingConfigured() ? 
      (isSandboxMode() ? 'sandbox' : 'production') : 'development',
    provider: 'Africa\'s Talking',
    username: process.env.AT_USERNAME || 'not_configured',
    sandbox: isSandboxMode(),
    sender_id: process.env.AT_SENDER_ID || 'default',
    api_key_set: !!process.env.AT_API_KEY,
    supported_countries: [
      'Kenya (+254)',
      'Nigeria (+234)', 
      'Uganda (+256)',
      'Tanzania (+255)',
      'Rwanda (+250)',
      'Malawi (+265)',
      'South Africa (+27)',
      'and more...'
    ]
  };
}

/**
 * Check if Africa's Talking is configured
 * @returns {boolean}
 */
function isConfigured() {
  return isAfricasTalkingConfigured();
}

module.exports = {
  sendOTP,
  sendNotification,
  getServiceStatus,
  isConfigured,
  isSandboxMode
};
