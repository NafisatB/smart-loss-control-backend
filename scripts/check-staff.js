require('dotenv').config();
const { pool } = require('../src/config/db');

async function checkStaff() {
  const client = await pool.connect();
  
  try {
    const ownerPhone = '+251912001511';
    
    // Get shop
    const shopResult = await client.query(
      'SELECT id, shop_name FROM shops WHERE owner_phone = $1',
      [ownerPhone]
    );
    
    if (shopResult.rows.length === 0) {
      console.log('❌ No shop found');
      return;
    }
    
    const shop = shopResult.rows[0];
    console.log(`\n✅ Shop: ${shop.shop_name} (${shop.id})\n`);
    
    // Get all users
    const usersResult = await client.query(
      'SELECT id, full_name, role, is_active, created_at FROM users WHERE shop_id = $1 ORDER BY role, created_at',
      [shop.id]
    );
    
    console.log('👥 Users:');
    console.log('─────────────────────────────────────────────────────');
    usersResult.rows.forEach(user => {
      console.log(`${user.role.padEnd(8)} | ${user.full_name.padEnd(20)} | Active: ${user.is_active}`);
    });
    console.log('─────────────────────────────────────────────────────\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    process.exit();
  }
}

checkStaff();
