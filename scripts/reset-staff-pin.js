require('dotenv').config();
const { pool } = require('../src/config/db');
const bcrypt = require('bcrypt');

async function resetStaffPin() {
  const client = await pool.connect();
  
  try {
    const staffName = 'Alpha Degago';
    const newPin = '1234'; // Easy to remember test PIN
    
    // Hash the new PIN
    const pinHash = await bcrypt.hash(newPin, 10);
    
    // Update the staff PIN
    const result = await client.query(
      'UPDATE users SET pin_hash = $1 WHERE full_name = $2 AND role = $3 RETURNING id, full_name',
      [pinHash, staffName, 'STAFF']
    );
    
    if (result.rows.length > 0) {
      console.log(`\n✅ PIN reset successfully for: ${result.rows[0].full_name}`);
      console.log(`   New PIN: ${newPin}`);
      console.log(`\n📱 You can now login with:`);
      console.log(`   Staff Name: ${staffName}`);
      console.log(`   PIN: ${newPin}\n`);
    } else {
      console.log(`\n❌ Staff member "${staffName}" not found\n`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    process.exit();
  }
}

resetStaffPin();
