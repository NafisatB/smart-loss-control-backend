# Authentication UI Specification for UX/UI Team

**Backend Developer**: Alphi  
**Purpose**: Ensure Figma designs align with backend API structure  
**Last Updated**: February 2026

---

## 🎯 Overview

We have **TWO different authentication flows**:
1. **Owner Flow** - First-time registration with OTP verification
2. **Staff Flow** - QR code linking + 4-digit PIN login

---

## 👤 OWNER AUTHENTICATION FLOW

### Screen 1: Welcome/Landing Screen

**Purpose**: Entry point - user chooses to register or login

**UI Elements:**
```
┌─────────────────────────────────┐
│                                 │
│     [Smart Loss Control Logo]   │
│                                 │
│   Protect Your Cooking Oil      │
│        Business                 │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Register My Shop         │  │ ← New owner
│  │  (Primary Button)         │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Login                    │  │ ← Existing user
│  │  (Secondary Button)       │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend Mapping:**
- No API call yet
- "Register My Shop" → Navigate to Screen 2
- "Login" → Navigate to Screen 5

---

### Screen 2: Owner Registration Form

**Purpose**: Collect owner details and send OTP (Step 1 of 4)

**Required Fields:**

| Field Name | Input Type | Validation | Backend Field | Required |
|------------|-----------|------------|---------------|----------|
| Full Name | Text input | Min 2 chars | `full_name` | Yes |
| Shop Name | Text input | Min 2 chars | `shop_name` | Yes |
| Phone Number | Tel input | Nigerian format (+234...) | `phone` | Yes |

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Register Your Shop (Step 1/4)  │
│                                 │
│  Full Name                      │
│  ┌───────────────────────────┐  │
│  │ Amina Yusuf               │  │
│  └───────────────────────────┘  │
│                                 │
│  Shop Name                      │
│  ┌───────────────────────────┐  │
│  │ Amina Ventures            │  │
│  └───────────────────────────┘  │
│                                 │
│  Phone Number                   │
│  ┌───────────────────────────┐  │
│  │ +234 801 234 5678         │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Send OTP                 │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend API Call:**
```javascript
POST /auth/register-owner
{
  "full_name": "Amina Yusuf",
  "shop_name": "Amina Ventures",
  "phone": "+2348012345678"
}

// Success Response
{
  "success": true,
  "message": "Registration successful! OTP sent to +2348012345678",
  "dev_otp": "1234"  // Only in development mode
}

// Error Response
{
  "success": false,
  "message": "This phone number is already registered. Please use the login endpoint instead."
}
```

**Design Notes:**
- Phone input should auto-format with country code (+234)
- Show loading spinner on "Send OTP" button
- Disable button after click to prevent double submission
- On success, navigate to Screen 3

---

### Screen 3: OTP Verification

**Purpose**: Verify the 4-digit OTP sent to owner's phone (Step 2 of 4)

**Required Fields:**

| Field Name | Input Type | Validation | Backend Field | Required |
|------------|-----------|------------|---------------|----------|
| OTP Code | Number input (4 digits) | Exactly 4 digits | `otp` | Yes |

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Verify Your Phone (Step 2/4)   │
│                                 │
│  We sent a 4-digit code to      │
│  +234 801 234 5678              │
│                                 │
│  Enter OTP Code                 │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │ 1 │ │ 2 │ │ 3 │ │ 4 │       │ ← 4 separate boxes
│  └───┘ └───┘ └───┘ └───┘       │
│                                 │
│  Didn't receive code?           │
│  [Resend OTP]                   │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Verify & Continue        │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend API Call:**
```javascript
POST /auth/verify-otp
{
  "phone": "+2348012345678",
  "otp": "1234"
}

// Success Response
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "role": "OWNER",
    "phone": "+2348012345678",
    "shop_id": "uuid",
    "full_name": "Amina Yusuf"
  }
}

