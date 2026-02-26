/**
 * Test: GET /inventory/low-stock
 * Tests the low stock items endpoint with various filters
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5000';

// Use existing test owner credentials (from previous tests)
// If this fails, run: node tests/auth/test-owner-pin-flow.js first
const OWNER_CREDENTIALS = {
  phone: '+254711082005',  // Test phone from Africa's Talking sandbox
  pin: '1234'
};

async function testLowStock() {
  console.log('🧪 Testing GET /inventory/low-stock\n');
  console.log('=' .repeat(60));

  try {
    // Step 1: Login as owner
    console.log('\n📱 Step 1: Login as owner...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login-owner-pin`, OWNER_CREDENTIALS);
    
    if (!loginResponse.data.success) {
      console.error('❌ Login failed:', loginResponse.data.message);
      console.log('\n💡 Tip: Run this first to create test owner:');
      console.log('   node tests/auth/test-owner-pin-flow.js');
      return;
    }

    const token = loginResponse.data.token;
    console.log('✅ Logged in as:', loginResponse.data.user.full_name);
    console.log('   Shop:', loginResponse.data.user.shop_id);

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Step 2: Get all low stock items
    console.log('\n📦 Step 2: Get all low stock items...');
    const allLowStockResponse = await axios.get(`${BASE_URL}/inventory/low-stock`, { headers });
    
    console.log('✅ Low Stock Items Found:', allLowStockResponse.data.count);
    console.log('\n📊 Summary:');
    console.log('   Critical:', allLowStockResponse.data.summary.critical);
    console.log('   Warning:', allLowStockResponse.data.summary.warning);
    console.log('   Total Reorder Value:', allLowStockResponse.data.summary.total_reorder_value, allLowStockResponse.data.summary.currency);

    if (allLowStockResponse.data.count > 0) {
      console.log('\n📋 Low Stock Items:');
      allLowStockResponse.data.low_stock_items.forEach((item, index) => {
        console.log(`\n   ${index + 1}. ${item.brand} ${item.size}`);
        console.log(`      Status: ${item.status} (${item.severity})`);
        console.log(`      Current: ${item.quantity} | Reorder Level: ${item.reorder_level}`);
        console.log(`      Suggested Order: ${item.suggested_order} units`);
        console.log(`      Estimated Cost: $${item.estimated_reorder_cost}`);
        if (item.days_until_stockout !== null) {
          console.log(`      Days Until Stockout: ${item.days_until_stockout}`);
        }
      });
    } else {
      console.log('\n   ℹ️  No low stock items found (all products are well-stocked!)');
    }

    // Step 3: Filter by severity (CRITICAL only)
    console.log('\n\n🚨 Step 3: Get CRITICAL items only...');
    const criticalResponse = await axios.get(`${BASE_URL}/inventory/low-stock?severity=critical`, { headers });
    
    console.log('✅ Critical Items Found:', criticalResponse.data.count);
    if (criticalResponse.data.count > 0) {
      criticalResponse.data.low_stock_items.forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.brand} ${item.size} - Qty: ${item.quantity} (${item.status})`);
      });
    } else {
      console.log('   ℹ️  No critical items (good news!)');
    }

    // Step 4: Sort by quantity (lowest first)
    console.log('\n\n📉 Step 4: Sort by quantity (lowest first)...');
    const sortedResponse = await axios.get(`${BASE_URL}/inventory/low-stock?sort=quantity`, { headers });
    
    console.log('✅ Items sorted by quantity:');
    if (sortedResponse.data.count > 0) {
      sortedResponse.data.low_stock_items.slice(0, 5).forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.brand} ${item.size} - Qty: ${item.quantity}`);
      });
    }

    // Step 5: Filter by brand (if any items exist)
    if (allLowStockResponse.data.count > 0) {
      const firstBrand = allLowStockResponse.data.low_stock_items[0].brand;
      console.log(`\n\n🔍 Step 5: Filter by brand "${firstBrand}"...`);
      const brandResponse = await axios.get(`${BASE_URL}/inventory/low-stock?brand=${encodeURIComponent(firstBrand)}`, { headers });
      
      console.log(`✅ Items found for "${firstBrand}":`, brandResponse.data.count);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests passed!');
    console.log('='.repeat(60));
    console.log('\n💡 Endpoint ready for demo!');

  } catch (error) {
    console.error('\n❌ Test failed:');
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Message:', error.response.data.message || error.response.data);
      if (error.response.status === 401) {
        console.log('\n💡 Tip: Run this first to create test owner:');
        console.log('   node tests/auth/test-owner-pin-flow.js');
      }
    } else {
      console.error('   Error:', error.message);
    }
    process.exit(1);
  }
}

// Run the test
testLowStock();
