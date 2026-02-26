const { pool } = require('../config/db');

/**
 * Get Dashboard Overview
 * Returns key metrics for owner dashboard
 * Security: Owner and Staff can view (different data based on role)
 */
const getDashboardOverview = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role, id: user_id } = req.user;

    // Get shop info
    const shopResult = await client.query(
      `SELECT id, shop_name, owner_phone, created_at
       FROM shops
       WHERE id = $1`,
      [shop_id]
    );

    if (shopResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found'
      });
    }

    const shop = shopResult.rows[0];

    // Get inventory value (total stock value)
    const inventoryResult = await client.query(
      `SELECT COALESCE(SUM(quantity * selling_price), 0) as total_value,
              COUNT(DISTINCT sku_id) as total_products,
              COALESCE(SUM(quantity), 0) as total_units
       FROM inventory
       WHERE shop_id = $1`,
      [shop_id]
    );

    const inventory = inventoryResult.rows[0];

    // Get today's sales (sum of sales transactions)
    const todaySalesResult = await client.query(
      `SELECT COALESCE(COUNT(*), 0) as sales_count,
              COALESCE(SUM(ABS(quantity)), 0) as units_sold
       FROM transactions
       WHERE shop_id = $1 
       AND type = 'SALE'
       AND occurred_at >= CURRENT_DATE
       AND occurred_at < CURRENT_DATE + INTERVAL '1 day'`,
      [shop_id]
    );

    const todaySales = todaySalesResult.rows[0];

    // Calculate today's revenue and profit
    const todayRevenueResult = await client.query(
      `SELECT 
        COALESCE(SUM(ABS(t.quantity) * i.selling_price), 0) as revenue,
        COALESCE(SUM(ABS(t.quantity) * i.cost_price), 0) as cost,
        COALESCE(SUM(ABS(t.quantity) * (i.selling_price - i.cost_price)), 0) as profit
       FROM transactions t
       JOIN inventory i ON t.sku_id = i.sku_id AND t.shop_id = i.shop_id
       WHERE t.shop_id = $1 
       AND t.type = 'SALE'
       AND t.occurred_at >= CURRENT_DATE
       AND t.occurred_at < CURRENT_DATE + INTERVAL '1 day'`,
      [shop_id]
    );

    const todayRevenue = todayRevenueResult.rows[0];
    const todayProfitMargin = parseFloat(todayRevenue.revenue) > 0 
      ? ((parseFloat(todayRevenue.profit) / parseFloat(todayRevenue.revenue)) * 100).toFixed(2)
      : 0;

    // Calculate monthly profit
    const monthlyProfitResult = await client.query(
      `SELECT 
        COALESCE(SUM(ABS(t.quantity) * i.selling_price), 0) as revenue,
        COALESCE(SUM(ABS(t.quantity) * i.cost_price), 0) as cost,
        COALESCE(SUM(ABS(t.quantity) * (i.selling_price - i.cost_price)), 0) as profit
       FROM transactions t
       JOIN inventory i ON t.sku_id = i.sku_id AND t.shop_id = i.shop_id
       WHERE t.shop_id = $1 
       AND t.type = 'SALE'
       AND t.occurred_at >= CURRENT_DATE - INTERVAL '30 days'`,
      [shop_id]
    );

    const monthlyProfit = monthlyProfitResult.rows[0];
    const monthlyProfitMargin = parseFloat(monthlyProfit.revenue) > 0 
      ? ((parseFloat(monthlyProfit.profit) / parseFloat(monthlyProfit.revenue)) * 100).toFixed(2)
      : 0;

    // Get open alerts count
    const alertsResult = await client.query(
      `SELECT COUNT(*) as open_alerts
       FROM alerts
       WHERE shop_id = $1 AND is_resolved = false`,
      [shop_id]
    );

    const alerts = alertsResult.rows[0];

    // Get recent alerts (top 5)
    const recentAlertsResult = await client.query(
      `SELECT 
        a.id,
        a.deviation,
        a.estimated_loss,
        a.created_at,
        s.brand,
        s.size,
        al.status
       FROM alerts a
       JOIN skus s ON a.sku_id = s.id
       LEFT JOIN audit_logs al ON a.audit_log_id = al.id
       WHERE a.shop_id = $1 AND a.is_resolved = false
       ORDER BY a.created_at DESC
       LIMIT 5`,
      [shop_id]
    );

    const recentAlerts = recentAlertsResult.rows.map(alert => ({
      id: alert.id,
      product: `${alert.brand} ${alert.size}`,
      deviation: parseInt(alert.deviation),
      estimated_loss: parseFloat(alert.estimated_loss),
      status: alert.status || 'OPEN',
      created_at: alert.created_at,
      time_ago: getTimeAgo(alert.created_at)
    }));

    // Get active staff count (owner only)
    let activeStaffCount = 0;
    if (role === 'OWNER') {
      const staffResult = await client.query(
        `SELECT COUNT(*) as count
         FROM users
         WHERE shop_id = $1 AND role = 'STAFF' AND is_active = true`,
        [shop_id]
      );
      activeStaffCount = parseInt(staffResult.rows[0].count);
    }

    // Get low stock items (below reorder level)
    const lowStockResult = await client.query(
      `SELECT 
        s.brand,
        s.size,
        i.quantity,
        i.reorder_level
       FROM inventory i
       JOIN skus s ON i.sku_id = s.id
       WHERE i.shop_id = $1 
       AND i.quantity <= i.reorder_level
       ORDER BY i.quantity ASC
       LIMIT 5`,
      [shop_id]
    );

    // Simple health score: 100% - (critical * 10% + warning * 5%)
    const deviationResult = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'CRITICAL') as critical_count,
        COUNT(*) FILTER (WHERE status = 'WARNING') as warning_count
       FROM audit_logs
       WHERE shop_id = $1 
       AND created_at >= CURRENT_DATE - INTERVAL '7 days'`,
      [shop_id]
    );

    const deviation = deviationResult.rows[0];
    const criticalCount = parseInt(deviation.critical_count) || 0;
    const warningCount = parseInt(deviation.warning_count) || 0;
    
    const healthScore = Math.max(0, 100 - (criticalCount * 10 + warningCount * 5));
    const healthStatus = healthScore >= 90 ? 'EXCELLENT' : healthScore >= 70 ? 'GOOD' : 'FAIR';

    const lowStockItems = lowStockResult.rows.map(item => ({
      product: `${item.brand} ${item.size}`,
      quantity: parseInt(item.quantity),
      reorder_level: parseInt(item.reorder_level)
    }));

    // Build response
    const response = {
      success: true,
      shop: {
        id: shop.id,
        shop_name: shop.shop_name,
        owner_phone: shop.owner_phone,
        created_at: shop.created_at
      },
      stats: {
        inventory_value: parseFloat(inventory.total_value).toFixed(2),
        total_products: parseInt(inventory.total_products),
        total_units: parseInt(inventory.total_units),
        today_sales_count: parseInt(todaySales.sales_count),
        today_units_sold: parseInt(todaySales.units_sold),
        today_revenue: parseFloat(todayRevenue.revenue).toFixed(2),
        today_profit: parseFloat(todayRevenue.profit).toFixed(2),
        today_profit_margin: todayProfitMargin + '%',
        monthly_profit: parseFloat(monthlyProfit.profit).toFixed(2),
        monthly_profit_margin: monthlyProfitMargin + '%',
        open_alerts: parseInt(alerts.open_alerts),
        active_staff: activeStaffCount,
        currency: 'USD'
      },
      health: {
        score: healthScore,
        status: healthStatus,
        message: getHealthMessage(healthStatus, parseInt(alerts.open_alerts))
      },
      recent_alerts: recentAlerts,
      low_stock_items: lowStockItems
    };

    res.json(response);

  } catch (error) {
    console.error('Get dashboard overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Helper: Calculate time ago from timestamp
 */
function getTimeAgo(timestamp) {
  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
}

/**
 * Helper: Get health message based on status
 */
function getHealthMessage(status, alertCount) {
  if (status === 'EXCELLENT') {
    return alertCount === 0 
      ? 'Perfect! No issues detected' 
      : `Excellent performance with ${alertCount} minor alert${alertCount > 1 ? 's' : ''}`;
  } else if (status === 'GOOD') {
    return alertCount === 0
      ? 'Good performance, keep it up'
      : `Good overall, ${alertCount} alert${alertCount > 1 ? 's' : ''} being monitored`;
  } else if (status === 'FAIR') {
    return `Fair performance, ${alertCount} alert${alertCount > 1 ? 's' : ''} need attention`;
  } else if (status === 'POOR') {
    return `Poor performance, ${alertCount} alert${alertCount > 1 ? 's' : ''} require action`;
  } else {
    return `Critical: ${alertCount} alert${alertCount > 1 ? 's' : ''} require immediate action`;
  }
}

module.exports = {
  getDashboardOverview
};


/**
 * Get Top Selling Products
 * Returns top selling products for today or specified period
 */
const getTopSelling = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { period = 'today', limit = 5 } = req.query;

    let dateFilter = 'CURRENT_DATE';
    if (period === 'week') {
      dateFilter = "CURRENT_DATE - INTERVAL '7 days'";
    } else if (period === 'month') {
      dateFilter = "CURRENT_DATE - INTERVAL '30 days'";
    }

    const topSellingResult = await client.query(
      `SELECT 
        s.id as sku_id,
        s.brand,
        s.size,
        COUNT(*) as sales_count,
        SUM(ABS(t.quantity)) as units_sold,
        SUM(ABS(t.quantity) * i.selling_price) as revenue
       FROM transactions t
       JOIN skus s ON t.sku_id = s.id
       LEFT JOIN inventory i ON i.sku_id = s.id AND i.shop_id = t.shop_id
       WHERE t.shop_id = $1 
       AND t.type = 'SALE'
       AND t.occurred_at >= ${dateFilter}
       AND s.size = '1L'
       GROUP BY s.id, s.brand, s.size
       ORDER BY units_sold DESC
       LIMIT $2`,
      [shop_id, parseInt(limit)]
    );

    res.json({
      success: true,
      period,
      count: topSellingResult.rows.length,
      products: topSellingResult.rows.map(row => ({
        sku_id: row.sku_id,
        brand: row.brand,
        size: row.size,
        product_name: `${row.brand} ${row.size}`,
        sales_count: parseInt(row.sales_count),
        units_sold: parseInt(row.units_sold),
        revenue: parseFloat(row.revenue || 0).toFixed(2)
      }))
    });

  } catch (error) {
    console.error('Get top selling error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top selling products',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getDashboardOverview,
  getTopSelling
};
