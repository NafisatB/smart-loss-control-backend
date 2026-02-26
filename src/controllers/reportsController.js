const { pool } = require('../config/db');

/**
 * Get Deviation Report
 * Shows variance trends over time
 */
const getDeviationReport = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { start_date, end_date, group_by = 'day' } = req.query;

    // Default to last 30 days if no dates provided
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = end_date || new Date().toISOString();

    // Get deviation trend over time
    const trendQuery = `
      SELECT 
        DATE_TRUNC('${group_by}', al.created_at) as period,
        COUNT(*) as count,
        AVG(ABS(al.deviation_percent)) as avg_deviation_percent,
        SUM(ABS(al.deviation)) as total_variance,
        COUNT(*) FILTER (WHERE al.status = 'CRITICAL') as critical_count,
        COUNT(*) FILTER (WHERE al.status = 'WARNING') as warning_count,
        COUNT(*) FILTER (WHERE al.status = 'OK') as minor_count
      FROM audit_logs al
      WHERE al.shop_id = $1
        AND al.created_at >= $2
        AND al.created_at <= $3
      GROUP BY period
      ORDER BY period ASC
    `;

    const trendResult = await client.query(trendQuery, [shop_id, startDate, endDate]);

    // Get deviation by product
    const productQuery = `
      SELECT 
        s.brand,
        s.size,
        COUNT(*) as incident_count,
        AVG(ABS(al.variance_percent)) as avg_deviation_percent,
        SUM(ABS(al.variance)) as total_variance,
        SUM(ABS(al.variance) * i.cost_price) as estimated_loss
      FROM audit_logs al
      JOIN skus s ON al.sku_id = s.id
      JOIN inventory i ON al.sku_id = i.sku_id AND al.shop_id = i.shop_id
      WHERE al.shop_id = $1
        AND al.created_at >= $2
        AND al.created_at <= $3
      GROUP BY s.id, s.brand, s.size, i.cost_price
      ORDER BY estimated_loss DESC
      LIMIT 10
    `;

    const productResult = await client.query(productQuery, [shop_id, startDate, endDate]);

    // Get overall summary
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_incidents,
        AVG(ABS(variance_percent)) as avg_deviation_percent,
        SUM(ABS(deviation)) as total_variance,
        COUNT(DISTINCT sku_id) as affected_products,
        COUNT(*) FILTER (WHERE status = 'CRITICAL') as critical_count,
        COUNT(*) FILTER (WHERE status = 'WARNING') as warning_count,
        COUNT(*) FILTER (WHERE status = 'OK') as minor_count
      FROM audit_logs
      WHERE shop_id = $1
        AND created_at >= $2
        AND created_at <= $3
    `;

    const summaryResult = await client.query(summaryQuery, [shop_id, startDate, endDate]);

    // Calculate estimated total loss
    const lossQuery = `
      SELECT SUM(ABS(al.variance) * i.cost_price) as total_loss
      FROM audit_logs al
      JOIN inventory i ON al.sku_id = i.sku_id AND al.shop_id = i.shop_id
      WHERE al.shop_id = $1
        AND al.created_at >= $2
        AND al.created_at <= $3
    `;

    const lossResult = await client.query(lossQuery, [shop_id, startDate, endDate]);

    const summary = summaryResult.rows[0];

    res.json({
      success: true,
      period: {
        start: startDate,
        end: endDate,
        group_by
      },
      summary: {
        total_incidents: parseInt(summary.total_incidents),
        avg_deviation_percent: parseFloat(summary.avg_deviation_percent || 0).toFixed(2),
        total_variance: parseInt(summary.total_variance || 0),
        total_loss: parseFloat(lossResult.rows[0].total_loss || 0).toFixed(2),
        affected_products: parseInt(summary.affected_products),
        by_severity: {
          critical: parseInt(summary.critical_count),
          warning: parseInt(summary.warning_count),
          minor: parseInt(summary.minor_count)
        }
      },
      trend: trendResult.rows.map(row => ({
        period: row.period,
        count: parseInt(row.count),
        avg_deviation_percent: parseFloat(row.avg_deviation_percent || 0).toFixed(2),
        total_variance: parseInt(row.total_variance),
        critical_count: parseInt(row.critical_count),
        warning_count: parseInt(row.warning_count),
        minor_count: parseInt(row.minor_count)
      })),
      by_product: productResult.rows.map(row => ({
        brand: row.brand,
        size: row.size,
        incident_count: parseInt(row.incident_count),
        avg_deviation_percent: parseFloat(row.avg_deviation_percent).toFixed(2),
        total_variance: parseInt(row.total_variance),
        estimated_loss: parseFloat(row.estimated_loss).toFixed(2)
      }))
    });

  } catch (error) {
    console.error('Get deviation report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate deviation report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get Staff Performance Report
 * Shows sales and accuracy by staff member
 */
const getStaffPerformanceReport = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { start_date, end_date } = req.query;

    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = end_date || new Date().toISOString();

    const query = `
      SELECT 
        u.id as staff_id,
        u.full_name as staff_name,
        u.phone as staff_phone,
        -- Sales metrics
        COUNT(DISTINCT t.id) FILTER (WHERE t.type = 'SALE') as total_sales,
        SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'SALE') as units_sold,
        SUM((t.meta->>'total_amount')::numeric) FILTER (WHERE t.type = 'SALE') as total_revenue,
        -- Audit metrics
        COUNT(DISTINCT al.id) as spot_checks_performed,
        AVG(ABS(al.deviation_percent)) as avg_deviation_percent,
        COUNT(DISTINCT al.id) FILTER (WHERE al.status = 'CRITICAL') as critical_incidents,
        COUNT(DISTINCT al.id) FILTER (WHERE al.status = 'WARNING') as warning_incidents,
        -- Accuracy score (100 - avg deviation)
        (100 - COALESCE(AVG(ABS(al.variance_percent)), 0)) as accuracy_score
      FROM users u
      LEFT JOIN transactions t ON t.user_id = u.id AND t.shop_id = u.shop_id
        AND t.occurred_at >= $2 AND t.occurred_at <= $3
      LEFT JOIN audit_logs al ON al.user_id = u.id AND al.shop_id = u.shop_id
        AND al.created_at >= $2 AND al.created_at <= $3
      WHERE u.shop_id = $1 AND u.role = 'STAFF'
      GROUP BY u.id, u.full_name, u.phone
      ORDER BY total_revenue DESC
    `;

    const result = await client.query(query, [shop_id, startDate, endDate]);

    const staff = result.rows.map(row => ({
      staff_id: row.staff_id,
      staff_name: row.staff_name,
      staff_phone: row.staff_phone,
      sales: {
        total_sales: parseInt(row.total_sales || 0),
        units_sold: parseInt(row.units_sold || 0),
        total_revenue: parseFloat(row.total_revenue || 0).toFixed(2)
      },
      accuracy: {
        spot_checks: parseInt(row.spot_checks_performed || 0),
        avg_deviation_percent: parseFloat(row.avg_deviation_percent || 0).toFixed(2),
        accuracy_score: parseFloat(row.accuracy_score || 100).toFixed(1),
        critical_incidents: parseInt(row.critical_incidents || 0),
        warning_incidents: parseInt(row.warning_incidents || 0)
      }
    }));

    res.json({
      success: true,
      period: {
        start: startDate,
        end: endDate
      },
      staff
    });

  } catch (error) {
    console.error('Get staff performance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate staff performance report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get Inventory Turnover Report
 * Shows how fast inventory is moving
 */
const getInventoryTurnoverReport = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { start_date, end_date } = req.query;

    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = end_date || new Date().toISOString();

    const query = `
      SELECT 
        s.id as sku_id,
        s.brand,
        s.size,
        i.quantity as current_stock,
        i.reorder_level,
        -- Sales in period
        COALESCE(SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'SALE'), 0) as units_sold,
        -- Average inventory (simplified: current stock)
        i.quantity as avg_inventory,
        -- Turnover rate (sales / avg inventory)
        CASE 
          WHEN i.quantity > 0 THEN COALESCE(SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'SALE'), 0)::float / i.quantity
          ELSE 0
        END as turnover_rate,
        -- Days to sell current stock
        CASE 
          WHEN COALESCE(SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'SALE'), 0) > 0 
          THEN (i.quantity::float / (COALESCE(SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'SALE'), 0)::float / EXTRACT(DAY FROM ($3::timestamp - $2::timestamp))))
          ELSE 999
        END as days_to_sell,
        -- Stock status
        CASE 
          WHEN i.quantity <= i.reorder_level THEN 'LOW'
          WHEN i.quantity = 0 THEN 'OUT'
          ELSE 'OK'
        END as stock_status
      FROM skus s
      JOIN inventory i ON s.id = i.sku_id
      LEFT JOIN transactions t ON t.sku_id = s.id AND t.shop_id = i.shop_id
        AND t.occurred_at >= $2 AND t.occurred_at <= $3
      WHERE i.shop_id = $1 AND s.is_active = true
      GROUP BY s.id, s.brand, s.size, i.quantity, i.reorder_level
      ORDER BY turnover_rate DESC
    `;

    const result = await client.query(query, [shop_id, startDate, endDate]);

    const products = result.rows.map(row => ({
      sku_id: row.sku_id,
      brand: row.brand,
      size: row.size,
      current_stock: parseInt(row.current_stock),
      reorder_level: parseInt(row.reorder_level),
      units_sold: parseInt(row.units_sold),
      turnover_rate: parseFloat(row.turnover_rate).toFixed(2),
      days_to_sell: Math.min(parseInt(row.days_to_sell), 999),
      stock_status: row.stock_status
    }));

    // Calculate summary
    const totalStock = products.reduce((sum, p) => sum + p.current_stock, 0);
    const totalSold = products.reduce((sum, p) => sum + p.units_sold, 0);
    const avgTurnover = products.length > 0 
      ? products.reduce((sum, p) => sum + parseFloat(p.turnover_rate), 0) / products.length 
      : 0;

    res.json({
      success: true,
      period: {
        start: startDate,
        end: endDate
      },
      summary: {
        total_stock: totalStock,
        total_sold: totalSold,
        avg_turnover_rate: avgTurnover.toFixed(2),
        low_stock_items: products.filter(p => p.stock_status === 'LOW').length,
        out_of_stock_items: products.filter(p => p.stock_status === 'OUT').length
      },
      products
    });

  } catch (error) {
    console.error('Get inventory turnover report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate inventory turnover report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get Sales Trend Report
 * Shows sales over time with comparisons
 */
const getSalesTrendReport = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { start_date, end_date, group_by = 'day' } = req.query;

    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = end_date || new Date().toISOString();

    const query = `
      SELECT 
        DATE_TRUNC('${group_by}', t.occurred_at) as period,
        COUNT(*) as transaction_count,
        SUM(ABS(t.quantity)) as units_sold,
        SUM((t.meta->>'total_amount')::numeric) as revenue,
        SUM(ABS(t.quantity) * i.cost_price) as cost,
        SUM((t.meta->>'total_amount')::numeric) - SUM(ABS(t.quantity) * i.cost_price) as profit
      FROM transactions t
      JOIN inventory i ON t.sku_id = i.sku_id AND t.shop_id = i.shop_id
      WHERE t.shop_id = $1
        AND t.type = 'SALE'
        AND t.occurred_at >= $2
        AND t.occurred_at <= $3
      GROUP BY period
      ORDER BY period ASC
    `;

    const result = await client.query(query, [shop_id, startDate, endDate]);

    const trend = result.rows.map(row => ({
      period: row.period,
      transaction_count: parseInt(row.transaction_count),
      units_sold: parseInt(row.units_sold),
      revenue: parseFloat(row.revenue || 0).toFixed(2),
      cost: parseFloat(row.cost || 0).toFixed(2),
      profit: parseFloat(row.profit || 0).toFixed(2),
      profit_margin: row.revenue > 0 
        ? ((parseFloat(row.profit) / parseFloat(row.revenue)) * 100).toFixed(2)
        : '0.00'
    }));

    // Calculate totals
    const totals = {
      transaction_count: trend.reduce((sum, t) => sum + t.transaction_count, 0),
      units_sold: trend.reduce((sum, t) => sum + t.units_sold, 0),
      revenue: trend.reduce((sum, t) => sum + parseFloat(t.revenue), 0).toFixed(2),
      cost: trend.reduce((sum, t) => sum + parseFloat(t.cost), 0).toFixed(2),
      profit: trend.reduce((sum, t) => sum + parseFloat(t.profit), 0).toFixed(2)
    };

    totals.profit_margin = totals.revenue > 0
      ? ((parseFloat(totals.profit) / parseFloat(totals.revenue)) * 100).toFixed(2)
      : '0.00';

    res.json({
      success: true,
      period: {
        start: startDate,
        end: endDate,
        group_by
      },
      totals,
      trend
    });

  } catch (error) {
    console.error('Get sales trend report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate sales trend report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getDeviationReport,
  getStaffPerformanceReport,
  getInventoryTurnoverReport,
  getSalesTrendReport
};
