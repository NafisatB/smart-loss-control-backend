const { pool } = require('../config/db');

/**
 * Utility: Validate UUID
 */
const isValidUUID = (uuid) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

/**
 * Get Alerts for Current Shop
 */
const getAlerts = async (req, res) => {
  const client = await pool.connect();
  try {
    const { shop_id } = req.user;

    // Validate shop_id
    if (!shop_id || !isValidUUID(shop_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid shop_id',
      });
    }

    const { status, severity, start_date, end_date, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        a.id,
        a.sku_id,
        a.type,
        a.severity,
        a.estimated_loss,
        a.metadata,
        a.is_resolved,
        a.resolved_at,
        a.created_at,
        s.brand,
        s.size
      FROM alerts a
      JOIN skus s ON a.sku_id = s.id
      WHERE a.shop_id = $1
    `;

    const params = [shop_id];
    let paramCount = 1;

    if (status === 'active') query += ` AND a.is_resolved = false`;
    else if (status === 'resolved') query += ` AND a.is_resolved = true`;

    if (severity) {
      paramCount++;
      query += ` AND a.severity = $${paramCount}`;
      params.push(severity.toUpperCase());
    }

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

    // Count for pagination
    let countQuery = `SELECT COUNT(*) FROM alerts WHERE shop_id = $1`;
    const countParams = [shop_id];
    let countParamCount = 1;

    if (status === 'active') countQuery += ` AND is_resolved = false`;
    else if (status === 'resolved') countQuery += ` AND is_resolved = true`;

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
      message: alert.metadata?.message || 'Stock variance detected',
      sku: { brand: alert.brand, size: alert.size },
      expected_count: alert.metadata?.expected_stock,
      actual_count: alert.metadata?.physical_count,
      variance: alert.metadata?.variance,
      variance_percent: alert.metadata?.variance_percent,
      estimated_loss: parseFloat(alert.estimated_loss || 0),
      is_resolved: alert.is_resolved,
      resolved_at: alert.resolved_at,
      created_at: alert.created_at,
      audit_log_id: alert.metadata?.audit_log_id,
      resolution_notes: alert.metadata?.resolution_notes,
      resolved_by: alert.metadata?.resolved_by
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
 * Get Alerts Summary (dashboard)
 */
const getAlertsSummary = async (req, res) => {
  const client = await pool.connect();
  try {
    const { shop_id } = req.user;

    if (!shop_id || !isValidUUID(shop_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid shop_id',
      });
    }

    const { days = 7 } = req.query;

    const summaryQuery = `
      SELECT 
        severity,
        COUNT(*) AS count,
        SUM(estimated_loss) AS total_loss,
        COUNT(*) FILTER (WHERE is_resolved = false) AS active_count
      FROM alerts
      WHERE shop_id = $1 AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY severity
    `;
    const result = await client.query(summaryQuery, [shop_id]);

    const totalActiveQuery = `SELECT COUNT(*) AS total FROM alerts WHERE shop_id = $1 AND is_resolved = false`;
    const totalActiveResult = await client.query(totalActiveQuery, [shop_id]);

    const summary = {
      total_active: parseInt(totalActiveResult.rows[0].total),
      by_severity: {}
    };

    const totalLossKey = `total_loss_last_${days}_days`;
    summary[totalLossKey] = 0;

    result.rows.forEach(row => {
      summary.by_severity[row.severity.toLowerCase()] = {
        count: parseInt(row.count),
        active: parseInt(row.active_count),
        total_loss: parseFloat(row.total_loss || 0)
      };
      summary[totalLossKey] += parseFloat(row.total_loss || 0);
    });

    res.json({ success: true, summary });

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
 */
const getAlertDetails = async (req, res) => {
  const client = await pool.connect();
  try {
    const { shop_id } = req.user;
    const { id } = req.params;

    if (!shop_id || !isValidUUID(shop_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid shop_id',
      });
    }

    const query = `
      SELECT 
        a.id,
        a.sku_id,
        a.type,
        a.severity,
        a.estimated_loss,
        a.metadata,
        a.is_resolved,
        a.resolved_at,
        a.created_at,
        s.brand,
        s.size
      FROM alerts a
      JOIN skus s ON a.sku_id = s.id
      WHERE a.id = $1 AND a.shop_id = $2
    `;
    const result = await client.query(query, [id, shop_id]);

    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Alert not found' });

    const alert = result.rows[0];
    res.json({
      success: true,
      alert: {
        id: alert.id,
        sku_id: alert.sku_id,
        type: alert.type,
        severity: alert.severity,
        message: alert.metadata?.message || 'Stock variance detected',
        sku: { brand: alert.brand, size: alert.size },
        expected_count: alert.metadata?.expected_stock,
        actual_count: alert.metadata?.physical_count,
        variance: alert.metadata?.variance,
        variance_percent: alert.metadata?.variance_percent,
        estimated_loss: parseFloat(alert.estimated_loss || 0),
        is_resolved: alert.is_resolved,
        resolved_at: alert.resolved_at,
        created_at: alert.created_at,
        audit_log_id: alert.metadata?.audit_log_id,
        resolution_notes: alert.metadata?.resolution_notes,
        resolved_by: alert.metadata?.resolved_by
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
 */
const resolveAlert = async (req, res) => {
  const client = await pool.connect();
  try {
    const { shop_id, role, id: userId } = req.user;
    const { id } = req.params;
    const { notes } = req.body;

    if (!shop_id || !isValidUUID(shop_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid shop_id',
      });
    }

    if (role !== 'OWNER') return res.status(403).json({ success: false, message: 'Only shop owners can resolve alerts' });

    const checkResult = await client.query(
      'SELECT id, metadata FROM alerts WHERE id = $1 AND shop_id = $2',
      [id, shop_id]
    );
    if (!checkResult.rows.length) return res.status(404).json({ success: false, message: 'Alert not found' });

    let metadata = checkResult.rows[0].metadata || {};
    if (notes) {
      metadata.resolution_notes = notes;
      metadata.resolved_by = userId;
    }

    await client.query(
      `UPDATE alerts SET is_resolved = true, resolved_at = NOW(), metadata = $1 WHERE id = $2`,
      [JSON.stringify(metadata), id]
    );

    res.json({ success: true, message: 'Alert resolved successfully' });

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