// Error Response
{
  "success": false,
  "message": "Invalid or expired OTP"
}
```

**Design Notes:**
- Auto-focus on first OTP box
- Auto-advance to next box when digit entered
- Show countdown timer (OTP expires in 5 minutes)
- "Resend OTP" should be disabled for 60 seconds after first send
- On success, navigate to Screen 4 (Create PIN)
- **IMPORTANT**: Store phone number temporarily for next step

---

### Screen 4: Create PIN (NEW!)

**Purpose**: Owner creates a 4-digit PIN for daily login (Step 3 of 4)

**Required Fields:**

| Field Name | Input Type | Validation | Backend Field | Required |
|------------|-----------|------------|---------------|----------|
| Create PIN | Number input (4 digits) | Exactly 4 digits | `pin` | Yes |
| Confirm PIN | Number input (4 digits) | Must match PIN | - | Yes |

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Create Your PIN (Step 3/4)     │
│                                 │
│  Create a 4-digit PIN for       │
│  quick daily login              │
│                                 │
│  Create PIN                     │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │ ● │ │ ● │ │ ● │ │ ● │       │ ← Hidden digits
│  └───┘ └───┘ └───┘ └───┘       │
│                                 │
│  Confirm PIN                    │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │ ● │ │ ● │ │ ● │ │ ● │       │
│  └───┘ └───┘ └───┘ └───┘       │
│                                 │
│  💡 You'll use this PIN to      │
│     login daily (no OTP needed) │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Set PIN & Continue       │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend API Call:**
```javascript
POST /auth/set-pin
{
  "phone": "+2348012345678",  // From previous step
  "pin": "1234"
}

// Success Response
{
  "success": true,
  "message": "PIN set successfully. You can now login with your phone and PIN.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "shop_id": "uuid",
    "full_name": "Amina Yusuf",
    "phone": "+2348012345678",
    "role": "OWNER"
  }
}

// Error Response
{
  "success": false,
  "message": "PIN must be exactly 4 digits (0-9)"
}
```

**Design Notes:**
- PIN should be masked (show dots, not numbers)
- Show error if PINs don't match (client-side validation)
- Show error if PIN is not 4 digits
- On success, store the `token` in localStorage
- Navigate to Screen 4B (Success message) or directly to Dashboard

---

### Screen 4B: Registration Complete (Optional Success Screen)

**Purpose**: Confirm successful registration (Step 4 of 4)

**UI Layout:**
```
┌─────────────────────────────────┐
│                                 │
│         ✅                      │
│                                 │
│  Registration Complete!         │
│                                 │
│  Welcome, Amina!                │
│                                 │
│  Your shop "Amina Ventures"     │
│  is now registered.             │
│                                 │
│  You can now login daily with:  │
│  📱 Phone: +234 801 234 5678    │
│  🔐 PIN: ●●●●                   │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Go to Dashboard          │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend Mapping:**
- No API call
- Just navigation to Dashboard
- Token already stored from previous step

---

### Screen 5: Login Choice (NEW!)

**Purpose**: Returning users choose how to login

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Login                          │
│                                 │
│  How do you want to login?      │
│                                 │
│  ┌───────────────────────────┐  │
│  │  👤 Login as Owner        │  │
│  │  (Phone + PIN)            │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  👷 Login as Staff        │  │
│  │  (Name + PIN)             │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend Mapping:**
- No API call yet
- "Login as Owner" → Navigate to Screen 6
- "Login as Staff" → Navigate to Screen 7 (Staff PIN Login)

---

### Screen 6: Owner PIN Login (NEW!)

**Purpose**: Daily login for owners using phone + PIN (no OTP needed!)

**Required Fields:**

| Field Name | Input Type | Validation | Backend Field | Required |
|------------|-----------|------------|---------------|----------|
| Phone Number | Tel input | Nigerian format (+234...) | `phone` | Yes |
| PIN | Number input (4 digits) | Exactly 4 digits | `pin` | Yes |

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Owner Login                    │
│                                 │
│  Phone Number                   │
│  ┌───────────────────────────┐  │
│  │ +234 801 234 5678         │  │
│  └───────────────────────────┘  │
│                                 │
│  Enter Your PIN                 │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │ ● │ │ ● │ │ ● │ │ ● │       │
│  └───┘ └───┘ └───┘ └───┘       │
│                                 │
│  [Forgot PIN?]                  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Login                    │  │
│  └───────────────────────────┘  │
│                                 │
│  💡 No internet needed!         │
│                                 │
└─────────────────────────────────┘
```

**Backend API Call:**
```javascript
POST /auth/login-owner-pin
{
  "phone": "+2348012345678",
  "pin": "1234"
}

// Success Response
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "shop_id": "uuid",
    "full_name": "Amina Yusuf",
    "phone": "+2348012345678",
    "role": "OWNER"
  }
}

