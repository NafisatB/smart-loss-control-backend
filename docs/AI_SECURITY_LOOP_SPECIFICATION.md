# 🤖 AI Security Loop Specification

## 📋 Document Overview

**Purpose**: Define the mathematical "Truth" and triggers for AI-powered theft detection  
**Target**: Data Science Team Implementation  
**Version**: 1.0  
**Date**: February 2026  

---

## 1️⃣ INVENTORY CALCULATION ENGINE

### 1.1 Expected Stock Formula (The "Truth")

```
Expected_Stock = Initial_Stock + Total_Received - Total_Sold - Total_Decanted_Out + Total_Decanted_In
```

#### Detailed Breakdown:

```python
# For each SKU at any point in time:

Expected_Stock = (
    Initial_Stock                           # Opening balance
    + SUM(Restock.quantity_received)        # All supplier deliveries
    - SUM(Sales.quantity)                   # All units sold
    - SUM(Decant.quantity_from)             # Units converted FROM (cartons → bottles)
    + SUM(Decant.quantity_to)               # Units converted TO (cartons → bottles)
)

# Where:
# - Initial_Stock: inventory.quantity at start of period
# - Restock.quantity_received: from restocks table
# - Sales.quantity: from transactions table WHERE type = 'SALE'
# - Decant.quantity_from: from decants table (source SKU)
# - Decant.quantity_to: from decants table (target SKU)
```

#### Example Calculation:

```
Scenario: Fortune Cooking Oil 5L Bottles

Initial_Stock = 50 bottles
Cartons_Received = 10 cartons × 12 bottles/carton = 120 bottles
Units_Sold = 85 bottles
Decant_In = 5 cartons × 12 = 60 bottles (from carton SKU)

Expected_Stock = 50 + 120 - 85 + 60 = 145 bottles

If Physical_Count = 143 bottles
Variance = 143 - 145 = -2 bottles (SHORTAGE)
Variance_Percent = (-2 / 145) × 100 = -1.38%
```

---

### 1.2 Database Query Implementation

```sql
-- Calculate Expected Stock for a specific SKU
WITH stock_movements AS (
  SELECT 
    sku_id,
    -- Initial stock (from inventory table)
    (SELECT quantity FROM inventory WHERE sku_id = $1 AND shop_id = $2) as initial_stock,
    
    -- Total received from suppliers
    COALESCE(SUM(quantity_received) FILTER (WHERE type = 'RESTOCK'), 0) as total_received,
    
    -- Total sold
    COALESCE(SUM(ABS(quantity)) FILTER (WHERE type = 'SALE'), 0) as total_sold,
    
    -- Total decanted out (cartons broken)
    COALESCE(SUM(quantity) FILTER (WHERE type = 'DECANT_OUT'), 0) as total_decanted_out,
    
    -- Total decanted in (bottles created)
    COALESCE(SUM(quantity) FILTER (WHERE type = 'DECANT_IN'), 0) as total_decanted_in
    
  FROM transactions
  WHERE sku_id = $1 
    AND shop_id = $2
    AND occurred_at >= $3  -- Start of period
    AND occurred_at <= $4  -- End of period
  GROUP BY sku_id
)
SELECT 
  sku_id,
  initial_stock,
  total_received,
  total_sold,
  total_decanted_out,
  total_decanted_in,
  (initial_stock + total_received - total_sold - total_decanted_out + total_decanted_in) as expected_stock
FROM stock_movements;
```

---

## 2️⃣ ANOMALY TRIGGER LOGIC

### 2.1 Variance Thresholds

```python
# Variance Calculation
Variance = Physical_Count - Expected_Stock
Variance_Percent = (Variance / Expected_Stock) × 100

# Alert Levels
if abs(Variance_Percent) >= 10.0:
    Alert_Level = "CRITICAL"      # Red Alert - Immediate action
    Estimated_Loss = abs(Variance) × Unit_Cost_USD
    Action = "MANDATORY_RECOUNT + OWNER_NOTIFICATION"
    
elif abs(Variance_Percent) >= 5.0:
    Alert_Level = "WARNING"       # Yellow Alert - Investigation needed
    Estimated_Loss = abs(Variance) × Unit_Cost_USD
    Action = "SCHEDULE_RECOUNT + LOG_ALERT"
    
elif abs(Variance_Percent) >= 1.0:
    Alert_Level = "MINOR"         # Orange Alert - Monitor
    Estimated_Loss = abs(Variance) × Unit_Cost_USD
    Action = "LOG_ALERT + INCREASE_MONITORING"
    
else:
    Alert_Level = "NORMAL"        # Green - No action
    Action = "CONTINUE_MONITORING"
```

