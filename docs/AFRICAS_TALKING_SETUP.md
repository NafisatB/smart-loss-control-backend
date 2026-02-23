# Africa's Talking SMS Setup Guide

## 🌍 Why Africa's Talking?

- ✅ **Pan-African Coverage**: Kenya, Nigeria, Uganda, Tanzania, Rwanda, Malawi, South Africa, etc.
- ✅ **Sandbox Mode**: Free testing without real SMS costs
- ✅ **Capstone Friendly**: Perfect for student projects
- ✅ **Affordable**: Pay-as-you-go pricing
- ✅ **Good Documentation**: Easy to integrate

---

## 🚀 Quick Setup (5 minutes)

### Step 1: Create Account

1. Go to: https://account.africastalking.com/auth/register
2. Sign up with your email
3. Verify your email address
4. Login to your dashboard

### Step 2: Get Sandbox Credentials

1. After login, you'll be in **Sandbox mode** by default
2. Go to **Settings** → **API Key**
3. Click **Generate API Key**
4. Copy your credentials:
   - **Username**: `sandbox`
   - **API Key**: (copy the generated key)

### Step 3: Configure Your App

Update your `.env` file:

```env
# Africa's Talking Configuration
AT_USERNAME=sandbox
AT_API_KEY=your_actual_api_key_here
AT_SANDBOX=true
AT_SENDER_ID=
```

### Step 4: Test in Sandbox

In sandbox mode, SMS won't be sent to real phones. Instead:
- Messages are logged in your Africa's Talking dashboard
- You can see them under **Sandbox** → **SMS** → **Sent Messages**
- Perfect for testing without costs!

---

## 📱 Sandbox Testing

### How Sandbox Works:

1. **No Real SMS**: Messages aren't sent to actual phones
2. **Dashboard Logs**: View all "sent" messages in your dashboard
3. **Free Testing**: Unlimited testing at no cost
4. **Same API**: Uses the same API as production
5. **Test Phone Numbers Required**: In sandbox, you MUST use Africa's Talking test numbers

### Africa's Talking Test Phone Numbers (Sandbox)

To see messages in the sandbox dashboard, use these test numbers:

**Format**: `+254711XXXYYY` or `+254999999999`

**Examples:**
- `+254711082XXX` (Kenya test number)
- `+254711082001`
- `+254711082002`
- `+254999999999` (Generic test)

**Important:** 
- Regular phone numbers (like `+2349087654321`) will NOT appear in sandbox dashboard
- Only Africa's Talking approved test numbers will show in dashboard
- Check your Africa's Talking sandbox dashboard for the list of approved test numbers

### Test Your Integration:

```bash
# Start your server
npm start

# Test registration with Africa's Talking test number
curl -X POST http://localhost:5000/auth/register-owner \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test Owner",
    "shop_name": "Test Shop",
    "phone": "+254711082001"
  }'
```

**Then check your Africa's Talking dashboard:**
1. Login to https://account.africastalking.com/
2. Go to **Sandbox** → **SMS** → **Inbox** (to receive) or **Sent Messages** (to see what you sent)
3. You should see the OTP message there!

### View Sandbox Messages:

**Step-by-Step:**

1. **Login** to https://account.africastalking.com/
2. Click **"Sandbox"** in the left sidebar (orange button at top)
3. Click **"SMS"** in the left menu
4. Click **"Sent Messages"** to see outgoing SMS

**What you'll see:**
- Date/Time of message
- Phone number (To)
- Message content (including OTP)
- Status
- Cost (always $0 in sandbox)

**Important Notes:**
- Only messages to Africa's Talking test numbers appear here
- Test numbers format: `+254711082XXX` or `+254999999999`
- Regular phone numbers will NOT show in sandbox dashboard
- OTP is NOT returned in API response (check dashboard only)
- For non-test numbers, OTP is logged to server console as fallback

---

## 🎓 For Capstone Demo

### Option 1: Use Sandbox (Recommended)
- Keep `AT_SANDBOX=true`
- Show messages in Africa's Talking dashboard during demo
- Explain: "In production, these would be real SMS"