// Error Response
{
  "success": false,
  "message": "Invalid phone or PIN"
}
```

**Design Notes:**
- Phone input should auto-format with country code (+234)
- PIN should be masked (show dots)
- Show "Invalid credentials" error if wrong
- On success, store `token` in localStorage
- Navigate to Owner Dashboard
- **OFFLINE CAPABLE**: This works without internet after initial registration!

---

### Screen 6B: Forgot PIN (Future Implementation)

**Purpose**: Reset PIN using OTP verification

**Note**: This will be implemented in the next phase. For now, "Forgot PIN?" can show:
```
"Contact support to reset your PIN"
```

Or implement the flow:
1. Enter phone number
2. Receive OTP
3. Verify OTP
4. Create new PIN

---

### Screen 7: Brand Selection (Optional - Post Registration)

## 👷 STAFF AUTHENTICATION FLOW

### Screen 8: Staff Login Entry

**Purpose**: Staff chooses how to authenticate

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back to Welcome              │
│                                 │
│  Staff Login                    │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Scan QR Code             │  │ ← First time setup
│  │  (Primary Button)         │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Login with PIN           │  │ ← Returning staff
│  │  (Secondary Button)       │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend Mapping:**
- No API call yet
- Just navigation logic

---

### Screen 9A: QR Code Scanner (First Time Staff Setup)

**Purpose**: Staff scans QR code from owner's device to link

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Scan Shop QR Code              │
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │   [Camera Viewfinder]     │  │
│  │                           │  │
│  │   ┌─────────────────┐     │  │
│  │   │  QR Target Box  │     │  │
│  │   └─────────────────┘     │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  Ask your manager to show       │
│  the QR code from their app     │
│                                 │
└─────────────────────────────────┘
```

**Backend Mapping:**
- QR code contains: `SHOPQR-92D8KASJ2` (the `qr_token`)
- After scanning, navigate to Screen 6B

---

### Screen 9B: Staff Details & PIN Setup

**Purpose**: After scanning QR, staff enters their name and creates PIN

**Required Fields:**

| Field Name | Input Type | Validation | Backend Field | Required |
|------------|-----------|------------|---------------|----------|
| Your Name | Text input | Min 2 chars | `staff_name` | Yes |
| Create PIN | Number input | Exactly 4 digits | `pin` | Yes |
| Confirm PIN | Number input | Must match PIN | - | Yes |

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Complete Your Setup            │
│                                 │
│  Your Name                      │
│  ┌───────────────────────────┐  │
│  │ Chinedu                   │  │
│  └───────────────────────────┘  │
│                                 │
│  Create 4-Digit PIN             │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │ ● │ │ ● │ │ ● │ │ ● │       │ ← Hidden digits
│  └───┘ └───┘ └───┘ └───┘       │
│                                 │
│  Confirm PIN                    │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │ ● │ │ ● │ │ ● │ │ ● │       │
│  └───┘ └───┘ └───┘ └───┘       │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Complete Setup           │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend API Call:**
```javascript
POST /auth/staff/link
{
  "qr_token": "SHOPQR-92D8KASJ2",
  "device_id": "android-device-xyz-123",  // Auto-generated by app
  "staff_name": "Chinedu",
  "pin": "4321"
}

// Success Response
{
  "success": true,
  "message": "Staff device linked successfully",
  "staff": {
    "id": "uuid",
    "name": "Chinedu",
    "device_id": "android-device-xyz-123",
    "role": "STAFF"
  }
}

// Error Response
{
  "success": false,
  "message": "Invalid or expired QR code"
}
```

**Design Notes:**
- `device_id` should be auto-generated (use browser fingerprint or UUID)
- PIN should be masked (show dots, not numbers)
- Show error if PINs don't match
- On success, navigate to Staff Dashboard

---

### Screen 10: Staff PIN Login (Returning Staff)

**Purpose**: Daily login for staff who already linked their device

**Required Fields:**

| Field Name | Input Type | Validation | Backend Field | Required |
|------------|-----------|------------|---------------|----------|
| Staff Name | Text input | Min 2 chars | `staff_name` | Yes |
| PIN | Number input | Exactly 4 digits | `pin` | Yes |

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Staff Login                    │
│                                 │
│  Your Name                      │
│  ┌───────────────────────────┐  │
│  │ Chinedu                   │  │
│  └───────────────────────────┘  │
│                                 │
│  Enter Your PIN                 │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │ ● │ │ ● │ │ ● │ │ ● │       │
│  └───┘ └───┘ └───┘ └───┘       │
│                                 │
│  [Forgot PIN?]                  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Login                    │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend API Call:**
```javascript
POST /auth/login-pin
{
  "staff_name": "Chinedu",
  "pin": "4321"
}

// Success Response
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "role": "STAFF",
    "full_name": "Chinedu",
    "shop_id": "uuid"
  }
}

// Error Response
{
  "success": false,
  "message": "Invalid name or PIN"
}
```