### 2.2 Statistical Thresholds

| Variance % | Alert Level | Color | Action | Notification |
|------------|-------------|-------|--------|--------------|
| ≥ 10% | CRITICAL | 🔴 Red | Mandatory recount + Lock system | WhatsApp + SMS |
| 5% - 9.9% | WARNING | 🟡 Yellow | Schedule recount within 2 hours | WhatsApp |
| 1% - 4.9% | MINOR | 🟠 Orange | Increase monitoring frequency | Dashboard only |
| < 1% | NORMAL | 🟢 Green | Continue normal operations | None |

### 2.3 Financial Loss Calculation

```python
# Estimated Financial Loss
Estimated_Loss_USD = abs(Variance) × Unit_Cost_USD

# Example:
# Variance = -15 bottles
# Unit_Cost = $4.50
# Estimated_Loss = 15 × $4.50 = $67.50

# Alert Message:
"🚨 CRITICAL ALERT: Missing 15 units of Fortune 5L. 
Estimated Loss: $67.50. 
Immediate recount required."
```

---

## 3️⃣ TRIGGER FREQUENCY LOGIC

### 3.1 Three-Tier Trigger System

```python
class SpotCheckTrigger:
    def should_trigger_count(self, sku_id, shop_id):
        """
        Determines if a spot check should be triggered
        Returns: (should_trigger: bool, reason: str, priority: int)
        """
        
        # Priority 1: RANDOM TRIGGER (Baseline Security)
        if self.random_trigger():
            return (True, "RANDOM_SECURITY_CHECK", 1)
        
        # Priority 2: VOLUME-BASED TRIGGER (High Activity)
        if self.volume_trigger(sku_id, shop_id):
            return (True, "HIGH_VOLUME_DETECTED", 2)
        
        # Priority 3: TIME-BASED TRIGGER (Scheduled)
        if self.time_trigger(sku_id, shop_id):
            return (True, "SCHEDULED_COUNT", 3)
        
        # Priority 4: ANOMALY-BASED TRIGGER (Suspicious Pattern)
        if self.anomaly_trigger(sku_id, shop_id):
            return (True, "SUSPICIOUS_PATTERN_DETECTED", 4)
        
        return (False, "NO_TRIGGER", 0)
```

### 3.2 Random Trigger (Baseline)

```python
def random_trigger(self):
    """
    Random spot checks to maintain unpredictability
    Frequency: 5-10% of all transactions
    """
    import random
    
    # 7.5% chance of triggering on any transaction
    trigger_probability = 0.075
    
    return random.random() < trigger_probability

# Implementation:
# - Triggers randomly after sales transactions
# - Prevents staff from predicting when counts occur
# - Maintains baseline security posture
```

### 3.3 Volume-Based Trigger (High Activity)

```python
def volume_trigger(self, sku_id, shop_id):
    """
    Triggers when sales volume exceeds normal patterns
    Frequency: When hourly sales > 2× average
    """
    
    # Get average hourly sales for this SKU (last 7 days)
    avg_hourly_sales = get_average_hourly_sales(sku_id, shop_id, days=7)
    
    # Get current hour sales
    current_hour_sales = get_current_hour_sales(sku_id, shop_id)
    
    # Trigger if current hour > 2× average
    threshold_multiplier = 2.0
    
    if current_hour_sales > (avg_hourly_sales * threshold_multiplier):
        return True
    
    return False

# Example:
# Average hourly sales: 12 units/hour
# Current hour sales: 28 units
# 28 > (12 × 2) = 28 > 24 → TRIGGER!
```

### 3.4 Time-Based Trigger (Scheduled)

