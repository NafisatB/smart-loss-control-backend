require('dotenv').config();
const { pool } = require('../src/config/db');

async function seedData() {
  const client = await pool.connect();
  
  try {
    console.log('🌱 Starting database seeding...\n');

    // Get shop and owner by phone number
    const ownerPhone = '+251912001511'; // The owner we want to seed data for
    const shopResult = await client.query(
      'SELECT id, shop_name, owner_phone FROM shops WHERE owner_phone = $1',
      [ownerPhone]
    );
    
    if (shopResult.rows.length === 0) {
      console.log(`❌ No shop found for phone ${ownerPhone}. Please register this owner first.`);
      return;
    }

    const shop = shopResult.rows[0];
    console.log(`✅ Found shop: ${shop.shop_name} (${shop.id})`);
    console.log(`   Owner phone: ${shop.owner_phone}\n`);

    const ownerResult = await client.query(
      'SELECT id FROM users WHERE shop_id = $1 AND role = $2',
      [shop.id, 'OWNER']
    );
    const ownerId = ownerResult.rows[0].id;

    // 1. Create SKUs (Products) - All 10 African Oil Brands (1L only for MVP)
    console.log('📦 Creating SKUs...');
    const skus = [
      { brand: "King's Oil", size: '1L' },
      { brand: 'Mamador', size: '1L' },
      { brand: 'Golden Terra', size: '1L' },
      { brand: 'Devon Kings', size: '1L' },
      { brand: 'Golden Penny', size: '1L' },
      { brand: 'Power Oil', size: '1L' },
      { brand: 'Gino', size: '1L' },
      { brand: 'Soya Gold', size: '1L' },
      { brand: 'Tropical', size: '1L' },
      { brand: 'Grand Pure', size: '1L' },
    ];

    const skuIds = [];
    for (const sku of skus) {
      // Check if SKU already exists
      const existing = await client.query(
        'SELECT id FROM skus WHERE brand = $1 AND size = $2',
        [sku.brand, sku.size]
      );
      
      if (existing.rows.length > 0) {
        skuIds.push({ ...sku, id: existing.rows[0].id });
        console.log(`   ✓ ${sku.brand} ${sku.size} already exists`);
      } else {
        const result = await client.query(
          `INSERT INTO skus (brand, size, is_carton, units_per_carton) 
           VALUES ($1, $2, $3, $4) 
           RETURNING id`,
          [sku.brand, sku.size, false, 1]
        );
        skuIds.push({ ...sku, id: result.rows[0].id });
        console.log(`   + Created ${sku.brand} ${sku.size}`);
      }
    }
    console.log(`✅ Ensured ${skuIds.length} SKUs exist\n`);

    // 2. Create Sample Inventory (optional - for demo purposes)
    console.log('📊 Creating sample inventory...');
    const inventoryData = [
      { sku: skuIds[0], quantity: 78, cost: 950, selling: 1100, reorder: 30 }, // King's 1L
      { sku: skuIds[1], quantity: 92, cost: 900, selling: 1050, reorder: 40 }, // Mamador 1L
      { sku: skuIds[2], quantity: 45, cost: 920, selling: 1080, reorder: 25 }, // Golden Terra 1L
      { sku: skuIds[3], quantity: 41, cost: 940, selling: 1100, reorder: 20 }, // Devon Kings 1L
      { sku: skuIds[4], quantity: 55, cost: 930, selling: 1090, reorder: 25 }, // Golden Penny 1L
      { sku: skuIds[5], quantity: 22, cost: 910, selling: 1070, reorder: 15 }, // Power Oil 1L
      { sku: skuIds[6], quantity: 38, cost: 900, selling: 1050, reorder: 20 }, // Gino 1L
      { sku: skuIds[7], quantity: 15, cost: 920, selling: 1080, reorder: 20 }, // Soya Gold 1L - LOW STOCK
      { sku: skuIds[8], quantity: 8, cost: 940, selling: 1100, reorder: 15 }, // Tropical 1L - LOW STOCK
      { sku: skuIds[9], quantity: 62, cost: 950, selling: 1110, reorder: 30 }, // Grand Pure 1L
    ];

    for (const inv of inventoryData) {
      await client.query(
        `INSERT INTO inventory (shop_id, sku_id, quantity, cost_price, selling_price, reorder_level, last_count_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (shop_id, sku_id) DO UPDATE 
         SET quantity = EXCLUDED.quantity, cost_price = EXCLUDED.cost_price, 
             selling_price = EXCLUDED.selling_price, reorder_level = EXCLUDED.reorder_level`,
        [shop.id, inv.sku.id, inv.quantity, inv.cost, inv.selling, inv.reorder]
      );
    }
    console.log(`✅ Created sample inventory for ${inventoryData.length} products\n`);

    // 3. Create Sales Transactions (last 7 days)
    console.log('💰 Creating sales transactions...');
    const salesCount = 50;
    for (let i = 0; i < salesCount; i++) {
      const randomSku = skuIds[Math.floor(Math.random() * skuIds.length)];
      const quantity = Math.floor(Math.random() * 5) + 1;
      const daysAgo = Math.floor(Math.random() * 7);
      const hoursAgo = Math.floor(Math.random() * 24);
      
      await client.query(
        `INSERT INTO transactions (shop_id, sku_id, type, quantity, device_id, occurred_at)
         VALUES ($1, $2, 'SALE', $3, $4, NOW() - INTERVAL '${daysAgo} days' - INTERVAL '${hoursAgo} hours')`,
        [shop.id, randomSku.id, quantity, 'SEED_DEVICE']
      );
    }
    console.log(`✅ Created ${salesCount} sales transactions\n`);

    // 4. Create Restocks
    console.log('📥 Creating restock records...');
    for (let i = 0; i < 5; i++) {
      const randomSku = skuIds[Math.floor(Math.random() * skuIds.length)];
      const randomInv = inventoryData.find(inv => inv.sku.id === randomSku.id);
      const orderedQty = Math.floor(Math.random() * 50) + 50;
      const receivedQty = orderedQty - Math.floor(Math.random() * 3); // Sometimes short
      const daysAgo = Math.floor(Math.random() * 14) + 1;
      
      await client.query(
        `INSERT INTO restocks (shop_id, sku_id, ordered_qty, received_qty, cost_price, selling_price, supplier_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '${daysAgo} days')`,
        [shop.id, randomSku.id, orderedQty, receivedQty, randomInv.cost, randomInv.selling, 'Lagos Distributors Ltd']
      );

      // Add transaction
      await client.query(
        `INSERT INTO transactions (shop_id, sku_id, type, quantity, device_id, occurred_at)
         VALUES ($1, $2, 'RESTOCK', $3, $4, NOW() - INTERVAL '${daysAgo} days')`,
        [shop.id, randomSku.id, receivedQty, 'SEED_DEVICE']
      );
    }
    console.log(`✅ Created 5 restock records\n`);

    // 5. Create Audit Logs (Spot Checks)
    console.log('🔍 Creating audit logs...');
    for (let i = 0; i < 10; i++) {
      const randomSku = skuIds[Math.floor(Math.random() * skuIds.length)];
      const randomInv = inventoryData.find(inv => inv.sku.id === randomSku.id);
      const expectedQty = randomInv.quantity;
      const actualQty = expectedQty + (Math.random() > 0.7 ? Math.floor(Math.random() * 5) - 2 : 0);
      const deviation = actualQty - expectedQty;
      const deviationPercent = expectedQty > 0 ? ((deviation / expectedQty) * 100).toFixed(2) : 0;
      const status = Math.abs(deviationPercent) <= 1 ? 'OK' : Math.abs(deviationPercent) <= 10 ? 'WARNING' : 'CRITICAL';
      const daysAgo = Math.floor(Math.random() * 7);
      
      await client.query(
        `INSERT INTO audit_logs (shop_id, user_id, sku_id, expected_qty, actual_qty, deviation, deviation_percent, loss_value_naira, trigger_type, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - INTERVAL '${daysAgo} days')`,
        [shop.id, ownerId, randomSku.id, expectedQty, actualQty, deviation, deviationPercent, Math.abs(deviation) * randomInv.selling, 'MANUAL', status]
      );
    }
    console.log(`✅ Created 10 audit logs\n`);

    // 6. Create Alerts (for critical deviations)
    console.log('🚨 Creating alerts...');
    const criticalAudits = await client.query(
      `SELECT id, sku_id, expected_qty, actual_qty, deviation, loss_value_naira 
       FROM audit_logs 
       WHERE shop_id = $1 AND status = 'CRITICAL' 
       LIMIT 3`,
      [shop.id]
    );

    for (const audit of criticalAudits.rows) {
      await client.query(
        `INSERT INTO alerts (shop_id, audit_log_id, sku_id, expected_qty, actual_qty, deviation, estimated_loss, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN')`,
        [shop.id, audit.id, audit.sku_id, audit.expected_qty, audit.actual_qty, audit.deviation, audit.loss_value_naira]
      );
    }
    console.log(`✅ Created ${criticalAudits.rows.length} alerts\n`);

    console.log('🎉 Database seeding completed successfully!\n');
    console.log('📊 Summary:');
    console.log(`   - ${skuIds.length} SKUs`);
    console.log(`   - ${inventoryData.length} Inventory items`);
    console.log(`   - ${salesCount} Sales transactions`);
    console.log(`   - 5 Restock records`);
    console.log(`   - 10 Audit logs`);
    console.log(`   - ${criticalAudits.rows.length} Alerts`);
    console.log('\n✅ You can now login and see data in the dashboard!\n');

  } catch (error) {
    console.error('❌ Seeding error:', error);
  } finally {
    client.release();
    process.exit();
  }
}

seedData();