### Option 2: Use Production (Optional)
- Add credits to your account ($5-10 is enough)
- Change `AT_SANDBOX=false`
- Use your actual phone number for demo
- SMS will be sent to real phones

---

## 💰 Pricing (After Capstone)

### Sandbox:
- **Free** - Unlimited testing

### Production:
- **Kenya**: ~$0.008 per SMS
- **Nigeria**: ~$0.02 per SMS
- **Uganda**: ~$0.01 per SMS
- **Other countries**: Check pricing page

**Example**: 1000 SMS in Kenya = ~$8

---

## 🔧 Production Setup (When Ready)

### Step 1: Go Live

1. Login to Africa's Talking
2. Click **Go Live** button
3. Add payment method
4. Add credits ($5-10 to start)

### Step 2: Get Production Credentials

1. Go to **Settings** → **API Key**
2. Generate a new production API key
3. Your username will change from `sandbox` to your actual username

### Step 3: Update .env

```env
AT_USERNAME=your_actual_username  # Not 'sandbox' anymore
AT_API_KEY=your_production_api_key
AT_SANDBOX=false  # Important!
AT_SENDER_ID=YourBrand  # Optional: Apply for sender ID
```

### Step 4: Test Production

```bash
# Test with your real phone number
curl -X POST http://localhost:5000/auth/register-owner \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Real Test",
    "shop_name": "Real Shop",
    "phone": "+254700000000"  # Your actual number
  }'

# You should receive a real SMS!
```

---

## 🎯 Supported Countries

Africa's Talking works in:

- 🇰🇪 Kenya (+254)
- 🇳🇬 Nigeria (+234)
- 🇺🇬 Uganda (+256)
- 🇹🇿 Tanzania (+255)
- 🇷🇼 Rwanda (+250)
- 🇲🇼 Malawi (+265)
- 🇿🇦 South Africa (+27)
- 🇬🇭 Ghana (+233)
- 🇪🇹 Ethiopia (+251)
- 🇿🇲 Zambia (+260)
- And more...

---

## 🐛 Troubleshooting

### Issue: "Africa's Talking not configured"

**Solution**: Check your `.env` file:
```env
AT_USERNAME=sandbox
AT_API_KEY=your_actual_key  # Not 'your_api_key_here'
```

### Issue: "Invalid API Key"

**Solution**: 
1. Regenerate API key in dashboard
2. Copy the new key (it's shown only once!)
3. Update `.env` file
4. Restart server: `npm start`

### Issue: "Can't see messages in dashboard"

**Solution**:
1. Make sure you're in **Sandbox** mode
2. Go to **Sandbox** → **SMS** → **Sent Messages**
3. Refresh the page
4. Check the date filter

### Issue: "Phone number format error"

**Solution**: Use international format:
- ✅ Correct: `+254712345678`
- ❌ Wrong: `0712345678`
- ❌ Wrong: `254712345678`

---

## 📚 Resources

- **Dashboard**: https://account.africastalking.com/
- **Documentation**: https://developers.africastalking.com/docs/sms/overview
- **API Reference**: https://developers.africastalking.com/docs/sms/sending
- **Pricing**: https://africastalking.com/pricing
- **Support**: support@africastalking.com

---

## ✅ Checklist for Capstone

- [ ] Created Africa's Talking account
- [ ] Generated sandbox API key
- [ ] Updated `.env` file with credentials
- [ ] Tested registration endpoint
- [ ] Verified messages appear in dashboard
- [ ] Prepared demo explanation
- [ ] (Optional) Added production credits for live demo

---

## 🎬 Demo Script

**For your capstone presentation:**

1. **Show Registration**:
   - "When a shop owner registers, we send an OTP via SMS"
   - Make API call to register endpoint
   - Show OTP in console (dev mode)

2. **Show Africa's Talking Dashboard**:
   - "In sandbox mode, messages are logged here"
   - Open dashboard → Sandbox → SMS
   - Show the sent message
   - "In production, this would be a real SMS to the owner's phone"

3. **Explain Benefits**:
   - "Africa's Talking covers 20+ African countries"
   - "Sandbox mode allows free testing"
   - "Production costs are very affordable (~$0.01 per SMS)"

---

**Questions?** Check the docs or contact Africa's Talking support!