```python
def time_trigger(self, sku_id, shop_id):
    """
    Scheduled counts at specific times
    Frequency: 3 times per day (morning, afternoon, evening)
    """
    from datetime import datetime
    
    current_hour = datetime.now().hour
    
    # Trigger times: 9 AM, 2 PM, 6 PM
    trigger_hours = [9, 14, 18]
    
    # Check if we're within 5 minutes of trigger time
    if current_hour in trigger_hours:
        last_count_time = get_last_count_time(sku_id, shop_id)
        
        # Only trigger if no count in last hour
        if (datetime.now() - last_count_time).seconds > 3600:
            return True
    
    return False

# Schedule:
# - 9:00 AM: Morning count (after opening)
# - 2:00 PM: Afternoon count (mid-shift)
# - 6:00 PM: Evening count (before closing)
```

### 3.5 Anomaly-Based Trigger (Suspicious Patterns)

```python
def anomaly_trigger(self, sku_id, shop_id):
    """
    Detects suspicious patterns that indicate potential theft
    Frequency: When pattern detected
    """
    
    # Pattern 1: End-of-shift spike
    if self.detect_end_of_shift_spike(sku_id, shop_id):
        return True
    
    # Pattern 2: Unusual time sales
    if self.detect_unusual_time_sales(sku_id, shop_id):
        return True
    
    # Pattern 3: Consecutive high-value sales
    if self.detect_consecutive_high_sales(sku_id, shop_id):
        return True
    
    # Pattern 4: Sales without corresponding inventory decrease
    if self.detect_inventory_mismatch(sku_id, shop_id):
        return True
    
    return False
```

---

## 4️⃣ THEFT PATTERN MARKERS

### 4.1 Suspect Behavior #1: End-of-Shift Spike

```python
def detect_end_of_shift_spike(sku_id, shop_id):
    """
    Detects high volume of sales logged just before shift ends
    Red Flag: Staff may be logging fake sales to cover theft
    """
    
    # Get shift end time (e.g., 6 PM)
    shift_end_hour = 18
    current_hour = datetime.now().hour
    
    # Check if we're in last hour of shift
    if current_hour == shift_end_hour - 1:
        
        # Get sales in last 30 minutes
        last_30min_sales = get_sales_last_n_minutes(sku_id, shop_id, 30)
        
        # Get average sales per 30 minutes
        avg_30min_sales = get_average_sales_per_30min(sku_id, shop_id)
        
        # Trigger if last 30 min > 3× average
        if last_30min_sales > (avg_30min_sales * 3):
            log_suspicious_activity(
                sku_id=sku_id,
                shop_id=shop_id,
                pattern="END_OF_SHIFT_SPIKE",
                severity="HIGH",
                details=f"Sales spike detected: {last_30min_sales} units in last 30 min (avg: {avg_30min_sales})"
            )
            return True
    
    return False

# Example:
# Normal: 5 units per 30 minutes
# Last 30 min: 18 units
# 18 > (5 × 3) = 18 > 15 → SUSPICIOUS!
```

### 4.2 Suspect Behavior #2: Unusual Time Sales

```python
def detect_unusual_time_sales(sku_id, shop_id):
    """
    Detects sales logged during unusual hours
    Red Flag: Sales logged when shop should be closed
    """
    
    current_hour = datetime.now().hour
    
    # Shop hours: 8 AM - 8 PM
    shop_open_hour = 8
    shop_close_hour = 20
    
    # Check if sale logged outside business hours
    if current_hour < shop_open_hour or current_hour >= shop_close_hour:
        
        # Get sales in last 10 minutes
        recent_sales = get_sales_last_n_minutes(sku_id, shop_id, 10)
        
        if recent_sales > 0:
            log_suspicious_activity(
                sku_id=sku_id,
                shop_id=shop_id,
                pattern="UNUSUAL_TIME_SALES",
                severity="CRITICAL",
                details=f"{recent_sales} units sold at {current_hour}:00 (outside business hours)"
            )
            return True
    
    return False
```

### 4.3 Suspect Behavior #3: Consecutive High-Value Sales

