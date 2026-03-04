require('dotenv').config();
const { pool } = require('../src/config/db');
const { v4: uuidv4 } = require('uuid');

async function seed() {
  const client = await pool.connect();

  try {
    console.log('🔄 Seeding shops, SKUs, inventory, and alerts...');

    // 1️⃣ Shops
    const shops = [
      { name: 'Owner Shop', owner_phone: '+254700000001' },
      { name: 'Staff Shop', owner_phone: '+254700000002' },
    ];

    for (const shop of shops) {
      const existing = await client.query(
        'SELECT id FROM shops WHERE owner_phone = $1',
        [shop.owner_phone]
      );

      if (existing.rows.length === 0) {
        shop.id = uuidv4();
        await client.query(
          'INSERT INTO shops (id, shop_name, owner_phone) VALUES ($1, $2, $3)',
          [shop.id, shop.name, shop.owner_phone]
        );
      } else {
        shop.id = existing.rows[0].id;
      }
    }

    // 2️⃣ SKUs
    const skus = [
      { brand: 'BrandA', size: '1L' },
      { brand: 'BrandB', size: '500ml' },
      { brand: 'BrandC', size: '2L' },
    ];

    for (const sku of skus) {
      const existing = await client.query(
        'SELECT id FROM skus WHERE brand = $1 AND size = $2',
        [sku.brand, sku.size]
      );

      if (existing.rows.length === 0) {
        sku.id = uuidv4();
        await client.query(
          'INSERT INTO skus (id, brand, size) VALUES ($1, $2, $3)',
          [sku.id, sku.brand, sku.size]
        );
      } else {
        sku.id = existing.rows[0].id;
      }
    }

    // 3️⃣ Inventory
    for (const shop of shops) {
      for (const sku of skus) {
        const exists = await client.query(
          'SELECT id FROM inventory WHERE shop_id = $1 AND sku_id = $2',
          [shop.id, sku.id]
        );

        if (exists.rows.length === 0) {
          await client.query(
            `INSERT INTO inventory 
             (shop_id, sku_id, quantity, cost_price, selling_price, updated_at) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [shop.id, sku.id, 50, 100, 150]
          );
        }
      }
    }

    // 4️⃣ Alerts
    for (const shop of shops) {
      for (const sku of skus) {
        const exists = await client.query(
          'SELECT id FROM alerts WHERE shop_id = $1 AND sku_id = $2 AND is_resolved = false',
          [shop.id, sku.id]
        );

        if (exists.rows.length === 0) {
          const alertId = uuidv4();
          const metadata = {
            expected_stock: 50,
            physical_count: 45,
            variance: 5,
            variance_percent: 10,
          };

          await client.query(
            `INSERT INTO alerts 
             (id, shop_id, sku_id, audit_log_id, deviation, estimated_loss, is_resolved, created_at, severity, type, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              alertId,
              shop.id,
              sku.id,
              null,                     // audit_log_id
              metadata.variance,        // deviation
              metadata.variance * 2,    // estimated_loss (numeric)
              false,                    // is_resolved
              new Date(),               // created_at
              'CRITICAL',               // severity
              'STOCK_ALERT',            // type
            ]
          );
        }
      }
    }

    console.log('✅ Seeding completed successfully!');
  } catch (error) {
    console.error('❌ Seeding error:', error.message);
  } finally {
    client.release();
    process.exit();
  }
}

seed();