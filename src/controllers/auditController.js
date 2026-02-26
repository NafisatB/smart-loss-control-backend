const { pool } = require('../config/db');

/**
 * Verify Physical Count and Detect Variance
 * POST /audit/verify
 * 
 * Compares staff's physical count against system's expected stock
 * Creates alerts for significant variances
 */
const verifyPhysicalCount = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, id: user_id } = req.user;
    const { sku_id, physical_count, counted_at } = req.body;

    // Validation
    if (!sku_id || physical_count === undefined || physical_count === null) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: sku_id, physical_count'
      });
    }

    if (physical_count < 0) {
      return res.status(400).json({
        success: false,
        message: 'Physical count cannot be negative'
      });
    }

    // Start transaction
    await client.query('BEGIN');

    // Get SKU details
    const skuResult = await client.query(
      'SELECT id, brand, size FROM skus WHERE id = $1',
      [sku_id]
    );

    if (skuResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }

    const sku = skuResult.rows[0];

    // Calculate Expected Stock
    // Formula: Initial Stock + Restocks - Sales - Decants Out + Decants In
    const expectedStockQuery = `
      WITH stock_calculation AS (
        SELECT 
          i.quantity as initial_stock,
          COALESCE(SUM(t.quantity) FILTER (WHERE t.type = 'RESTOCK'), 0) as total_restocked,
          COALESCE(SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'SALE'), 0) as total_sold,
          COALESCE(SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'DECANT_OUT'), 0) as total_decanted_out,
          COALESCE(SUM(t.quantity) FILTER (WHERE t.type = 'DECANT_IN'), 0) as total_decanted_in
        FROM inventory i
        LEFT JOIN transactions t ON t.sku_id = i.sku_id AND t.shop_id = i.shop_id
        WHERE i.shop_id = $1 AND i.sku_id = $2
        GROUP BY i.quantity
      )
      SELECT 
        initial_stock,
        total_restocked,
        total_sold,
        total_decanted_out,
        total_decanted_in,
        (initial_stock + total_restocked - total_sold - total_decanted_out + total_decanted_in) as expected_stock
      FROM stock_calculation
    `;

    const stockResult = await client.query(expectedStockQuery, [shop_id, sku_id]);

    if (stockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Inventory record not found for this SKU'
      });
    }

    const stockData = stockResult.rows[0];
    const expectedStock = parseInt(stockData.expected_stock) || 0;
    const physicalCount = parseInt(physical_count);

    // Calculate variance
    const variance = physicalCount - expectedStock;
    const variancePercent = expectedStock > 0 
      ? ((variance / expectedStock) * 100).toFixed(2)
      : 0;

    // Determine alert level
    let alertLevel = 'NORMAL';
    let alertTriggered = false;
    const absVariancePercent = Math.abs(parseFloat(variancePercent));

    if (absVariancePercent >= 10.0) {
      alertLevel = 'CRITICAL';
      alertTriggered = true;
    } else if (absVariancePercent >= 5.0) {
      alertLevel = 'WARNING';
      alertTriggered = true;
    } else if (absVariancePercent >= 1.0) {
      alertLevel = 'MINOR';
      alertTriggered = true;
    }

    // Get cost price for loss calculation
    const inventoryResult = await client.query(
      'SELECT cost_price FROM inventory WHERE shop_id = $1 AND sku_id = $2',
      [shop_id, sku_id]
    );

    const costPrice = inventoryResult.rows[0]?.cost_price || 0;
    const estimatedLoss = Math.abs(variance) * parseFloat(costPrice);

    // Record audit log
    const auditResult = await client.query(
      `INSERT INTO audit_logs 
        (shop_id, sku_id, user_id, expected_qty, actual_qty, deviation, deviation_percent, trigger_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        shop_id,
        sku_id,
        user_id,
        expectedStock,
        physicalCount,
        variance,
        variancePercent,
        'MANUAL',  // trigger_type
        counted_at || new Date().toISOString()
      ]
    );

    const auditLogId = auditResult.rows[0].id;

    // Create alert if variance is significant
    let alertId = null;
    if (alertTriggered) {
      const alertMessage = variance < 0
        ? `Missing ${Math.abs(variance)} units of ${sku.brand} ${sku.size}`
        : `Excess ${variance} units of ${sku.brand} ${sku.size}`;

      const alertResult = await client.query(
        `INSERT INTO alerts 
          (shop_id, sku_id, type, severity, message, estimated_loss, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING id`,
        [
          shop_id,
          sku_id,
          'VARIANCE_DETECTED',
          alertLevel,
          alertMessage,
          estimatedLoss,
          JSON.stringify({
            audit_log_id: auditLogId,
            expected_stock: expectedStock,
            physical_count: physicalCount,
            variance,
            variance_percent: variancePercent,
            counted_by: user_id
          })
        ]
      );

      alertId = alertResult.rows[0].id;
    }

    // Update inventory with physical count (reconciliation)
    await client.query(
      `UPDATE inventory 
       SET quantity = $1, updated_at = NOW()
       WHERE shop_id = $2 AND sku_id = $3`,
      [physicalCount, shop_id, sku_id]
    );

    await client.query('COMMIT');

    // Prepare response
    const response = {
      success: true,
      message: alertTriggered 
        ? `Variance detected: ${variance} units (${variancePercent}%)`
        : 'Count verified - no significant variance',
      audit_log_id: auditLogId,
      verification: {
        sku_id,
        brand: sku.brand,
        size: sku.size,
        expected_stock: expectedStock,
        physical_count: physicalCount,
        variance,
        variance_percent: parseFloat(variancePercent),
        alert_level: alertLevel,
        alert_triggered: alertTriggered,
        estimated_loss: parseFloat(estimatedLoss.toFixed(2))
      },
      breakdown: {
        initial_stock: parseInt(stockData.initial_stock),
        total_restocked: parseInt(stockData.total_restocked),
        total_sold: parseInt(stockData.total_sold),
        total_decanted_out: parseInt(stockData.total_decanted_out),
        total_decanted_in: parseInt(stockData.total_decanted_in)
      }
    };

    if (alertId) {
      response.alert_id = alertId;
    }

    res.json(response);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Verify physical count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify physical count',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get Audit History
 * GET /audit/history
 */
const getAuditHistory = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { sku_id, start_date, end_date, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        al.id,
        al.sku_id,
        s.brand,
        s.size,
        al.expected_qty,
        al.actual_qty,
        al.deviation,
        al.deviation_percent,
        al.status,
        al.created_at,
        u.full_name as counted_by
      FROM audit_logs al
      JOIN skus s ON al.sku_id = s.id
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.shop_id = $1
    `;

    const params = [shop_id];
    let paramCount = 1;

    if (sku_id) {
      paramCount++;
      query += ` AND al.sku_id = $${paramCount}`;
      params.push(sku_id);
    }

    if (start_date) {
      paramCount++;
      query += ` AND al.created_at >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      query += ` AND al.created_at <= $${paramCount}`;
      params.push(end_date);
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await client.query(query, params);

    res.json({
      success: true,
      audit_logs: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Get audit history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  verifyPhysicalCount,
  getAuditHistory
};