```python
def detect_consecutive_high_sales(sku_id, shop_id):
    """
    Detects multiple large sales in quick succession
    Red Flag: May indicate bulk theft being logged as sales
    """
    
    # Get last 5 sales
    last_5_sales = get_last_n_sales(sku_id, shop_id, 5)
    
    # Check if all sales are "large" (> 10 units)
    large_sale_threshold = 10
    
    large_sales_count = sum(1 for sale in last_5_sales if sale.quantity > large_sale_threshold)
    
    # Check if all 5 sales occurred within 15 minutes
    time_window_minutes = 15
    time_span = (last_5_sales[0].timestamp - last_5_sales[-1].timestamp).seconds / 60
    
    if large_sales_count >= 4 and time_span <= time_window_minutes:
        log_suspicious_activity(
            sku_id=sku_id,
            shop_id=shop_id,
            pattern="CONSECUTIVE_HIGH_SALES",
            severity="HIGH",
            details=f"{large_sales_count} large sales (>{large_sale_threshold} units) in {time_span:.1f} minutes"
        )
        return True
    
    return False

# Example:
# Sale 1: 15 units at 14:00
# Sale 2: 12 units at 14:03
# Sale 3: 18 units at 14:07
# Sale 4: 11 units at 14:10
# Sale 5: 14 units at 14:12
# → 5 large sales in 12 minutes → SUSPICIOUS!
```

### 4.4 Suspect Behavior #4: Inventory Mismatch Pattern

```python
def detect_inventory_mismatch(sku_id, shop_id):
    """
    Detects pattern where sales are logged but inventory doesn't decrease proportionally
    Red Flag: Fake sales to cover theft
    """
    
    # Get sales in last hour
    last_hour_sales = get_sales_last_n_minutes(sku_id, shop_id, 60)
    
    # Get actual inventory decrease in last hour
    inventory_start = get_inventory_at_time(sku_id, shop_id, 60)  # 60 min ago
    inventory_now = get_current_inventory(sku_id, shop_id)
    actual_decrease = inventory_start - inventory_now
    
    # Calculate expected decrease (should match sales)
    expected_decrease = last_hour_sales
    
    # Check for significant mismatch (> 20% difference)
    if expected_decrease > 0:
        mismatch_percent = abs(actual_decrease - expected_decrease) / expected_decrease * 100
        
        if mismatch_percent > 20:
            log_suspicious_activity(
                sku_id=sku_id,
                shop_id=shop_id,
                pattern="INVENTORY_MISMATCH",
                severity="CRITICAL",
                details=f"Sales logged: {expected_decrease} units, Actual decrease: {actual_decrease} units ({mismatch_percent:.1f}% mismatch)"
            )
            return True
    
    return False

# Example:
# Sales logged: 25 units
# Actual inventory decrease: 18 units
# Mismatch: (25 - 18) / 25 × 100 = 28% → SUSPICIOUS!
```

---

## 5️⃣ DATA SIMULATION MODEL

### 5.1 Sample Dataset Structure

