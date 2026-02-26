const { pool } = require('../config/db');

/**
 * Get Alerts for Current Shop
 * Returns alerts with optional filters
 */
const getAlerts = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { 
      status, 
      severity,
      start_date,
      end_date,
      page = 1, 
      limit = 20 
    } = req.query;

    const offset = (page - 1) * limit;

    // Build query based on filters
    let query = `
      SELECT 
        a.id,
        a.sku_id,
        a.type,
        a.severity,
        a.message,
        a.estimated_loss,
        a.metadata,
        a.is_resolved,
        a.resolved_at,
        a.created_at,
        s.brand,
        s.size,
        u.full_name as staff_name
      FROM alerts a
      JOIN skus s ON a.sku_id = s.id
      LEFT JOIN audit_logs al ON (a.metadata->>'audit_log_id')::uuid = al.id
      LEFT JOIN users u ON al.user_id = u.id
      WHERE a.shop_id = $1
    `;

    const params = [shop_id];
    let paramCount = 1;

    // Add status filter
    if (status === 'active') {
      query += ` AND a.is_resolved = false`;
    } else if (status === 'resolved') {
      query += ` AND a.is_resolved = true`;
    }

    // Add severity filter
    if (severity) {
      paramCount++;
      query += ` AND a.severity = $${paramCount}`;
      params.push(severity.toUpperCase());
    }

    // Add date range filter
    if (start_date) {
      paramCount++;
      query += ` AND a.created_at >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      query += ` AND a.created_at <= $${paramCount}`;
      params.push(end_date);
    }

    query += ` ORDER BY a.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await client.query(query, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM alerts WHERE shop_id = $1`;
    const countParams = [shop_id];
    let countParamCount = 1;
    
    if (status === 'active') {
      countQuery += ` AND is_resolved = false`;
    } else if (status === 'resolved') {
      countQuery += ` AND is_resolved = true`;
    }

    if (severity) {
      countParamCount++;
      countQuery += ` AND severity = $${countParamCount}`;
      countParams.push(severity.toUpperCase());
    }

    if (start_date) {
      countParamCount++;
      countQuery += ` AND created_at >= $${countParamCount}`;
      countParams.push(start_date);
    }

    if (end_date) {
      countParamCount++;
      countQuery += ` AND created_at <= $${countParamCount}`;
      countParams.push(end_date);
    }

    const countResult = await client.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    const alerts = result.rows.map(alert => ({
      id: alert.id,
      sku_id: alert.sku_id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      sku: {
        brand: alert.brand,
        size: alert.size
      },
      expected_count: alert.metadata?.expected_stock,
      actual_count: alert.metadata?.physical_count,
      variance: alert.metadata?.variance,
      variance_percent: alert.metadata?.variance_percent,
      estimated_loss: parseFloat(alert.estimated_loss || 0),
      is_resolved: alert.is_resolved,
      resolved_at: alert.resolved_at,
      staff_name: alert.staff_name,
      created_at: alert.created_at,
      audit_log_id: alert.metadata?.audit_log_id
    }));

    res.json({
      success: true,
      alerts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get Alert Summary (for dashboard)
 * Returns counts by severity and total loss
 */
const getAlertsSummary = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { days = 7 } = req.query;

    // Get counts by severity
    const summaryQuery = `
      SELECT 
        CASE 
          WHEN ABS(deviation) >= 10 THEN 'CRITICAL'
          WHEN ABS(deviation) >= 5 THEN 'WARNING'
          ELSE 'MINOR'
        END as severity,
        COUNT(*) as count,
        SUM(estimated_loss) as total_loss,
        COUNT(*) FILTER (WHERE is_resolved = false) as active_count
      FROM alerts
      WHERE shop_id = $1
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY severity
    `;

    const result = await client.query(summaryQuery, [shop_id]);

    // Get total active alerts
    const totalActiveQuery = `
      SELECT COUNT(*) as total
      FROM alerts
      WHERE shop_id = $1 AND is_resolved = false
    `;

    const totalActiveResult = await client.query(totalActiveQuery, [shop_id]);

    const summary = {
      total_active: parseInt(totalActiveResult.rows[0].total),
      by_severity: {},
      total_loss_last_7_days: 0
    };

    result.rows.forEach(row => {
      summary.by_severity[row.severity.toLowerCase()] = {
        count: parseInt(row.count),
        active: parseInt(row.active_count),
        total_loss: parseFloat(row.total_loss || 0)
      };
      summary.total_loss_last_7_days += parseFloat(row.total_loss || 0);
    });

    res.json({
      success: true,
      summary
    });

  } catch (error) {
    console.error('Get alerts summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts summary',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get Single Alert Details
 * Returns full alert details including audit log
 */
const getAlertDetails = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { id } = req.params;

    const query = `
      SELECT 
        a.id,
        a.sku_id,
        a.type,
        a.severity,
        a.message,
        a.estimated_loss,
        a.metadata,
        a.is_resolved,
        a.resolved_at,
        a.created_at,
        s.brand,
        s.size,
        al.expected_qty,
        al.actual_qty,
        al.variance,
        al.variance_percent,
        al.created_at as counted_at,
        u.full_name as staff_name,
        u.phone as staff_phone
      FROM alerts a
      JOIN skus s ON a.sku_id = s.id
      LEFT JOIN audit_logs al ON (a.metadata->>'audit_log_id')::uuid = al.id
      LEFT JOIN users u ON al.user_id = u.id
      WHERE a.id = $1 AND a.shop_id = $2
    `;

    const result = await client.query(query, [id, shop_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    const alert = result.rows[0];

    res.json({
      success: true,
      alert: {
        id: alert.id,
        sku_id: alert.sku_id,
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        sku: {
          brand: alert.brand,
          size: alert.size
        },
        expected_count: parseInt(alert.expected_qty),
        actual_count: parseInt(alert.actual_qty),
        variance: parseInt(alert.variance),
        variance_percent: parseFloat(alert.variance_percent),
        estimated_loss: parseFloat(alert.estimated_loss || 0),
        is_resolved: alert.is_resolved,
        resolved_at: alert.resolved_at,
        created_at: alert.created_at,
        counted_at: alert.counted_at,
        staff: {
          name: alert.staff_name,
          phone: alert.staff_phone
        },
        metadata: alert.metadata
      }
    });

  } catch (error) {
    console.error('Get alert details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alert details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Resolve an Alert
 * Owner only - marks alert as resolved
 */
const resolveAlert = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;
    const { id } = req.params;
    const { notes } = req.body;

    // Only owners can resolve alerts
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can resolve alerts'
      });
    }

    // Check if alert exists and belongs to this shop
    const checkResult = await client.query(
      'SELECT id, metadata FROM alerts WHERE id = $1 AND shop_id = $2',
      [id, shop_id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    // Update metadata with notes if provided
    let metadata = checkResult.rows[0].metadata || {};
    if (notes) {
      metadata.resolution_notes = notes;
      metadata.resolved_by = req.user.id;
    }

    // Update alert status
    await client.query(
      `UPDATE alerts 
       SET is_resolved = true, 
           resolved_at = NOW(),
           metadata = $1
       WHERE id = $2`,
      [JSON.stringify(metadata), id]
    );

    res.json({
      success: true,
      message: 'Alert resolved successfully'
    });

  } catch (error) {
    console.error('Resolve alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve alert',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getAlerts,
  getAlertsSummary,
  getAlertDetails,
  resolveAlert
};
