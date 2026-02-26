require('dotenv').config();
const { pool } = require('../src/config/db');

async function checkInventory() {
  const client = await pool.connect();
  
  try {
    // Get shop by phone
    const shopResult = await client.query(
      'SELECT id, shop_name FROM shops WHERE owner_phone = $1',
      ['+251912001511']
    );
    
    if (shopResult.rows.length === 0) {
      console.log('❌ Shop not found');
      return;
    }
    
    const shop = shopResult.rows[0];
    console.log(`\n📊 Inventory for: ${shop.shop_name}\n`);
    
    const result = await client.query(
      `SELECT 
        i.id,
        s.brand,
        s.size,
        i.quantity,
        i.cost_price,
        i.selling_price,
        i.updated_at
       FROM inventory i
       JOIN skus s ON i.sku_id = s.id
       WHERE i.shop_id = $1 AND s.size = '1L'
       ORDER BY s.brand`,
      [shop.id]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ No inventory found\n');
    } else {
      result.rows.forEach((item, index) => {
        console.log(`${index + 1}. ${item.brand} ${item.size}`);
        console.log(`   Quantity: ${item.quantity} units`);
        console.log(`   Cost: $${item.cost_price} | Selling: $${item.selling_price}`);
        console.log(`   Updated: ${new Date(item.updated_at).toLocaleString()}`);
        console.log('');
      });
      console.log(`Total: ${result.rows.length} products in inventory\n`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    process.exit();
  }
}

checkInventory();
