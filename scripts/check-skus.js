require('dotenv').config();
const { pool } = require('../src/config/db');

async function checkSKUs() {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      `SELECT id, brand, size, is_active 
       FROM skus 
       WHERE size = '1L' 
       ORDER BY brand`
    );
    
    console.log('\n📦 SKUs in database (1L only):\n');
    result.rows.forEach((sku, index) => {
      console.log(`${index + 1}. ${sku.brand} ${sku.size} - ${sku.is_active ? '✅ Active' : '❌ Inactive'}`);
      console.log(`   ID: ${sku.id}`);
    });
    console.log(`\nTotal: ${result.rows.length} SKUs\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    process.exit();
  }
}

checkSKUs();