```json
{
  "simulation_period": "24_hours",
  "shop_id": "shop-uuid-123",
  "sku": {
    "id": "sku-uuid-456",
    "brand": "Fortune",
    "size": "5L",
    "category": "RETAIL",
    "unit_cost_usd": 4.50,
    "selling_price_usd": 5.00
  },
  "initial_state": {
    "timestamp": "2026-02-23T08:00:00Z",
    "physical_count": 150,
    "expected_stock": 150,
    "variance": 0
  },
  "events": [
    {
      "timestamp": "2026-02-23T08:30:00Z",
      "type": "RESTOCK",
      "quantity": 60,
      "notes": "Supplier delivery - 5 cartons × 12 bottles",
      "expected_stock_after": 210
    },
    {
      "timestamp": "2026-02-23T09:15:00Z",
      "type": "SALE",
      "quantity": 3,
      "staff": "Ibrahim Yusuf",
      "expected_stock_after": 207
    },
    {
      "timestamp": "2026-02-23T09:45:00Z",
      "type": "SALE",
      "quantity": 2,
      "staff": "Ibrahim Yusuf",
      "expected_stock_after": 205
    },
    {
      "timestamp": "2026-02-23T10:20:00Z",
      "type": "SALE",
      "quantity": 5,
      "staff": "Aisha Bello",
      "expected_stock_after": 200
    },
    {
      "timestamp": "2026-02-23T11:00:00Z",
      "type": "DECANT",
      "from_sku": "carton-sku-uuid",
      "to_sku": "bottle-sku-uuid",
      "cartons": 3,
      "bottles_created": 36,
      "notes": "Breaking 3 cartons for retail",
      "expected_stock_after": 236
    },
    {
      "timestamp": "2026-02-23T11:30:00Z",
      "type": "SALE",
      "quantity": 8,
      "staff": "Ibrahim Yusuf",
      "expected_stock_after": 228
    },
    {
      "timestamp": "2026-02-23T14:00:00Z",
      "type": "SPOT_CHECK",
      "trigger_reason": "TIME_BASED",
      "physical_count": 227,
      "expected_stock": 228,
      "variance": -1,
      "variance_percent": -0.44,
      "alert_level": "NORMAL",
      "notes": "1-unit discrepancy detected - within acceptable range"
    },
    {
      "timestamp": "2026-02-23T14:30:00Z",
      "type": "SALE",
      "quantity": 12,
      "staff": "Aisha Bello",
      "expected_stock_after": 215
    },
    {
      "timestamp": "2026-02-23T17:45:00Z",
      "type": "SUSPICIOUS_ACTIVITY",
      "pattern": "END_OF_SHIFT_SPIKE",
      "details": "15 units sold in last 30 minutes (avg: 4 units)",
      "action": "MANDATORY_COUNT_TRIGGERED"
    },
    {
      "timestamp": "2026-02-23T17:50:00Z",
      "type": "MANDATORY_COUNT",
      "trigger_reason": "SUSPICIOUS_PATTERN",
      "physical_count": 198,
      "expected_stock": 215,
      "variance": -17,
      "variance_percent": -7.91,
      "alert_level": "WARNING",
      "estimated_loss_usd": 76.50,
      "action": "OWNER_NOTIFIED"
    }
  ],
  "final_state": {
    "timestamp": "2026-02-24T08:00:00Z",
    "physical_count": 198,
    "expected_stock": 215,
    "total_variance": -17,
    "variance_percent": -7.91,
    "estimated_loss_usd": 76.50,
    "alerts_triggered": 1,
    "spot_checks_performed": 2
  }
}
```

### 5.2 CSV Format (for Data Science Team)

```csv
timestamp,event_type,quantity,staff,expected_stock,physical_count,variance,variance_percent,alert_level,notes
2026-02-23T08:00:00Z,INITIAL_STATE,0,,150,150,0,0.00,NORMAL,Opening balance
2026-02-23T08:30:00Z,RESTOCK,60,,210,,,,,Supplier delivery
2026-02-23T09:15:00Z,SALE,3,Ibrahim Yusuf,207,,,,,
2026-02-23T09:45:00Z,SALE,2,Ibrahim Yusuf,205,,,,,
2026-02-23T10:20:00Z,SALE,5,Aisha Bello,200,,,,,
2026-02-23T11:00:00Z,DECANT,36,,236,,,,,3 cartons broken
2026-02-23T11:30:00Z,SALE,8,Ibrahim Yusuf,228,,,,,
2026-02-23T14:00:00Z,SPOT_CHECK,0,,228,227,-1,-0.44,NORMAL,Time-based trigger
2026-02-23T14:30:00Z,SALE,12,Aisha Bello,215,,,,,
2026-02-23T17:45:00Z,SUSPICIOUS_ACTIVITY,15,Ibrahim Yusuf,200,,,,,End-of-shift spike
2026-02-23T17:50:00Z,MANDATORY_COUNT,0,,200,198,-2,-1.00,MINOR,Pattern-triggered count
2026-02-23T18:00:00Z,FINAL_STATE,0,,198,198,0,0.00,NORMAL,End of day
```

---

## 6️⃣ AI DETECTION ACCURACY

### 6.1 Proof of 1-Unit Discrepancy Detection

