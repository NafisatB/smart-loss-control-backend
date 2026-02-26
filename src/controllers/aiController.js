const { pool } = require('../config/db');

/**
 * Check if spot check should be triggered
 * Implements data science anomaly detection logic
 * 
 * Trigger Types (from anomaly_detection_v2.py):
 * - RANDOM: 20% random security checks
 * - VOLUME: Sales spike (2× average)
 * - TIME: 4+ hours since last count
 * - COUNTER: 10+ sales since last count
 */
const triggerCount = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, id: user_id } = req.user;
    const { device_id } = req.query;

    if (!device_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameter: device_id'
      });
    }

    // Get sales velocity for all SKUs in the shop
    const velocityResult = await client.query(`
      WITH sku_stats AS (
        SELECT 
          i.sku_id,
          s.brand,
          s.size,
          i.quantity as current_stock,
          MAX(al.created_at) as last_count_timestamp
        FROM inventory i
        JOIN skus s ON i.sku_id = s.id
        LEFT JOIN audit_logs al ON al.sku_id = i.sku_id AND al.shop_id = i.shop_id
        WHERE i.shop_id = $1 AND s.is_active = true
        GROUP BY i.sku_id, s.brand, s.size, i.quantity
      )
      SELECT 
        ss.sku_id,
        ss.brand,
        ss.size,
        ss.current_stock,
        ss.last_count_timestamp,
        -- Sales in last hour
        COUNT(*) FILTER (
          WHERE t.type = 'SALE' 
          AND t.occurred_at >= NOW() - INTERVAL '1 hour'
        ) as last_hour_sales,
        -- Average hourly sales over last 7 days
        COUNT(*) FILTER (
          WHERE t.type = 'SALE' 
          AND t.occurred_at >= NOW() - INTERVAL '7 days'
        ) / 168.0 as seven_day_avg,
        -- Sales since last count
        COUNT(*) FILTER (
          WHERE t.type = 'SALE' 
          AND t.occurred_at > COALESCE(ss.last_count_timestamp, NOW() - INTERVAL '1 day')
        ) as sales_since_count,
        -- Sales in last 24 hours
        COUNT(*) FILTER (
          WHERE t.type = 'SALE' 
          AND t.occurred_at >= NOW() - INTERVAL '24 hours'
        ) as last_24h_sales
      FROM sku_stats ss
      LEFT JOIN transactions t ON t.sku_id = ss.sku_id AND t.shop_id = $1
      GROUP BY ss.sku_id, ss.brand, ss.size, ss.current_stock, ss.last_count_timestamp
      HAVING COUNT(*) FILTER (
        WHERE t.type = 'SALE' 
        AND t.occurred_at >= NOW() - INTERVAL '24 hours'
      ) > 0
      ORDER BY last_hour_sales DESC, sales_since_count DESC
      LIMIT 1
    `, [shop_id]);

    // If no recent sales activity, no trigger needed
    if (velocityResult.rows.length === 0) {
      return res.json({
        success: true,
        should_trigger: false,
        reason: 'No recent sales activity',
        message: 'Continue with normal operations'
      });
    }

    const velocity = velocityResult.rows[0];
    
    // Convert string values to numbers and handle nulls
    const sevenDayAvg = parseFloat(velocity.seven_day_avg) || 0;
    const lastHourSales = parseInt(velocity.last_hour_sales) || 0;
    const salesSinceCount = parseInt(velocity.sales_since_count) || 0;
    
    // Apply data science trigger logic (from anomaly_detection_v2.py)
    const triggers = [];

    // -------------------------------------------------------
    // TRIGGER 1: RANDOM (20% probability)
    // -------------------------------------------------------
    if (Math.random() < 0.20) {
      triggers.push({
        type: 'RANDOM',
        priority: 2,
        reason: 'Random security check'
      });
    }

    // -------------------------------------------------------
    // TRIGGER 2: VOLUME (2× average sales)
    // -------------------------------------------------------
    const volumeThreshold = sevenDayAvg * 2.0;
    if (lastHourSales > volumeThreshold && sevenDayAvg > 0) {
      triggers.push({
        type: 'VOLUME',
        priority: 3,
        reason: `Sales spike: ${lastHourSales} vs ${sevenDayAvg.toFixed(1)} avg`
      });
    }

    // -------------------------------------------------------
    // TRIGGER 3: TIME (4+ hours since last count)
    // -------------------------------------------------------
    const hoursSinceCount = velocity.last_count_timestamp 
      ? (Date.now() - new Date(velocity.last_count_timestamp)) / (1000 * 60 * 60)
      : 999; // If never counted, treat as very old
    
    if (hoursSinceCount >= 4) {
      triggers.push({
        type: 'TIME',
        priority: 2,
        reason: `${hoursSinceCount.toFixed(1)} hours since last count`
      });
    }

    // -------------------------------------------------------
    // TRIGGER 4: COUNTER (3+ sales since last count)
    // -------------------------------------------------------
    if (salesSinceCount >= 3) {
      triggers.push({
        type: 'COUNTER',
        priority: 1,
        reason: `${salesSinceCount} sales since last count`
      });
    }

    // -------------------------------------------------------
    // Choose highest priority trigger
    // -------------------------------------------------------
    if (triggers.length > 0) {
      const trigger = triggers.reduce((max, t) => 
        t.priority > max.priority ? t : max
      );
      
      console.log(`[AI] Trigger activated: ${trigger.type} for ${velocity.brand} ${velocity.size} (shop: ${shop_id})`);
      
      return res.json({
        success: true,
        should_trigger: true,
        type: trigger.type,
        priority: trigger.priority,
        reason: trigger.reason,
        sku_to_check: {
          sku_id: velocity.sku_id,
          brand: velocity.brand,
          size: velocity.size,
          current_stock: parseInt(velocity.current_stock)
        },
        prompt: `Quick Check: How many ${velocity.brand} ${velocity.size} on shelf?`,
        ui_config: {
          background_color: '#D4AF37',  // Golden color
          ui_locked: true,               // Prevent other actions
          timeout_seconds: 60            // Staff has 60 seconds to respond
        },
        metadata: {
          last_hour_sales: lastHourSales,
          seven_day_avg: parseFloat(sevenDayAvg.toFixed(2)),
          hours_since_count: parseFloat(hoursSinceCount.toFixed(1)),
          sales_since_count: salesSinceCount,
          all_triggers: triggers
        }
      });
    }

    // No triggers met
    res.json({
      success: true,
      should_trigger: false,
      reason: 'No trigger conditions met',
      message: 'Continue with normal operations',
      metadata: {
        last_hour_sales: lastHourSales,
        seven_day_avg: parseFloat(sevenDayAvg.toFixed(2)),
        hours_since_count: parseFloat(hoursSinceCount.toFixed(1)),
        sales_since_count: salesSinceCount
      }
    });

  } catch (error) {
    console.error('Trigger count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check trigger',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  triggerCount
};
