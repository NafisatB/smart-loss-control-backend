const { pool } = require('../config/db');

// Create New SKU (Product)
const createSKU = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { brand, size, is_carton, units_per_carton } = req.body;

    // Validation
    if (!brand || !size) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: brand, size'
      });
    }

    // Sanitize inputs
    const sanitizedBrand = brand.trim();
    const sanitizedSize = size.trim();
    const isCarton = is_carton || false;
    const unitsPerCarton = units_per_carton || 12;

    // Check if SKU already exists
    const existingCheck = await client.query(
      `SELECT id, brand, size, is_carton, units_per_carton, created_at
       FROM skus
       WHERE brand = $1 AND size = $2 AND is_carton = $3`,
      [sanitizedBrand, sanitizedSize, isCarton]
    );

    if (existingCheck.rows.length > 0) {
      const existing = existingCheck.rows[0];
      return res.status(409).json({
        success: false,
        message: `Product already exists: ${existing.brand} ${existing.size} ${existing.is_carton ? '(Carton)' : '(Bottle)'}`,
        existing_sku: {
          id: existing.id,
          brand: existing.brand,
          size: existing.size,
          is_carton: existing.is_carton,
          units_per_carton: existing.units_per_carton,
          created_at: existing.created_at
        },
        suggestion: 'Use the restock endpoint to add more quantity to this product'
      });
    }

    // Insert new SKU
    const result = await client.query(
      `INSERT INTO skus (brand, size, is_carton, units_per_carton)
       VALUES ($1, $2, $3, $4)
       RETURNING id, brand, size, is_carton, units_per_carton, created_at`,
      [sanitizedBrand, sanitizedSize, isCarton, unitsPerCarton]
    );

    res.status(201).json({
      success: true,
      message: 'SKU created successfully',
      sku: result.rows[0]
    });

  } catch (error) {
    console.error('Create SKU error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create SKU', 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Get All SKUs
const getAllSKUs = async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Query parameter to include inactive SKUs (default: false)
    const includeInactive = req.query.include_inactive === 'true';

    const query = includeInactive
      ? `SELECT id, brand, size, is_carton, units_per_carton, is_active, discontinued_at, created_at
         FROM skus
         WHERE size = '1L'
         ORDER BY is_active DESC, brand, size, is_carton`
      : `SELECT id, brand, size, is_carton, units_per_carton, is_active, created_at
         FROM skus
         WHERE is_active = true AND size = '1L'
         ORDER BY brand, size, is_carton`;

    const result = await client.query(query);

    res.json({
      success: true,
      count: result.rows.length,
      skus: result.rows,
      note: 'Showing only 1L products. ' + (includeInactive ? 'Including discontinued items.' : 'Active items only.')
    });

  } catch (error) {
    console.error('Get SKUs error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch SKUs', 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Get Inventory Summary for Current Shop
const getInventorySummary = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;

    // Get all inventory items with SKU details
    // RLS automatically filters by shop_id
    const result = await client.query(
      `SELECT 
        i.id,
        i.sku_id,
        s.brand,
        s.size,
        s.is_carton,
        i.quantity,
        i.cost_price,
        i.selling_price,
        i.updated_at,
        (i.quantity * i.selling_price) as total_value
      FROM inventory i
      JOIN skus s ON i.sku_id = s.id
      WHERE i.shop_id = $1 AND s.size = '1L'
      ORDER BY s.brand, s.size`,
      [shop_id]
    );

    // Calculate summary statistics
    const totalItems = result.rows.length;
    const totalQuantity = result.rows.reduce((sum, item) => sum + parseInt(item.quantity), 0);
    const totalValue = result.rows.reduce((sum, item) => sum + parseFloat(item.total_value), 0);

    res.json({
      success: true,
      summary: {
        total_skus: totalItems,
        total_quantity: totalQuantity,
        total_value: totalValue.toFixed(2),
        currency: 'USD'
      },
      inventory: result.rows
    });

  } catch (error) {
    console.error('Get inventory summary error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch inventory', 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Get Single SKU Inventory Details
const getInventoryBySKU = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id } = req.user;
    const { sku_id } = req.params;

    const result = await client.query(
      `SELECT 
        i.id,
        i.sku_id,
        s.brand,
        s.size,
        s.is_carton,
        i.quantity,
        i.cost_price,
        i.selling_price,
        i.updated_at,
        (i.quantity * i.selling_price) as total_value
      FROM inventory i
      JOIN skus s ON i.sku_id = s.id
      WHERE i.shop_id = $1 AND i.sku_id = $2`,
      [shop_id, sku_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found in inventory'
      });
    }

    res.json({
      success: true,
      inventory: result.rows[0]
    });

  } catch (error) {
    console.error('Get inventory by SKU error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch inventory item', 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Record Restock (Supplier Delivery)
const recordRestock = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, id: user_id } = req.user;
    const { 
      sku_id, 
      ordered_qty, 
      received_qty, 
      cost_price, 
      selling_price,
      supplier_name
    } = req.body;

    // Validation
    if (!sku_id || !ordered_qty || !received_qty || !cost_price || !selling_price) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: sku_id, ordered_qty, received_qty, cost_price, selling_price'
      });
    }

    // Validate supplier_name if provided
    if (supplier_name && supplier_name.length > 150) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name must not exceed 150 characters'
      });
    }

    // Start transaction
    await client.query('BEGIN');

    // Calculate discrepancy
    const discrepancy = received_qty - ordered_qty;

    // Record restock in restocks table
    const restockResult = await client.query(
      `INSERT INTO restocks 
        (shop_id, sku_id, ordered_qty, received_qty, cost_price, selling_price, user_id, supplier_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, created_at`,
      [shop_id, sku_id, ordered_qty, received_qty, cost_price, selling_price, user_id, supplier_name || null]
    );

    // Update or insert inventory
    const inventoryResult = await client.query(
      `INSERT INTO inventory (shop_id, sku_id, quantity, cost_price, selling_price)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (shop_id, sku_id) 
      DO UPDATE SET 
        quantity = inventory.quantity + $3,
        cost_price = $4,
        selling_price = $5,
        updated_at = NOW()
      RETURNING quantity`,
      [shop_id, sku_id, received_qty, cost_price, selling_price]
    );

    // Create transaction record
    await client.query(
      `INSERT INTO transactions 
        (shop_id, sku_id, type, quantity, user_id, occurred_at, device_id, meta)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)`,
      [
        shop_id, 
        sku_id, 
        'RESTOCK', 
        received_qty, 
        user_id, 
        'web-dashboard',
        JSON.stringify({ 
          restock_id: restockResult.rows[0].id,
          cost_price,
          selling_price,
          ordered_qty,
          received_qty,
          supplier_name: supplier_name || null
        })
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Restock recorded successfully',
      restock: {
        id: restockResult.rows[0].id,
        ordered_qty,
        received_qty,
        discrepancy,
        supplier_name: supplier_name || null,
        inventory_after: inventoryResult.rows[0].quantity,
        recorded_at: restockResult.rows[0].created_at
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Record restock error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to record restock', 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Record Decant (Carton to Bottles)
const recordDecant = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, id: user_id } = req.user;
    const { 
      from_sku_id,  // Carton SKU
      to_sku_id,    // Bottle SKU
      cartons,
      units_per_carton = 12  // Default: 1 carton = 12 bottles
    } = req.body;

    // Validation
    if (!from_sku_id || !to_sku_id || !cartons) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: from_sku_id, to_sku_id, cartons'
      });
    }

    if (cartons <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Cartons must be greater than 0'
      });
    }

    // Start transaction
    await client.query('BEGIN');

    // Check if enough cartons available
    const cartonInventory = await client.query(
      'SELECT quantity FROM inventory WHERE shop_id = $1 AND sku_id = $2',
      [shop_id, from_sku_id]
    );

    if (cartonInventory.rows.length === 0 || cartonInventory.rows[0].quantity < cartons) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Insufficient carton inventory',
        available: cartonInventory.rows[0]?.quantity || 0,
        requested: cartons
      });
    }

    const units_to_add = cartons * units_per_carton;

    // Record decant
    const decantResult = await client.query(
      `INSERT INTO decants 
        (shop_id, carton_sku_id, unit_sku_id, cartons_used, units_created, user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at`,
      [shop_id, from_sku_id, to_sku_id, cartons, units_to_add, user_id]
    );

    // Deduct cartons
    await client.query(
      `UPDATE inventory 
      SET quantity = quantity - $1, updated_at = NOW()
      WHERE shop_id = $2 AND sku_id = $3`,
      [cartons, shop_id, from_sku_id]
    );

    // Add bottles
    const bottleResult = await client.query(
      `INSERT INTO inventory (shop_id, sku_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (shop_id, sku_id) 
      DO UPDATE SET 
        quantity = inventory.quantity + $3,
        updated_at = NOW()
      RETURNING quantity`,
      [shop_id, to_sku_id, units_to_add]
    );

    // Create transaction records for decant
    await client.query(
      `INSERT INTO transactions 
        (shop_id, sku_id, type, quantity, user_id, occurred_at, device_id, meta)
      VALUES 
        ($1, $2, 'DECANT', $3, $4, NOW(), $5, $6)`,
      [
        shop_id, 
        from_sku_id, 
        -cartons, 
        user_id, 
        'web-dashboard',
        JSON.stringify({ 
          decant_id: decantResult.rows[0].id,
          from_sku_id,
          to_sku_id,
          cartons_removed: cartons,
          units_added: units_to_add
        })
      ]
    );
    
    await client.query(
      `INSERT INTO transactions 
        (shop_id, sku_id, type, quantity, user_id, occurred_at, device_id, meta)
      VALUES ($1, $2, 'DECANT', $3, $4, NOW(), $5, $6)`,
      [
        shop_id, 
        to_sku_id, 
        units_to_add, 
        user_id, 
        'web-dashboard',
        JSON.stringify({ 
          decant_id: decantResult.rows[0].id,
          from_sku_id,
          to_sku_id,
          cartons_removed: cartons,
          units_added: units_to_add
        })
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Decant completed successfully',
      decant: {
        id: decantResult.rows[0].id,
        cartons_removed: cartons,
        units_added: units_to_add,
        bottle_inventory_after: bottleResult.rows[0].quantity,
        performed_at: decantResult.rows[0].created_at
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Record decant error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to record decant', 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

/**
 * Soft Delete SKU (Discontinue Product)
 * Marks SKU as inactive without deleting history
 * Security: Owner only, validates SKU exists
 */
const deleteSKU = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;
    const { sku_id } = req.params;

    // Security: Only owners can delete SKUs
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can delete products'
      });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sku_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid SKU ID format'
      });
    }

    // Check if SKU exists and belongs to this shop (via inventory)
    const skuCheck = await client.query(
      `SELECT s.id, s.brand, s.size, s.is_carton, s.is_active,
              i.quantity, i.selling_price
       FROM skus s
       LEFT JOIN inventory i ON s.id = i.sku_id AND i.shop_id = $1
       WHERE s.id = $2`,
      [shop_id, sku_id]
    );

    if (skuCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const sku = skuCheck.rows[0];

    // Check if already discontinued
    if (!sku.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Product is already discontinued'
      });
    }

    // Warn if there's inventory
    const hasInventory = sku.quantity && sku.quantity > 0;
    const inventoryValue = hasInventory ? (sku.quantity * sku.selling_price) : 0;

    // Soft delete (mark as inactive)
    await client.query(
      `UPDATE skus 
       SET is_active = false, discontinued_at = NOW()
       WHERE id = $1`,
      [sku_id]
    );

    console.log(`[INVENTORY] SKU discontinued: ${sku.brand} ${sku.size} (ID: ${sku_id}) by shop ${shop_id}`);

    res.json({
      success: true,
      message: `Product discontinued: ${sku.brand} ${sku.size} ${sku.is_carton ? '(Carton)' : '(Bottle)'}`,
      discontinued_sku: {
        id: sku.id,
        brand: sku.brand,
        size: sku.size,
        is_carton: sku.is_carton,
        is_active: false
      },
      warning: hasInventory ? {
        message: `This product still has ${sku.quantity} units in inventory worth $${inventoryValue.toFixed(2)}`,
        suggestion: 'Consider selling remaining stock before discontinuing'
      } : null,
      note: 'Product is now hidden from active lists but history is preserved. Use reactivate endpoint to restore.'
    });

  } catch (error) {
    console.error('Delete SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Reactivate SKU (Restore Discontinued Product)
 * Marks previously discontinued SKU as active again
 * Security: Owner only
 */
const reactivateSKU = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;
    const { sku_id } = req.params;

    // Security: Only owners can reactivate SKUs
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can reactivate products'
      });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sku_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid SKU ID format'
      });
    }

    // Check if SKU exists
    const skuCheck = await client.query(
      `SELECT id, brand, size, is_carton, is_active, discontinued_at
       FROM skus
       WHERE id = $1`,
      [sku_id]
    );

    if (skuCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const sku = skuCheck.rows[0];

    // Check if already active
    if (sku.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Product is already active'
      });
    }

    // Reactivate
    await client.query(
      `UPDATE skus 
       SET is_active = true, discontinued_at = NULL
       WHERE id = $1`,
      [sku_id]
    );

    console.log(`[INVENTORY] SKU reactivated: ${sku.brand} ${sku.size} (ID: ${sku_id}) by shop ${shop_id}`);

    res.json({
      success: true,
      message: `Product reactivated: ${sku.brand} ${sku.size} ${sku.is_carton ? '(Carton)' : '(Bottle)'}`,
      reactivated_sku: {
        id: sku.id,
        brand: sku.brand,
        size: sku.size,
        is_carton: sku.is_carton,
        is_active: true
      }
    });

  } catch (error) {
    console.error('Reactivate SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};


/**
 * Update SKU Inventory Details
 * Allows owner to update prices and reorder level for a product
 * Security: Owner only
 */
const updateSKUInventory = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { shop_id, role } = req.user;
    const { sku_id } = req.params;
    const { cost_price, selling_price, reorder_level } = req.body;

    // Security: Only owners can update inventory details
    if (role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        message: 'Only shop owners can update product details'
      });
    }

    // Validation: At least one field must be provided
    if (cost_price === undefined && selling_price === undefined && reorder_level === undefined) {
      return res.status(400).json({
        success: false,
        message: 'At least one field must be provided: cost_price, selling_price, or reorder_level'
      });
    }

    // Validation: Prices must be positive
    if (cost_price !== undefined && cost_price <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Cost price must be greater than 0'
      });
    }

    if (selling_price !== undefined && selling_price <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Selling price must be greater than 0'
      });
    }

    if (reorder_level !== undefined && reorder_level < 0) {
      return res.status(400).json({
        success: false,
        message: 'Reorder level must be 0 or greater'
      });
    }

    // Check if inventory exists for this shop and SKU
    const inventoryCheck = await client.query(
      `SELECT i.id, i.cost_price, i.selling_price, i.reorder_level, i.quantity,
              s.brand, s.size, s.is_carton
       FROM inventory i
       JOIN skus s ON i.sku_id = s.id
       WHERE i.shop_id = $1 AND i.sku_id = $2`,
      [shop_id, sku_id]
    );

    if (inventoryCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in your inventory'
      });
    }

    const currentInventory = inventoryCheck.rows[0];

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (cost_price !== undefined) {
      paramCount++;
      updates.push(`cost_price = $${paramCount}`);
      values.push(cost_price);
    }

    if (selling_price !== undefined) {
      paramCount++;
      updates.push(`selling_price = $${paramCount}`);
      values.push(selling_price);
    }

    if (reorder_level !== undefined) {
      paramCount++;
      updates.push(`reorder_level = $${paramCount}`);
      values.push(reorder_level);
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add WHERE clause parameters
    paramCount++;
    values.push(shop_id);
    const shopIdParam = paramCount;

    paramCount++;
    values.push(sku_id);
    const skuIdParam = paramCount;

    // Execute update
    const updateQuery = `
      UPDATE inventory
      SET ${updates.join(', ')}
      WHERE shop_id = $${shopIdParam} AND sku_id = $${skuIdParam}
      RETURNING id, sku_id, quantity, cost_price, selling_price, reorder_level, updated_at
    `;

    const result = await client.query(updateQuery, values);
    const updatedInventory = result.rows[0];

    // Calculate profit margin
    const profitMargin = ((updatedInventory.selling_price - updatedInventory.cost_price) / updatedInventory.selling_price * 100).toFixed(2);

    console.log(`[INVENTORY] Product updated: ${currentInventory.brand} ${currentInventory.size} by shop ${shop_id}`);

    res.json({
      success: true,
      message: `Product updated: ${currentInventory.brand} ${currentInventory.size}`,
      product: {
        sku_id: updatedInventory.sku_id,
        brand: currentInventory.brand,
        size: currentInventory.size,
        is_carton: currentInventory.is_carton,
        quantity: parseInt(updatedInventory.quantity),
        cost_price: parseFloat(updatedInventory.cost_price),
        selling_price: parseFloat(updatedInventory.selling_price),
        reorder_level: parseInt(updatedInventory.reorder_level),
        profit_margin: parseFloat(profitMargin),
        updated_at: updatedInventory.updated_at
      },
      changes: {
        cost_price: cost_price !== undefined ? {
          old: parseFloat(currentInventory.cost_price),
          new: parseFloat(updatedInventory.cost_price)
        } : null,
        selling_price: selling_price !== undefined ? {
          old: parseFloat(currentInventory.selling_price),
          new: parseFloat(updatedInventory.selling_price)
        } : null,
        reorder_level: reorder_level !== undefined ? {
          old: parseInt(currentInventory.reorder_level),
          new: parseInt(updatedInventory.reorder_level)
        } : null
      }
    });

  } catch (error) {
    console.error('Update SKU inventory error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * Get Low Stock Items
 * Returns products that are at or below reorder level
 * Security: Owner and Staff can view
 */
const getLowStock = async (req, res) => {
  const client = await pool.connect();

  try {
    const { shop_id } = req.user;
    const { severity, brand, sort = 'severity' } = req.query;

    // Base query
    let query = `
      SELECT
        i.sku_id,
        s.brand,
        s.size,
        s.is_carton,
        i.quantity,
        i.reorder_level,
        i.cost_price,
        i.selling_price,
        i.updated_at,
        (
          SELECT MAX(t.occurred_at)
          FROM transactions t
          WHERE t.shop_id = i.shop_id
          AND t.sku_id = i.sku_id
          AND t.type = 'SALE'
        ) as last_sale
      FROM inventory i
      JOIN skus s ON i.sku_id = s.id
      WHERE i.shop_id = $1
      AND s.is_active = true
      AND i.quantity <= i.reorder_level
    `;

    const params = [shop_id];
    let paramCount = 1;

    // Filter by brand if provided
    if (brand) {
      paramCount++;
      query += ` AND s.brand ILIKE $${paramCount}`;
      params.push(`%${brand}%`);
    }

    // Add ordering
    switch (sort) {
      case 'quantity':
        query += ' ORDER BY i.quantity ASC, s.brand, s.size';
        break;
      case 'brand':
        query += ' ORDER BY s.brand, s.size, i.quantity ASC';
        break;
      case 'severity':
      default:
        query += ' ORDER BY (CASE WHEN i.quantity = 0 THEN 0 WHEN i.quantity < (i.reorder_level * 0.5) THEN 1 ELSE 2 END), i.quantity ASC';
        break;
    }

    const result = await client.query(query, params);

    // Process results and add severity levels
    const lowStockItems = result.rows.map(item => {
      const quantity = parseInt(item.quantity);
      const reorderLevel = parseInt(item.reorder_level);

      // Determine severity
      let status, severity_level;
      if (quantity === 0) {
        status = 'OUT_OF_STOCK';
        severity_level = 'CRITICAL';
      } else if (quantity < reorderLevel * 0.5) {
        status = 'URGENT';
        severity_level = 'CRITICAL';
      } else {
        status = 'LOW_STOCK';
        severity_level = 'WARNING';
      }

      // Calculate suggested order quantity (reorder to 2x reorder level)
      const suggestedOrder = Math.max(reorderLevel * 2 - quantity, reorderLevel);

      // Estimate days until stockout (simple calculation based on recent sales)
      let daysUntilStockout = null;
      if (item.last_sale && quantity > 0) {
        // This is a simplified calculation - in production, use sales velocity
        daysUntilStockout = Math.floor(quantity / 5); // Assume 5 units/day average
      } else if (quantity === 0) {
        daysUntilStockout = 0;
      }

      return {
        sku_id: item.sku_id,
        brand: item.brand,
        size: item.size,
        is_carton: item.is_carton,
        quantity,
        reorder_level: reorderLevel,
        status,
        severity: severity_level,
        suggested_order: suggestedOrder,
        cost_per_unit: parseFloat(item.cost_price),
        selling_price: parseFloat(item.selling_price),
        estimated_reorder_cost: (suggestedOrder * parseFloat(item.cost_price)).toFixed(2),
        last_sale: item.last_sale,
        days_until_stockout: daysUntilStockout,
        updated_at: item.updated_at
      };
    });

    // Filter by severity if requested
    let filteredItems = lowStockItems;
    if (severity) {
      const severityUpper = severity.toUpperCase();
      if (severityUpper === 'CRITICAL') {
        filteredItems = lowStockItems.filter(item => item.severity === 'CRITICAL');
      } else if (severityUpper === 'WARNING') {
        filteredItems = lowStockItems.filter(item => item.severity === 'WARNING');
      }
    }

    // Calculate summary
    const summary = {
      critical: lowStockItems.filter(item => item.severity === 'CRITICAL').length,
      warning: lowStockItems.filter(item => item.severity === 'WARNING').length,
      total_items: filteredItems.length,
      total_reorder_value: filteredItems.reduce((sum, item) =>
        sum + parseFloat(item.estimated_reorder_cost), 0
      ).toFixed(2),
      currency: 'USD'
    };

    res.json({
      success: true,
      count: filteredItems.length,
      low_stock_items: filteredItems,
      summary,
      filters_applied: {
        severity: severity || 'all',
        brand: brand || 'all',
        sort
      }
    });

  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch low stock items',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  createSKU,
  getAllSKUs,
  getInventorySummary,
  getInventoryBySKU,
  recordRestock,
  recordDecant,
  deleteSKU,
  reactivateSKU,
  updateSKUInventory,
  getLowStock
};
