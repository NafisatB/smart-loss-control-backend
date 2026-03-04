require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL // e.g., postgresql://postgres:1256@localhost:5432/smartlossdb
});

async function seed() {
  const client = await pool.connect();

  const SHOP_NAME = 'Test Shop';
  const OWNER_PHONE = '+2348012345678';
  const USER_NAME = 'Alice';
  const USER_ROLE = 'OWNER';

  try {
    await client.query('BEGIN');

    // 1️⃣ Check if shop already exists
    let shopResult = await client.query(
      `SELECT id, shop_name FROM shops WHERE owner_phone = $1`,
      [OWNER_PHONE]
    );

    let shop;
    if (shopResult.rows.length > 0) {
      shop = shopResult.rows[0];
      console.log(`Shop already exists:`, shop);
    } else {
      // Create new shop
      shopResult = await client.query(
        `INSERT INTO shops (shop_name, owner_phone)
         VALUES ($1, $2)
         RETURNING id AS shop_id, shop_name`,
        [SHOP_NAME, OWNER_PHONE]
      );
      shop = shopResult.rows[0];
      console.log('Inserted new shop:', shop);
    }

    // 2️⃣ Check if user already exists
    const userCheck = await client.query(
      `SELECT id, full_name, role, shop_id FROM users
       WHERE full_name = $1 AND shop_id = $2`,
      [USER_NAME, shop.id]
    );

    if (userCheck.rows.length > 0) {
      console.log('User already exists:', userCheck.rows[0]);
    } else {
      // Insert new user
      const userResult = await client.query(
        `INSERT INTO users (full_name, role, shop_id)
         VALUES ($1, $2, $3)
         RETURNING id AS user_id, full_name, role, shop_id`,
        [USER_NAME, USER_ROLE, shop.id]
      );
      const user = userResult.rows[0];
      console.log('Inserted new user:', user);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding DB:', err);
  } finally {
    client.release();
    pool.end();
  }
}

seed();