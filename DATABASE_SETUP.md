# Database Setup Guide
## Dental Practice Management System - Complete Database Deployment

This guide walks you through setting up the complete database schema for the Dental Practice Management System using Supabase.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Supabase Project Setup](#supabase-project-setup)
3. [Schema Deployment](#schema-deployment)
4. [Initial Data Setup](#initial-data-setup)
5. [Microsoft Entra Integration Setup](#microsoft-entra-integration-setup)
6. [Configuration](#configuration)
7. [Verification](#verification)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

**Required:**
- Supabase account (free tier works): https://supabase.com
- Microsoft Entra tenant (formerly Azure AD) for SSO authentication
- Basic understanding of PostgreSQL

**Optional:**
- Database client (DBeaver, pgAdmin) for advanced management
- Postman or similar for API testing

---

## Supabase Project Setup

### Step 1: Create a New Project

1. Log in to https://app.supabase.com
2. Click **"New Project"**
3. Fill in project details:
   - **Name**: `dental-app` (or your preferred name)
   - **Database Password**: Generate a strong password (save this!)
   - **Region**: Choose closest to your users
   - **Pricing Plan**: Free tier is sufficient for testing

4. Click **"Create new project"**
5. Wait 2-3 minutes for project provisioning

### Step 2: Get Connection Details

Once the project is ready:

1. Go to **Settings** → **Database**
2. Note these values (you'll need them later):
   - **Connection String** (URI)
   - **Project URL**
   - **Project API Key** (anon/public key)
   - **Service Role Key** (keep secure!)

Example:
```
Project URL: https://abcdefghijklmnop.supabase.co
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Service Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Schema Deployment

Deploy the database schema in **3 stages** using the SQL Editor.

### Stage 1: Core Schema (Foundation)

**File:** `database-schema.sql`

1. Go to **SQL Editor** in Supabase dashboard
2. Click **"New Query"**
3. Copy the entire contents of `database-schema.sql`
4. Paste into the editor
5. Click **"Run"** (⌘/Ctrl + Enter)

**This creates:**
- ✅ Core tables: `profiles`, `clinics`, `patients`, `appointments`, `treatments`, `invoices`, `invoice_items`
- ✅ Row Level Security policies
- ✅ Indexes for performance
- ✅ Triggers for `updated_at` timestamps
- ✅ Helper functions (patient number, invoice number generation)
- ✅ Default clinic seed data

**Expected Output:**
```
Success. No rows returned.
```

### Stage 2: Clinical Records Extension (Part 4)

**File:** `part4-schema-extension.sql`

1. Create a **new query** in SQL Editor
2. Copy contents of `part4-schema-extension.sql`
3. Paste and **Run**

**This creates:**
- ✅ `clinical_notes` - Visit notes and observations
- ✅ `medical_conditions` - Patient medical history
- ✅ `medications` - Current medications
- ✅ `patient_allergies` - Detailed allergy tracking
- ✅ `diagnoses` - Dental diagnoses with ICD codes
- ✅ `dental_chart_records` - Tooth-specific conditions
- ✅ Additional RLS policies
- ✅ Update triggers

### Stage 3: Microsoft Entra Integration (Part 5)

**File:** `part5-entra-schema.sql`

⚠️ **Note:** This schema references a `users` table, but our app uses `profiles`. You'll need to adapt this.

**Two options:**

**Option A: Use profiles table directly (Recommended)**

Run this modified version instead:

```sql
-- Modified Part 5 Schema for profiles table
-- Add Entra-specific columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS entra_user_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS entra_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'entra',
ADD COLUMN IF NOT EXISTS entra_display_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS entra_synced_at TIMESTAMP WITH TIME ZONE;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_profiles_entra_user_id ON profiles(entra_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_entra_email ON profiles(entra_email);

-- Create user_identities table for linking multiple identity providers
CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    provider_metadata JSONB,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_profile_id ON user_identities(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider ON user_identities(provider, provider_user_id);

-- Create audit log table
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    auth_provider VARCHAR(50),
    event_type VARCHAR(50),
    entra_user_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    success BOOLEAN,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_log_profile_id ON auth_audit_log(profile_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_created_at ON auth_audit_log(created_at);

-- Enable RLS
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY user_identities_select_own ON user_identities
    FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY auth_audit_log_select_own ON auth_audit_log
    FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY auth_audit_log_insert ON auth_audit_log
    FOR INSERT WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_user_identities_updated_at
    BEFORE UPDATE ON user_identities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Helper function to find user by Entra ID
CREATE OR REPLACE FUNCTION find_profile_by_entra_id(p_entra_user_id VARCHAR)
RETURNS TABLE (
    profile_id UUID,
    email TEXT,
    full_name TEXT,
    clinic_id UUID,
    role TEXT,
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.email,
        p.full_name,
        p.clinic_id,
        p.role,
        p.is_active
    FROM profiles p
    WHERE p.entra_user_id = p_entra_user_id
      AND p.is_active = true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION find_profile_by_entra_id IS 'Finds user profile by Microsoft Entra object ID';
```

**Option B: Create users table separately**

Run the original `part5-entra-schema.sql` file, but you'll need to manage two separate user tables.

---

## Initial Data Setup

### Step 1: Create Default Clinic

The schema already includes a default clinic, but you can verify or add more:

```sql
-- Verify default clinic exists
SELECT * FROM clinics;

-- Add additional clinics if needed
INSERT INTO clinics (name, address, city, state, zip, phone, email)
VALUES 
    ('Downtown Clinic', '456 Oak Avenue', 'Chicago', 'IL', '60601', '(555) 234-5678', 'downtown@dental.com'),
    ('Westside Branch', '789 Elm Street', 'Los Angeles', 'CA', '90001', '(555) 345-6789', 'westside@dental.com');
```

### Step 2: Create First Admin User

**Important:** The admin user must be created AFTER you set up Microsoft Entra authentication.

For now, just note the default clinic ID:

```sql
-- Get the clinic ID for admin user
SELECT id, name FROM clinics WHERE name = 'Main Dental Clinic';
```

Copy the UUID (e.g., `00000000-0000-0000-0000-000000000001`)

---

## Microsoft Entra Integration Setup

### Step 1: Disable Supabase Email Authentication

1. Go to **Authentication** → **Providers** in Supabase
2. **Disable** Email provider (we're using Entra only)
3. Keep the dashboard accessible via **dashboard authentication**

### Step 2: Create Admin Profile Manually

**After** setting up Entra (see PART5_ENTRA_SETUP.md), manually create the first admin:

```sql
-- Replace these values with your admin's Entra details
INSERT INTO profiles (
    id, 
    email, 
    full_name, 
    role, 
    clinic_id, 
    is_active,
    entra_user_id,
    entra_email,
    auth_provider
) VALUES (
    uuid_generate_v4(),  -- Generate new UUID
    'admin@yourdomain.com',  -- Admin email (must match Entra UPN)
    'System Administrator',
    'admin',
    '00000000-0000-0000-0000-000000000001',  -- Default clinic ID
    true,
    'YOUR_ENTRA_OBJECT_ID_HERE',  -- Get from Entra admin center
    'admin@yourdomain.com',  -- Entra email
    'entra'
);
```

**How to get Entra Object ID:**
1. Go to https://portal.azure.com
2. Navigate to **Azure Active Directory** → **Users**
3. Find your admin user
4. Copy the **Object ID** (e.g., `12345678-1234-1234-1234-123456789abc`)

### Step 3: Verify Admin Profile

```sql
SELECT id, email, full_name, role, entra_user_id 
FROM profiles 
WHERE role = 'admin';
```

---

## Configuration

### Step 1: Update Application Config

Edit `/var/www/html/dental-app/js/supabase-config.js`:

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
```

### Step 2: Update Entra Config

Edit `/var/www/html/dental-app/js/entra-config.js`:

```javascript
const EntraConfig = {
    clientId: 'YOUR_ENTRA_CLIENT_ID',
    tenantId: 'YOUR_ENTRA_TENANT_ID',
    redirectUri: window.location.origin + '/auth-callback.html',
    postLogoutRedirectUri: window.location.origin + '/login.html'
};
```

See `PART5_ENTRA_SETUP.md` for Entra configuration details.

---

## Verification

### Test Database Connection

Run these queries to verify everything works:

```sql
-- 1. Check all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Expected: 14 tables
-- appointments, auth_audit_log, clinical_notes, clinics, 
-- dental_chart_records, diagnoses, invoice_items, invoices,
-- medical_conditions, medications, patient_allergies, patients,
-- profiles, treatments, user_identities

-- 2. Verify RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND rowsecurity = true;

-- Expected: All tables should show rowsecurity = true

-- 3. Check default data
SELECT * FROM clinics;
SELECT COUNT(*) as profile_count FROM profiles;

-- 4. Verify functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION';

-- Expected: update_updated_at_column, generate_patient_number,
-- generate_invoice_number, find_profile_by_entra_id
```

### Test RLS Policies

```sql
-- Test as anonymous (should fail)
SET ROLE anon;
SELECT * FROM patients; -- Should return 0 rows

-- Reset
RESET ROLE;
```

---

## Troubleshooting

### Issue: "relation already exists"

**Cause:** Table or function already created

**Solution:** 
- The schema uses `CREATE TABLE IF NOT EXISTS` so this should be safe
- If you need to rebuild, drop tables first:

```sql
-- WARNING: This deletes all data!
DROP TABLE IF EXISTS auth_audit_log CASCADE;
DROP TABLE IF EXISTS user_identities CASCADE;
DROP TABLE IF EXISTS dental_chart_records CASCADE;
DROP TABLE IF EXISTS diagnoses CASCADE;
DROP TABLE IF EXISTS patient_allergies CASCADE;
DROP TABLE IF EXISTS medications CASCADE;
DROP TABLE IF EXISTS medical_conditions CASCADE;
DROP TABLE IF EXISTS clinical_notes CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS treatments CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS patients CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS clinics CASCADE;
```

### Issue: "permission denied for table"

**Cause:** RLS policies blocking access

**Solution:**
- Use Service Role key for admin operations
- Or temporarily disable RLS:

```sql
ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;
-- Do your work
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
```

### Issue: "foreign key constraint violation"

**Cause:** Trying to insert data that references non-existent records

**Solution:**
- Ensure clinics exist before creating profiles
- Ensure profiles exist before creating patients
- Check foreign key relationships:

```sql
-- Find tables with foreign keys
SELECT 
    tc.table_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';
```

### Issue: Entra authentication fails

**Symptoms:**
- Login redirects but no user session
- "User not found in database" error

**Solutions:**

1. **Verify profile exists:**
```sql
SELECT * FROM profiles WHERE entra_user_id = 'YOUR_ENTRA_OBJECT_ID';
```

2. **Check Entra ID matches:**
- The `entra_user_id` in database must match the `oid` claim from Entra token
- You can inspect the token at https://jwt.ms

3. **Check clinic assignment:**
```sql
-- User must have a valid clinic_id
SELECT p.email, p.role, p.clinic_id, c.name as clinic_name
FROM profiles p
LEFT JOIN clinics c ON c.id = p.clinic_id
WHERE p.entra_user_id = 'YOUR_ENTRA_OBJECT_ID';
```

4. **Verify user is active:**
```sql
UPDATE profiles 
SET is_active = true 
WHERE entra_user_id = 'YOUR_ENTRA_OBJECT_ID';
```

### Issue: Can't see patients/appointments

**Cause:** RLS policies require matching clinic_id

**Solution:**
- Verify user has clinic_id assigned
- Check if data exists for that clinic:

```sql
-- Check user's clinic
SELECT clinic_id FROM profiles WHERE id = auth.uid();

-- Check data in that clinic
SELECT COUNT(*) FROM patients WHERE clinic_id = 'YOUR_CLINIC_ID';
SELECT COUNT(*) FROM appointments WHERE clinic_id = 'YOUR_CLINIC_ID';
```

---

## Database Maintenance

### Backup

**Automated (Recommended):**
- Supabase Pro plan includes daily backups
- Free tier: Manual backups

**Manual Backup:**

```bash
# Using pg_dump (requires PostgreSQL client)
pg_dump -h db.YOUR_PROJECT.supabase.co \
  -U postgres \
  -d postgres \
  -f dental-app-backup-$(date +%Y%m%d).sql

# Or use Supabase CLI
supabase db dump -f backup.sql
```

### Performance Monitoring

```sql
-- Check table sizes
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Find slow queries (if query logging enabled)
SELECT * FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

## Next Steps

After completing database setup:

1. ✅ Configure Microsoft Entra (see `PART5_ENTRA_SETUP.md`)
2. ✅ Update application configuration files
3. ✅ Create initial admin user
4. ✅ Test authentication flow
5. ✅ Provision additional users via User Management UI
6. ✅ Create test patients and appointments
7. ✅ Review audit logs

---

## Support Resources

- **Supabase Docs:** https://supabase.com/docs
- **PostgreSQL Docs:** https://www.postgresql.org/docs/
- **RLS Guide:** https://supabase.com/docs/guides/auth/row-level-security
- **SQL Editor:** https://app.supabase.com (Your Project → SQL Editor)

---

## Summary Checklist

- [ ] Supabase project created
- [ ] `database-schema.sql` executed successfully
- [ ] `part4-schema-extension.sql` executed successfully
- [ ] Part 5 Entra schema applied (modified for profiles table)
- [ ] Default clinic verified
- [ ] Application config files updated (supabase-config.js)
- [ ] Entra config updated (entra-config.js)
- [ ] First admin user created in database
- [ ] Entra authentication tested
- [ ] RLS policies verified
- [ ] Test data created (optional)

**Your database is now ready for production use!** 🎉