```python
# Test Case: Detect 1-unit theft

# Initial State
expected_stock = 150
physical_count = 150
variance = 0

# Event: Sale of 5 units
expected_stock = 150 - 5 = 145

# Event: Theft of 1 unit (not logged)
physical_count = 145 - 1 = 144  # Actual physical count

# Spot Check Triggered
variance = physical_count - expected_stock
variance = 144 - 145 = -1

variance_percent = (variance / expected_stock) × 100
variance_percent = (-1 / 145) × 100 = -0.69%

# Detection Result
if abs(variance_percent) >= 0.5:  # 0.5% threshold for detection
    alert = "DISCREPANCY_DETECTED"
    message = "1-unit shortage detected (-0.69%)"
    
# ✅ PROOF: System can detect even 1-unit discrepancies!
```

### 6.2 Sensitivity Analysis

| Stock Level | 1-Unit Variance % | Detectable? |
|-------------|-------------------|-------------|
| 50 units | 2.00% | ✅ Yes (MINOR) |
| 100 units | 1.00% | ✅ Yes (MINOR) |
| 150 units | 0.67% | ✅ Yes (if threshold ≤ 0.67%) |
| 200 units | 0.50% | ✅ Yes (if threshold ≤ 0.50%) |
| 500 units | 0.20% | ⚠️ Requires lower threshold |

**Recommendation**: Set detection threshold at **0.5%** to catch 1-unit discrepancies for stock levels up to 200 units.

---

## 7️⃣ IMPLEMENTATION ROADMAP

### Phase 1: Core Detection (Week 1-2)
- [ ] Implement Expected_Stock calculation engine
- [ ] Implement variance detection logic
- [ ] Create alert generation system
- [ ] Test with sample dataset

### Phase 2: Trigger System (Week 3-4)
- [ ] Implement random trigger
- [ ] Implement volume-based trigger
- [ ] Implement time-based trigger
- [ ] Test trigger frequency

### Phase 3: Pattern Detection (Week 5-6)
- [ ] Implement end-of-shift spike detection
- [ ] Implement unusual time sales detection
- [ ] Implement consecutive high sales detection
- [ ] Implement inventory mismatch detection

### Phase 4: Integration & Testing (Week 7-8)
- [ ] Integrate with backend API
- [ ] Create dashboard visualizations
- [ ] Perform accuracy testing
- [ ] Deploy to production

---

## 8️⃣ API ENDPOINTS TO IMPLEMENT

### 8.1 Trigger Spot Check
```
GET /ai/trigger-count?sku_id={sku_id}

Response:
{
  "success": true,
  "should_prompt": true,
  "sku_id": "uuid",
  "reason": "VOLUME_BASED_TRIGGER",
  "priority": 2,
  "message": "High sales volume detected. Please verify stock count."
}
```

### 8.2 Verify Physical Count
```
POST /audit/verify
{
  "sku_id": "uuid",
  "physical_count": 143,
  "counted_at": "2026-02-23T14:00:00Z"
}

Response:
{
  "success": true,
  "expected_stock": 145,
  "physical_count": 143,
  "variance": -2,
  "variance_percent": -1.38,
  "alert_level": "MINOR",
  "estimated_loss_usd": 9.00,
  "alert_triggered": true,
  "alert_id": "alert-uuid"
}
```

---

## 9️⃣ SUCCESS METRICS

### Key Performance Indicators (KPIs):

1. **Detection Accuracy**: ≥ 95% of theft incidents detected
2. **False Positive Rate**: ≤ 5% of alerts are false alarms
3. **Detection Speed**: Theft detected within 2 hours
4. **Coverage**: 100% of high-value SKUs monitored
5. **Response Time**: Owner notified within 5 minutes of critical alert

---

## 🎯 SUMMARY FOR DATA SCIENCE TEAM

### What You Need to Build:

1. **Calculation Engine**: Expected_Stock formula with all transaction types
2. **Threshold Logic**: 4-tier alert system (Normal, Minor, Warning, Critical)
3. **Trigger System**: 4 trigger types (Random, Volume, Time, Anomaly)
4. **Pattern Detection**: 4 suspicious behavior patterns
5. **Accuracy**: Detect 1-unit discrepancies (0.5% threshold)

### Deliverables:

- [ ] Python/R implementation of all formulas
- [ ] Sample dataset (CSV) with 24-hour simulation
- [ ] Test results proving 1-unit detection
- [ ] API integration specifications
- [ ] Dashboard mockups for alerts

---

**Ready for Data Science Team Implementation! 🚀**