**Design Notes:**
- Auto-focus on name input
- PIN should be masked
- Show "Invalid credentials" error if wrong
- On success, store `token` and navigate to Staff Dashboard

---

## 🔐 OWNER SIDE: QR Code Generation Screen

### Screen 11: QR Code Generation (Owner Only)

**UI Layout:**
```
┌─────────────────────────────────┐
│  ← Back to Dashboard            │
│                                 │
│  Add New Staff                  │
│                                 │
│  Show this QR code to your      │
│  staff member to link their     │
│  device                         │
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │   [QR CODE IMAGE]         │  │
│  │                           │  │
│  │   SHOPQR-92D8KASJ2        │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  Expires in: 28:45              │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Generate New Code        │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Backend API Call:**
```javascript
POST /shops/qr-token
Authorization: Bearer <owner_token>

// Response
{
  "success": true,
  "qr_token": "SHOPQR-92D8KASJ2",
  "expires_in_minutes": 30
}
```

**Design Notes:**
- Generate QR code image from `qr_token` string
- Show countdown timer (30 minutes)
- Allow regenerating if expired
- This screen is OWNER-ONLY (requires owner JWT token)

---

## 📋 Summary for UX/UI Team

### Complete Screen Flow:

**Owner Registration Flow (6 screens):**
1. Welcome/Landing (register or login choice)
2. Owner Registration Form (name, shop, phone) → Sends OTP
3. OTP Verification (4-digit code)
4. Create PIN (4-digit PIN setup) ← **NEW!**
5. Registration Complete (success message)
6. Owner Dashboard

**Owner Login Flow (2 screens):**
5. Login Choice (owner or staff)
6. Owner PIN Login (phone + PIN) ← **NEW! Offline-capable**

**Staff Flow (5 screens):**
5. Login Choice (owner or staff)
8. Staff Login Entry (QR or PIN choice)
9A. QR Scanner (camera view)
9B. Staff Setup (name + create PIN)
10. Staff PIN Login (name + PIN)

**Owner Management (1 screen):**
11. QR Code Generation (for adding staff)

### Key Changes from Previous Version:

✅ **NEW Screen 4**: Create PIN after OTP verification  
✅ **NEW Screen 5**: Login choice (Owner vs Staff)  
✅ **NEW Screen 6**: Owner PIN Login (replaces OTP login for daily use)  
✅ **NEW Endpoint**: `POST /auth/set-pin`  
✅ **NEW Endpoint**: `POST /auth/login-owner-pin`  

### Registration vs Login:

**First Time (Registration):**
```
Screen 1 → Screen 2 → Screen 3 → Screen 4 → Dashboard
(Welcome) (Register) (OTP)    (Create PIN)
```

**Daily Login (Returning Owner):**
```
Screen 1 → Screen 5 → Screen 6 → Dashboard
(Welcome) (Choice)  (PIN Login)
```

**Key Benefit**: Owner only needs OTP once during registration. Daily login is fast with PIN (no internet needed)!

### Critical Design Requirements:

✅ **Large Buttons**: Minimum 48x48dp (greasy fingers)  
✅ **High Contrast**: 7:1 ratio (poor lighting in markets)  
✅ **Bold Text**: 18px minimum for numbers/prices  
✅ **Auto-focus**: First input field on each screen  
✅ **Loading States**: Show spinners during API calls  
✅ **Error Messages**: Red text below fields  
✅ **Success Feedback**: Green checkmarks or toast messages  

### Field Validation Rules:

| Field | Min Length | Max Length | Format | Required |
|-------|-----------|-----------|--------|----------|
| Full Name | 2 | 150 | Text | Yes |
| Shop Name | 2 | 150 | Text | Yes |
| Phone | 11 | 20 | +234XXXXXXXXXX | Yes |
| OTP | 4 | 4 | Numbers only | Yes |
| PIN | 4 | 4 | Numbers only | Yes |
| Staff Name | 2 | 150 | Text | Yes |

---

## 🎨 Recommended Color Scheme (From PRD)

- **Primary**: Green (#28A745) - Success, confirmation
- **Danger**: Red (#DC3545) - Alerts, critical deviations
- **Warning**: Orange (#FFC107) - Warnings, pending sync
- **Background**: White (#FFFFFF) or Light Gray (#F8F9FA)
- **Text**: Dark Gray (#212529)
- **Buttons**: High contrast with 2px border

---

**Questions for UX/UI Team?**  
Contact: Alphi (Backend Developer)  
Reference: This document + `docs/FRONTEND_GUIDE.md`
