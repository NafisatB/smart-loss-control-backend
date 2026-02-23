# Owner PIN Authentication - Complete UI Flow

## 📱 What We Implemented

Owner authentication now uses **PIN-based login** for daily access (no OTP needed after registration).

---

## 🎯 Complete User Journey: Amina (Owner)

### FIRST TIME REGISTRATION (One-time setup)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  SCREEN 1: Welcome                                          │
│  ┌─────────────────────┐                                    │
│  │ Register My Shop    │ ← Amina clicks here                │
│  └─────────────────────┘                                    │
│  │ Login               │                                    │
│  └─────────────────────┘                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  SCREEN 2: Registration Form (Step 1/4)                     │
│  ┌─────────────────────────────────────────┐                │
│  │ Full Name:    Amina Yusuf               │                │
│  │ Shop Name:    Amina Ventures            │                │
│  │ Phone:        +234 801 234 5678         │                │
│  └─────────────────────────────────────────┘                │
│  [Send OTP] ← Clicks                                        │
│                                                             │
│  API: POST /auth/register-owner                             │
│  Response: OTP sent to phone                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  SCREEN 3: OTP Verification (Step 2/4)                      │
│  We sent a code to +234 801 234 5678                        │
│                                                             │
│  Enter OTP:  ┌───┬───┬───┬───┐                             │
│              │ 1 │ 2 │ 3 │ 4 │ ← Amina enters OTP          │
│              └───┴───┴───┴───┘                             │
│  [Verify & Continue] ← Clicks                               │
│                                                             │
│  API: POST /auth/verify-otp                                 │
│  Response: OTP verified, token received                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  SCREEN 4: Create PIN (Step 3/4) ← NEW!                    │
│  Create a 4-digit PIN for quick daily login                 │
│                                                             │
│  Create PIN:   ┌───┬───┬───┬───┐                           │
│                │ ● │ ● │ ● │ ● │ ← Amina creates PIN       │
│                └───┴───┴───┴───┘                           │
│                                                             │
│  Confirm PIN:  ┌───┬───┬───┬───┐                           │
│                │ ● │ ● │ ● │ ● │ ← Confirms PIN            │
│                └───┴───┴───┴───┘                           │
│                                                             │
│  💡 You'll use this PIN to login daily (no OTP needed)      │
│  [Set PIN & Continue] ← Clicks                              │
│                                                             │
│  API: POST /auth/set-pin                                    │
│  Body: { phone: "+2348012345678", pin: "1234" }            │
│  Response: PIN set, token received                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  SCREEN 5: Registration Complete! ✅                        │
│                                                             │
│  Welcome, Amina!                                            │
│  Your shop "Amina Ventures" is now registered.              │
│                                                             │
│  You can now login daily with:                              │
│  📱 Phone: +234 801 234 5678                                │
│  🔐 PIN: ●●●●                                               │
│                                                             │
│  [Go to Dashboard]                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### DAILY LOGIN (Every day after registration)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  SCREEN 1: Welcome                                          │
│  ┌─────────────────────┐                                    │
│  │ Register My Shop    │                                    │
│  └─────────────────────┘                                    │
│  │ Login               │ ← Amina clicks here                │
│  └─────────────────────┘                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  SCREEN 5: Login Choice                                     │
│  How do you want to login?                                  │
│                                                             │
│  ┌─────────────────────────────────────────┐                │
│  │ 👤 Login as Owner (Phone + PIN)        │ ← Clicks       │
│  └─────────────────────────────────────────┘                │
│  ┌─────────────────────────────────────────┐                │
│  │ 👷 Login as Staff (Name + PIN)         │                │
│  └─────────────────────────────────────────┘                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  SCREEN 6: Owner PIN Login ← NEW!                          │
│                                                             │
│  Phone Number:                                              │
│  ┌─────────────────────────────────────────┐                │
│  │ +234 801 234 5678                       │ ← Enters phone │
│  └─────────────────────────────────────────┘                │
│                                                             │
│  Enter Your PIN:                                            │
│  ┌───┬───┬───┬───┐                                         │
│  │ ● │ ● │ ● │ ● │ ← Enters PIN (1234)                     │
│  └───┴───┴───┴───┘                                         │
│                                                             │
│  [Forgot PIN?]                                              │
│  [Login] ← Clicks                                           │
│                                                             │
│  💡 No internet needed!                                     │
│                                                             │
│  API: POST /auth/login-owner-pin                            │
│  Body: { phone: "+2348012345678", pin: "1234" }            │
│  Response: Token received, login successful                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  OWNER DASHBOARD                                            │
│  Welcome back, Amina! 👋                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 Key Points for UX/UI Team

