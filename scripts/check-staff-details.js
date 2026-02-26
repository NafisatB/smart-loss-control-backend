require('dotenv').config();
const { pool } = require('../src/config/db');

async function checkStaffDetails() {
  const client = await pool.connect();
  
  try {
    const ownerPhone = '+251912001511';
    
    // Get shop
    const shopResult = await client.query(
      'SELECT id FROM shops WHERE owner_phone = $1',
      [ownerPhone]
    );
    
    const shop = shopResult.rows[0];
    
    // Get staff details with device info
    const staffResult = await client.query(
      `SELECT u.id, u.full_name, u.phone, u.pin_hash, u.is_active, u.created_at,
              d.device_id, d.is_whitelisted, d.linked_at
       FROM users u
       LEFT JOIN devices d ON u.id = d.user_id
       WHERE u.shop_id = $1 AND u.role = 'STAFF'`,
      [shop.id]
    );
    
    console.log('\n👥 Staff Members:\n');
    staffResult.rows.forEach(staff => {
      console.log(`Name: ${staff.full_name}`);
      console.log(`Phone: ${staff.phone || 'N/A'}`);
      console.log(`Device ID: ${staff.device_id || 'NOT LINKED'}`);
      console.log(`Device Linked: ${staff.linked_at ? new Date(staff.linked_at).toLocaleString() : 'NO'}`);
      console.log(`Has PIN: ${staff.pin_hash ? 'YES' : 'NO'}`);
      console.log(`Active: ${staff.is_active}`);
      console.log(`Created: ${new Date(staff.created_at).toLocaleString()}`);
      console.log('─────────────────────────────────────────────────────\n');
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    process.exit();
  }
}

checkStaffDetails();
