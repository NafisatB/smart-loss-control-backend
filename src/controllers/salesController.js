const { pool } = require('../config/db');

// Sync Offline Sales (Bulk Upload)
const syncSales = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, id: user_id } = req.user;
    const { device_id, sales } = req.body;

    // Validation
    if (!device_id || !sales || !Array.isArray(sales)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: device_id, sales (array)'
      });
    }

    if (sales.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Sales array cannot be empty'
      });
    }

    // Start transaction
    await client.query('BEGIN');

    let accepted = 0;
    let duplicates_ignored = 0;
    let errors = [];

    for (const sale of sales) {
      try {
        const { sale_id, sku_id, quantity, unit_price, sold_at } = sale;

        // Validate required fields
        if (!sale_id || !sku_id || !quantity || !unit_price || !sold_at) {
          errors.push(`Sale missing required fields: ${JSON.stringify(sale)}`);
          continue;
        }

        // Validate data types
        if (quantity <= 0 || unit_price <= 0) {
          errors.push(`Invalid quantity or price in sale: ${sale_id}`);
          continue;
        }

        // Check for duplicate sale_id (idempotent sync)
        const existingSale = await client.query(
          'SELECT id FROM transactions WHERE meta->\'sale_id\' = $1 AND shop_id = $2',
          [sale_id, shop_id]
        );

        if (existingSale.rows.length > 0) {
          duplicates_ignored++;
          continue;
        }

        // Verify SKU exists and get current inventory
        const inventoryResult = await client.query(
          'SELECT quantity FROM inventory WHERE shop_id = $1 AND sku_id = $2',
          [shop_id, sku_id]
        );

        if (inventoryResult.rows.length === 0) {
          errors.push(`SKU not found in inventory: ${sku_id}`);
          continue;
        }

        const currentStock = inventoryResult.rows[0].quantity;

        // Check if enough stock available
        if (currentStock < quantity) {
          errors.push(`Insufficient stock for sale ${sale_id}. Available: ${currentStock}, Requested: ${quantity}`);
          continue;
        }

        // Update inventory (reduce stock)
        await client.query(
          `UPDATE inventory 
           SET quantity = quantity - $1, updated_at = NOW()
           WHERE shop_id = $2 AND sku_id = $3`,
          [quantity, shop_id, sku_id]
        );

        // Record transaction
        await client.query(
          `INSERT INTO transactions 
            (shop_id, sku_id, type, quantity, user_id, occurred_at, device_id, meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            shop_id,
            sku_id,
            'SALE',
            -quantity, // Negative for sales (stock reduction)
            user_id,
            sold_at,
            device_id,
            JSON.stringify({
              sale_id,
              unit_price,
              total_amount: quantity * unit_price,
              synced_at: new Date().toISOString()
            })
          ]
        );

        accepted++;

      } catch (saleError) {
        console.error(`Error processing sale ${sale.sale_id}:`, saleError);
        errors.push(`Failed to process sale ${sale.sale_id}: ${saleError.message}`);
      }
    }

    await client.query('COMMIT');

    // Prepare response
    const response = {
      success: true,
      message: 'Sales sync completed',
      summary: {
        total_submitted: sales.length,
        accepted,
        duplicates_ignored,
        errors: errors.length
      }
    };

    // Include errors if any
    if (errors.length > 0) {
      response.errors = errors;
    }

    // Set appropriate status code
    const statusCode = errors.length > 0 ? 207 : 200; // 207 = Multi-Status

    res.status(statusCode).json(response);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Sales sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Sales sync failed',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Get Sales History (for reports/debugging)
const getSalesHistory = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { 
      start_date, 
      end_date, 
      sku_id, 
      device_id,
      limit = 50,
      offset = 0 
    } = req.query;

    let query = `
      SELECT 
        t.id,
        t.sku_id,
        s.brand,
        s.size,
        t.quantity,
        t.occurred_at,
        t.device_id,
        t.meta,
        u.full_name as staff_name
      FROM transactions t
      JOIN skus s ON t.sku_id = s.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.shop_id = $1 AND t.type = 'SALE'
    `;

    const params = [shop_id];
    let paramCount = 1;

    // Add filters
    if (start_date) {
      paramCount++;
      query += ` AND t.occurred_at >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      query += ` AND t.occurred_at <= $${paramCount}`;
      params.push(end_date);
    }

    if (sku_id) {
      paramCount++;
      query += ` AND t.sku_id = $${paramCount}`;
      params.push(sku_id);
    }

    if (device_id) {
      paramCount++;
      query += ` AND t.device_id = $${paramCount}`;
      params.push(device_id);
    }

    // Add ordering and pagination
    query += ` ORDER BY t.occurred_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await client.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM transactions t
      WHERE t.shop_id = $1 AND t.type = 'SALE'
    `;
    const countParams = [shop_id];
    let countParamCount = 1;

    if (start_date) {
      countParamCount++;
      countQuery += ` AND t.occurred_at >= $${countParamCount}`;
      countParams.push(start_date);
    }

    if (end_date) {
      countParamCount++;
      countQuery += ` AND t.occurred_at <= $${countParamCount}`;
      countParams.push(end_date);
    }

    if (sku_id) {
      countParamCount++;
      countQuery += ` AND t.sku_id = $${countParamCount}`;
      countParams.push(sku_id);
    }

    if (device_id) {
      countParamCount++;
      countQuery += ` AND t.device_id = $${countParamCount}`;
      countParams.push(device_id);
    }

    const countResult = await client.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(total / limit)
      },
      sales: result.rows.map(row => ({
        id: row.id,
        sku_id: row.sku_id,
        brand: row.brand,
        size: row.size,
        quantity: Math.abs(row.quantity), // Convert back to positive
        unit_price: row.meta?.unit_price || 0,
        total_amount: row.meta?.total_amount || 0,
        sold_at: row.occurred_at,
        device_id: row.device_id,
        staff_name: row.staff_name,
        sale_id: row.meta?.sale_id
      }))
    });

  } catch (error) {
    console.error('Get sales history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales history',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Get Sales Summary (for dashboard)
const getSalesSummary = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { period = 'today' } = req.query;

    let dateFilter = '';
    let params = [shop_id];

    switch (period) {
      case 'today':
        dateFilter = "AND t.occurred_at >= CURRENT_DATE";
        break;
      case 'week':
        dateFilter = "AND t.occurred_at >= CURRENT_DATE - INTERVAL '7 days'";
        break;
      case 'month':
        dateFilter = "AND t.occurred_at >= CURRENT_DATE - INTERVAL '30 days'";
        break;
      default:
        dateFilter = "AND t.occurred_at >= CURRENT_DATE";
    }

    const query = `
      SELECT 
        COUNT(*) as total_sales,
        SUM(ABS(t.quantity)) as total_units_sold,
        SUM((t.meta->>'total_amount')::numeric) as total_revenue,
        COUNT(DISTINCT t.sku_id) as unique_products,
        COUNT(DISTINCT t.device_id) as active_devices
      FROM transactions t
      WHERE t.shop_id = $1 AND t.type = 'SALE' ${dateFilter}
    `;

    const result = await client.query(query, params);
    const summary = result.rows[0];

    // Get top selling products
    const topProductsQuery = `
      SELECT 
        s.brand,
        s.size,
        SUM(ABS(t.quantity)) as units_sold,
        SUM((t.meta->>'total_amount')::numeric) as revenue
      FROM transactions t
      JOIN skus s ON t.sku_id = s.id
      WHERE t.shop_id = $1 AND t.type = 'SALE' ${dateFilter}
      GROUP BY s.id, s.brand, s.size
      ORDER BY units_sold DESC
      LIMIT 5
    `;

    const topProductsResult = await client.query(topProductsQuery, params);

    res.json({
      success: true,
      period,
      summary: {
        total_sales: parseInt(summary.total_sales) || 0,
        total_units_sold: parseInt(summary.total_units_sold) || 0,
        total_revenue: parseFloat(summary.total_revenue) || 0,
        unique_products: parseInt(summary.unique_products) || 0,
        active_devices: parseInt(summary.active_devices) || 0,
        currency: 'USD'
      },
      top_products: topProductsResult.rows
    });

  } catch (error) {
    console.error('Get sales summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales summary',
      error: error.message
    });
  } finally {
    client.release();
  }
};

module.exports = {
  syncSales,
  getSalesHistory,
  getSalesSummary
};