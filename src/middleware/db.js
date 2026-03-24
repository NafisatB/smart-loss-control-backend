const { pool } = require('../config/db');

const attachDBWithRLS = async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      'SELECT set_config($1, $2, true)',
      ['app.current_shop_id', req.user.shop_id]
    );

    req.db = client;

    next();
  } catch (err) {
    client.release();
    next(err);
  }
};

// ✅ EXPORT MUST BE OUTSIDE
module.exports = {
  attachDBWithRLS
};