### Registration Flow (One-time)
1. **Screen 1**: Welcome → Choose "Register My Shop"
2. **Screen 2**: Enter name, shop name, phone → Send OTP
3. **Screen 3**: Enter 4-digit OTP → Verify
4. **Screen 4**: Create 4-digit PIN → Confirm PIN ← **NEW STEP!**
5. **Screen 5**: Success message → Go to Dashboard

### Daily Login Flow (Fast!)
1. **Screen 1**: Welcome → Choose "Login"
2. **Screen 5**: Choose "Login as Owner"
3. **Screen 6**: Enter phone + PIN → Login ← **NEW! No OTP!**
4. Dashboard

---

## 📊 Comparison: Old vs New

### OLD FLOW (OTP Every Time)
```
Login → Enter Phone → Wait for OTP → Enter OTP → Dashboard
        (30 sec wait)  (SMS cost)
```

### NEW FLOW (PIN After Registration)
```
Login → Enter Phone + PIN → Dashboard
        (Instant, offline-capable!)
```

---

## 🎨 Screen Specifications

### Screen 4: Create PIN (NEW!)

**Fields:**
- Create PIN: 4-digit number input (masked with dots)
- Confirm PIN: 4-digit number input (masked with dots)

**Validation:**
- PIN must be exactly 4 digits
- PIN must be numeric only (0-9)
- Confirm PIN must match Create PIN
- Show error if mismatch

**API Endpoint:**
```javascript
POST /auth/set-pin
{
  "phone": "+2348012345678",
  "pin": "1234"
}
```

**Success Response:**
```javascript
{
  "success": true,
  "message": "PIN set successfully. You can now login with your phone and PIN.",
  "token": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "shop_id": "uuid",
    "full_name": "Amina Yusuf",
    "phone": "+2348012345678",
    "role": "OWNER"
  }
}
```

---

### Screen 6: Owner PIN Login (NEW!)

**Fields:**
- Phone Number: Tel input with +234 prefix
- PIN: 4-digit number input (masked with dots)

**Validation:**
- Phone must be valid Nigerian format
- PIN must be exactly 4 digits

**API Endpoint:**
```javascript
POST /auth/login-owner-pin
{
  "phone": "+2348012345678",
  "pin": "1234"
}
```

**Success Response:**
```javascript
{
  "success": true,
  "token": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "shop_id": "uuid",
    "full_name": "Amina Yusuf",
    "phone": "+2348012345678",
    "role": "OWNER"
  }
}
```

**Error Response:**
```javascript
{
  "success": false,
  "message": "Invalid phone or PIN"
}
```

---

## ✅ Benefits

1. **Faster Login**: No waiting for OTP (instant)
2. **Offline Capable**: Works without internet after registration
3. **Cost Savings**: No SMS costs for daily login
4. **Better UX**: Simple 4-digit PIN vs waiting for SMS
5. **Secure**: PIN is hashed with bcrypt, never stored in plain text

---

## 🚀 Implementation Status

✅ Backend API endpoints implemented  
✅ PIN validation (4 digits, numeric only)  
✅ Bcrypt hashing for security  
✅ Database schema ready  
✅ Test scripts created  
⏳ Frontend UI implementation (pending)  
⏳ Forgot PIN flow (future)  

---

## 📝 Notes for Frontend Team

1. **Store phone number** temporarily after OTP verification to use in Screen 4
2. **Validate PIN match** on client-side before calling API
3. **Mask PIN input** with dots (●●●●) for security
4. **Show loading state** during API calls
5. **Store JWT token** in localStorage after successful PIN setup/login
6. **Handle errors** gracefully with user-friendly messages
7. **Auto-focus** on first input field for better UX

---

**Questions?** Contact: Alphi (Backend Developer)
