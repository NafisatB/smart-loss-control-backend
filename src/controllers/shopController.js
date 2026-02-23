const { pool } = require('../config/db');

/**
 * Get Current Shop Profile
 * Returns shop details and owner information
 * Security: RLS ensures user can only see their own shop
 */
const getShopProfile = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;

    // Get shop details with owner info
    const shopResult = await client.query(
      `SELECT 
        s.id,
        s.shop_name,
        s.owner_phone,
        s.created_at,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'STAFF' AND u.is_active = true) as active_staff_count,
        COUNT(DISTINCT i.sku_id) as total_products,
        COALESCE(SUM(i.quantity * i.selling_price), 0) as total_inventory_value
      FROM shops s
      LEFT JOIN users u ON s.id = u.shop_id
      LEFT JOIN inventory i ON s.id = i.shop_id
      WHERE s.id = $1
      GROUP BY s.id`,
      [shop_id]
    );

    if (shopResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found'
      });
    }

    const shop = shopResult.rows[0];

    // Get owner details
    const ownerResult = await client.query(
      `SELECT id, full_name, phone, created_at, last_login_at
       FROM users
       WHERE shop_id = $1 AND role = 'OWNER'
       LIMIT 1`,
      [shop_id]
    );

    const owner = ownerResult.rows[0];

    res.json({
      success: true,
      shop: {
        id: shop.id,
        shop_name: shop.shop_name,
        owner_phone: shop.owner_phone,
        created_at: shop.created_at,
        stats: {
          active_staff: parseInt(shop.active_staff_count),
          total_products: parseInt(shop.total_products),
          inventory_value: parseFloat(shop.total_inventory_value).toFixed(2),
          currency: 'USD'
        }
      },
      owner: owner ? {
        id: owner.id,
        full_name: owner.full_name,
        phone: owner.phone,
        joined_at: owner.created_at,
        last_login: owner.last_login_at
      } : null
    });

  } catch (error) {
    console.error('Get shop profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shop profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Update Shop Profile
 * Owner can update shop name
 * Security: Only OWNER role can update, RLS enforced
 */
const updateShopProfile = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;
    const { shop_name } = req.body;

    // Security: Only owners can update shop
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can update shop profile'
      });
    }

    // Validation
    if (!shop_name || shop_name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Shop name must be at least 2 characters'
      });
    }

    if (shop_name.length > 150) {
      return res.status(400).json({
        success: false,
        message: 'Shop name must not exceed 150 characters'
      });
    }

    // Sanitize input
    const sanitizedShopName = shop_name.trim();

    // Update shop
    const result = await client.query(
      `UPDATE shops 
       SET shop_name = $1
       WHERE id = $2
       RETURNING id, shop_name, created_at`,
      [sanitizedShopName, shop_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found'
      });
    }

    res.json({
      success: true,
      message: 'Shop profile updated successfully',
      shop: result.rows[0]
    });

  } catch (error) {
    console.error('Update shop profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update shop profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get All Staff Members
 * Returns list of staff with their status and activity
 * Security: RLS ensures owner only sees their own staff
 */
const getStaffList = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;

    // Security: Only owners can view staff list
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can view staff list'
      });
    }

    // Get staff with activity stats
    const result = await client.query(
      `SELECT 
        u.id,
        u.full_name,
        u.is_active,
        u.created_at,
        u.last_login_at,
        d.device_id,
        d.linked_at as device_linked_at,
        COUNT(DISTINCT t.id) FILTER (WHERE t.created_at >= CURRENT_DATE - INTERVAL '7 days') as sales_last_7_days,
        COUNT(DISTINCT t.id) FILTER (WHERE t.created_at >= CURRENT_DATE) as sales_today
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      LEFT JOIN transactions t ON u.id = t.user_id AND t.type = 'SALE'
      WHERE u.shop_id = $1 AND u.role = 'STAFF'
      GROUP BY u.id, d.device_id, d.linked_at
      ORDER BY u.created_at DESC`,
      [shop_id]
    );

    res.json({
      success: true,
      count: result.rows.length,
      staff: result.rows.map(staff => ({
        id: staff.id,
        full_name: staff.full_name,
        is_active: staff.is_active,
        device_id: staff.device_id,
        joined_at: staff.created_at,
        device_linked_at: staff.device_linked_at,
        last_login: staff.last_login_at,
        activity: {
          sales_today: parseInt(staff.sales_today) || 0,
          sales_last_7_days: parseInt(staff.sales_last_7_days) || 0
        }
      }))
    });

  } catch (error) {
    console.error('Get staff list error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch staff list',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get Single Staff Details
 * Returns detailed information about a specific staff member
 * Security: RLS + owner-only access
 */
const getStaffDetails = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;
    const { staff_id } = req.params;

    // Security: Only owners can view staff details
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can view staff details'
      });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(staff_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid staff ID format'
      });
    }

    // Get staff details
    const staffResult = await client.query(
      `SELECT 
        u.id,
        u.full_name,
        u.is_active,
        u.created_at,
        u.last_login_at,
        d.device_id,
        d.linked_at as device_linked_at
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      WHERE u.id = $1 AND u.shop_id = $2 AND u.role = 'STAFF'`,
      [staff_id, shop_id]
    );

    if (staffResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    const staff = staffResult.rows[0];

    // Get activity stats
    const activityResult = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as sales_today,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as sales_last_7_days,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as sales_last_30_days,
        COUNT(*) as total_sales
      FROM transactions
      WHERE user_id = $1 AND type = 'SALE'`,
      [staff_id]
    );

    const activity = activityResult.rows[0];

    res.json({
      success: true,
      staff: {
        id: staff.id,
        full_name: staff.full_name,
        is_active: staff.is_active,
        device_id: staff.device_id,
        joined_at: staff.created_at,
        device_linked_at: staff.device_linked_at,
        last_login: staff.last_login_at,
        activity: {
          sales_today: parseInt(activity.sales_today) || 0,
          sales_last_7_days: parseInt(activity.sales_last_7_days) || 0,
          sales_last_30_days: parseInt(activity.sales_last_30_days) || 0,
          total_sales: parseInt(activity.total_sales) || 0
        }
      }
    });

  } catch (error) {
    console.error('Get staff details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch staff details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Revoke Staff Access (Deactivate)
 * Owner can deactivate staff member
 * Security: Only OWNER role, RLS enforced, cannot deactivate self
 */
const revokeStaffAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role, id: owner_id } = req.user;
    const { staff_id } = req.params;

    // Security: Only owners can revoke access
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can revoke staff access'
      });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(staff_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid staff ID format'
      });
    }

    // Security: Cannot deactivate self
    if (staff_id === owner_id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account'
      });
    }

    // Start transaction
    await client.query('BEGIN');

    // Verify staff exists and belongs to this shop
    const staffCheck = await client.query(
      `SELECT id, full_name, role, is_active 
       FROM users 
       WHERE id = $1 AND shop_id = $2`,
      [staff_id, shop_id]
    );

    if (staffCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    const staff = staffCheck.rows[0];

    // Security: Cannot deactivate owner accounts
    if (staff.role === 'OWNER') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate owner accounts'
      });
    }

    // Check if already inactive
    if (!staff.is_active) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Staff member is already inactive'
      });
    }

    // Deactivate staff
    await client.query(
      `UPDATE users 
       SET is_active = false
       WHERE id = $1`,
      [staff_id]
    );

    // Invalidate all sessions for this staff (optional - for extra security)
    await client.query(
      `DELETE FROM sessions WHERE user_id = $1`,
      [staff_id]
    );

    await client.query('COMMIT');

    console.log(`[SECURITY] Staff access revoked: ${staff.full_name} (ID: ${staff_id}) by owner ${owner_id}`);

    res.json({
      success: true,
      message: `Access revoked for ${staff.full_name}`,
      staff: {
        id: staff_id,
        full_name: staff.full_name,
        is_active: false
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Revoke staff access error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to revoke staff access',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Reactivate Staff Access
 * Owner can reactivate previously deactivated staff
 * Security: Only OWNER role, RLS enforced
 */
const reactivateStaffAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;
    const { staff_id } = req.params;

    // Security: Only owners can reactivate access
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can reactivate staff access'
      });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(staff_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid staff ID format'
      });
    }

    // Verify staff exists and belongs to this shop
    const staffCheck = await client.query(
      `SELECT id, full_name, role, is_active 
       FROM users 
       WHERE id = $1 AND shop_id = $2 AND role = 'STAFF'`,
      [staff_id, shop_id]
    );

    if (staffCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    const staff = staffCheck.rows[0];

    // Check if already active
    if (staff.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Staff member is already active'
      });
    }

    // Reactivate staff
    await client.query(
      `UPDATE users 
       SET is_active = true
       WHERE id = $1`,
      [staff_id]
    );

    res.json({
      success: true,
      message: `Access reactivated for ${staff.full_name}`,
      staff: {
        id: staff_id,
        full_name: staff.full_name,
        is_active: true
      }
    });

  } catch (error) {
    console.error('Reactivate staff access error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate staff access',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getShopProfile,
  updateShopProfile,
  getStaffList,
  getStaffDetails,
  revokeStaffAccess,
  reactivateStaffAccess
};
