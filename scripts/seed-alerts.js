// seed-alerts.js
require('dotenv').config();
const { pool } = require('./src/config/db'); // adjust path if different
const { v4: uuidv4 } = require('uuid');

async function seedAlerts() {
  const client = await pool.connect();

  try {
    // Replace these with actual IDs from your DB
    const shop_id = '73f28782-bfa7-40d2-af81-12f7e8d589c0'; // your shop id
    const sku_id = 'f1e2d3c4-b5a6-7890-1234-56789abcdef0';   // a valid sku id

    const alerts = [
      {
        type: 'STOCK_VARIANCE',
        severity: 'CRITICAL',
        estimated_loss: 10000,
        metadata: { message: 'Stock variance alert', expected_stock: 100, physical_count: 80 },
        is_resolved: false
      },
      {
        type: 'STOCK_VARIANCE',
        severity: 'WARNING',
        estimated_loss: 5000,
        metadata: { message: 'Low stock alert', expected_stock: 50, physical_count: 45 },
        is_resolved: false
      },
      {
        type: 'STOCK_VARIANCE',
        severity: 'MINOR',
        estimated_loss: 2000,
        metadata: { message: 'Minor variance', expected_stock: 30, physical_count: 29 },
        is_resolved: true
      }
    ];

    for (const alert of alerts) {
      await client.query(
        `INSERT INTO alerts 
          (id, sku_id, shop_id, type, severity, estimated_loss, metadata, is_resolved, created_at) 
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [uuidv4(), sku_id, shop_id, alert.type, alert.severity, alert.estimated_loss, alert.metadata, alert.is_resolved]
      );
    }

    console.log('✅ Seeded alerts successfully!');
  } catch (error) {
    console.error('Failed to seed alerts:', error);
  } finally {
    client.release();
    pool.end();
  }
}

seedAlerts();