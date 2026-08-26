-- Part 5: Microsoft Entra Integration Schema Extension
-- Creates tables and columns for Entra authentication

-- 1. Add Entra-specific columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS entra_user_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS entra_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'entra',
ADD COLUMN IF NOT EXISTS entra_display_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS entra_synced_at TIMESTAMP WITH TIME ZONE;

-- 2. Create user_identities table for linking multiple identity providers
CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'entra', 'local', etc.
    provider_user_id VARCHAR(255) NOT NULL, -- Entra object ID or username
    provider_email VARCHAR(255),
    provider_metadata JSONB, -- Store additional provider-specific data
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);

-- 3. Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider_user_id ON user_identities(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_users_entra_user_id ON users(entra_user_id);
CREATE INDEX IF NOT EXISTS idx_users_entra_email ON users(entra_email);

-- 4. Create audit log table for authentication events
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    auth_provider VARCHAR(50),
    event_type VARCHAR(50), -- 'login', 'logout', 'token_refresh', 'failed_login'
    entra_user_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    success BOOLEAN,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_log_user_id ON auth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_created_at ON auth_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_event_type ON auth_audit_log(event_type);

-- 5. Enable Row Level Security on new tables
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for user_identities
-- Users can read their own identities
CREATE POLICY user_identities_select_own ON user_identities
    FOR SELECT
    USING (user_id = auth.uid());

-- Only authenticated users can view (for admin purposes through service role)
CREATE POLICY user_identities_select_authenticated ON user_identities
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- 7. RLS Policies for auth_audit_log
-- Users can read their own audit logs
CREATE POLICY auth_audit_log_select_own ON auth_audit_log
    FOR SELECT
    USING (user_id = auth.uid());

-- Service role can insert audit logs
CREATE POLICY auth_audit_log_insert ON auth_audit_log
    FOR INSERT
    WITH CHECK (true);

-- 8. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Create trigger for user_identities
DROP TRIGGER IF EXISTS update_user_identities_updated_at ON user_identities;
CREATE TRIGGER update_user_identities_updated_at
    BEFORE UPDATE ON user_identities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 10. Create view for active Entra users
CREATE OR REPLACE VIEW active_entra_users AS
SELECT 
    u.id,
    u.email,
    u.entra_user_id,
    u.entra_email,
    u.entra_display_name,
    u.first_name,
    u.last_name,
    u.clinic_id,
    c.name as clinic_name,
    u.role,
    u.is_active,
    u.entra_synced_at,
    u.created_at
FROM users u
LEFT JOIN clinics c ON u.clinic_id = c.id
WHERE u.auth_provider = 'entra' 
  AND u.is_active = true
  AND u.entra_user_id IS NOT NULL;

-- 11. Create function to link user to Entra account
CREATE OR REPLACE FUNCTION link_user_to_entra(
    p_user_id UUID,
    p_entra_user_id VARCHAR,
    p_entra_email VARCHAR,
    p_entra_display_name VARCHAR
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Update user record
    UPDATE users 
    SET 
        entra_user_id = p_entra_user_id,
        entra_email = p_entra_email,
        entra_display_name = p_entra_display_name,
        auth_provider = 'entra',
        entra_synced_at = NOW()
    WHERE id = p_user_id;
    
    -- Insert or update user_identity
    INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email, is_primary)
    VALUES (p_user_id, 'entra', p_entra_user_id, p_entra_email, true)
    ON CONFLICT (provider, provider_user_id) 
    DO UPDATE SET 
        provider_email = EXCLUDED.provider_email,
        updated_at = NOW();
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 12. Create function to find user by Entra ID
CREATE OR REPLACE FUNCTION find_user_by_entra_id(p_entra_user_id VARCHAR)
RETURNS TABLE (
    user_id UUID,
    email VARCHAR,
    first_name VARCHAR,
    last_name VARCHAR,
    clinic_id UUID,
    role VARCHAR,
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.clinic_id,
        u.role,
        u.is_active
    FROM users u
    WHERE u.entra_user_id = p_entra_user_id
      AND u.is_active = true;
END;
$$ LANGUAGE plpgsql;

-- 13. Comments for documentation
COMMENT ON TABLE user_identities IS 'Links users to external identity providers (Microsoft Entra, etc.)';
COMMENT ON TABLE auth_audit_log IS 'Audit trail for authentication events';
COMMENT ON COLUMN users.entra_user_id IS 'Microsoft Entra object ID (unique identifier)';
COMMENT ON COLUMN users.entra_email IS 'Email address from Microsoft Entra';
COMMENT ON COLUMN users.auth_provider IS 'Authentication provider: entra, local';
COMMENT ON FUNCTION link_user_to_entra IS 'Links an existing user account to Microsoft Entra identity';
COMMENT ON FUNCTION find_user_by_entra_id IS 'Finds user by Microsoft Entra object ID';

-- Migration notes:
-- 1. Apply this schema to your Supabase database via SQL Editor
-- 2. Existing users will have auth_provider = 'entra' by default
-- 3. Admin must manually link users using the link_user_to_entra function
-- 4. Use the users management interface to set entra_user_id for each user
