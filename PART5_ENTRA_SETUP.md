# Part 5: Microsoft Entra Integration - Setup Guide

## Overview
This guide covers the complete setup of Microsoft Entra (Azure AD) authentication for the dental clinic application. The implementation uses OAuth2/OIDC with MSAL.js for secure, enterprise-grade authentication.

## Features Implemented

### ✅ Authentication
- Single Sign-On (SSO) via Microsoft Entra ID
- OAuth2/OIDC authentication flow
- Session management with automatic token refresh
- Secure logout with proper cleanup

### ✅ User Provisioning
- Manual user provisioning interface
- Administrator-assigned clinic mapping
- Role-based access control (Admin, Dentist, Staff)
- User activation/deactivation

### ✅ Multi-Tenant Support
- Clinic-scoped data access
- User-to-clinic assignment
- Isolated data per clinic

---

## Prerequisites

1. **Microsoft Entra ID Tenant**
   - Active Microsoft 365 or Azure subscription
   - Administrator access to Entra admin center

2. **Users in Entra**
   - Corporate email addresses (User Principal Names)
   - Users must exist in Entra before provisioning in app

3. **Application URLs**
   - Login: `http://34.162.164.18/dental-app/login.html`
   - Callback: `http://34.162.164.18/dental-app/auth-callback.html`
   - Dashboard: `http://34.162.164.18/dental-app/index.html`
   - Users: `http://34.162.164.18/dental-app/users.html`

---

## Step 1: Register Application in Microsoft Entra

### 1.1 Access Entra Admin Center
1. Go to https://entra.microsoft.com
2. Sign in with administrator credentials
3. Navigate to **Applications** → **App registrations**

### 1.2 Create New Registration
1. Click **New registration**
2. Fill in the following:
   - **Name**: `Dental Clinic Application`
   - **Supported account types**: `Accounts in this organizational directory only (Single tenant)`
   - **Redirect URI**: 
     - Platform: `Single-page application (SPA)`
     - URI: `http://34.162.164.18/dental-app/auth-callback.html`

3. Click **Register**

### 1.3 Configure Authentication
1. In your app registration, go to **Authentication**
2. Under **Implicit grant and hybrid flows**, enable:
   - ✅ Access tokens
   - ✅ ID tokens
3. Under **Advanced settings**:
   - Allow public client flows: **No**
4. Add additional redirect URI (if needed):
   - `http://34.162.164.18/dental-app/login.html`
5. Click **Save**

### 1.4 Configure API Permissions
1. Go to **API permissions**
2. Ensure these permissions are present (added by default):
   - `User.Read` (Delegated)
   - `openid` (Delegated)
   - `profile` (Delegated)
   - `email` (Delegated)
3. Click **Grant admin consent** for your organization

### 1.5 Copy Configuration Values
1. Go to **Overview**
2. Copy and save these values:
   - **Application (client) ID**: (e.g., `12345678-abcd-1234-abcd-123456789abc`)
   - **Directory (tenant) ID**: (e.g., `87654321-dcba-4321-dcba-987654321cba`)

---

## Step 2: Configure Application

### 2.1 Update Entra Configuration
1. SSH into server: `ssh nonbios@34.162.164.18`
2. Edit the configuration file:
   ```bash
   nano /var/www/html/dental-app/js/entra-config.js
   ```

3. Replace placeholder values:
   ```javascript
   export const entraConfig = {
       // Replace with your Application (client) ID from Entra
       clientId: 'YOUR_CLIENT_ID_HERE',
       
       // Replace with your Directory (tenant) ID from Entra
       tenantId: 'YOUR_TENANT_ID_HERE',
       
       // Replace with your actual domain (or use IP as shown)
       redirectUri: 'http://34.162.164.18/dental-app/auth-callback.html',
       
       postLogoutRedirectUri: 'http://34.162.164.18/dental-app/login.html'
   };
   ```

4. Save the file (Ctrl+O, Enter, Ctrl+X)

### 2.2 Verify File Permissions
```bash
sudo chmod 644 /var/www/html/dental-app/js/entra-config.js
```

---

## Step 3: Initial User Setup

### 3.1 Create First Admin User in Database

Connect to the database:
```bash
sudo mysql
```

Execute SQL:
```sql
USE dental_clinic;

-- Insert first admin user (replace email with your Entra UPN)
INSERT INTO profiles (
    id, 
    email, 
    first_name, 
    last_name, 
    role, 
    clinic_id, 
    is_active,
    created_at,
    updated_at
) VALUES (
    UUID(),
    'admin@yourdomain.com',  -- Replace with your Entra email
    'Admin',
    'User',
    'admin',
    (SELECT id FROM clinics LIMIT 1),  -- Assign to first clinic
    TRUE,
    NOW(),
    NOW()
);

-- Verify
SELECT email, role, is_active FROM profiles WHERE role = 'admin';

EXIT;
```

---

## Step 4: Test Authentication

### 4.1 Test Login Flow
1. Open browser (incognito/private mode recommended)
2. Navigate to: `http://34.162.164.18/dental-app/login.html`
3. Click **Sign in with Microsoft**
4. You should be redirected to Microsoft login
5. Sign in with your Entra credentials
6. Grant permissions if prompted
7. You should be redirected back to the application dashboard

### 4.2 Verify Session
- Check that your name appears in top-right corner
- Verify clinic information is displayed
- Navigation should be accessible

### 4.3 Test Logout
1. Click logout button
2. Verify you're signed out from both app and Microsoft
3. Verify you're redirected to login page

---

## Step 5: User Provisioning

### 5.1 Access User Management
1. Sign in as admin user
2. Navigate to **Users** from the sidebar
3. URL: `http://34.162.164.18/dental-app/users.html`

### 5.2 Add Users
1. Click **Add User** button
2. Fill in user details:
   - **Microsoft Entra Email (UPN)**: Must match user's email in Entra
   - **First Name**: User's first name
   - **Last Name**: User's last name
   - **Role**: Select appropriate role
     - **Admin**: Full system access, can manage users
     - **Dentist**: Clinical access, patient management
     - **Staff**: Limited access, appointments, billing
   - **Clinic**: Select clinic to assign user to
   - **Phone**: Optional contact number
   - **Notes**: Optional internal notes

3. Click **Save User**

### 5.3 Manage Users
- **Edit**: Modify user details, change role or clinic
- **Activate/Deactivate**: Enable or disable user access
- **Filter**: Search and filter users by name, email, clinic, role, or status

### 5.4 User Login Process
1. User opens login page
2. Clicks "Sign in with Microsoft"
3. Authenticates with Entra credentials
4. System checks if user exists in `profiles` table
5. If exists and active: grants access with assigned role and clinic
6. If not exists or inactive: denies access with error message

---

## Step 6: Role-Based Access

### Admin Role
- Full application access
- User management
- All clinics visible (can be scoped to specific clinic)
- System configuration

### Dentist Role
- Patient records (clinic-scoped)
- Appointments (clinic-scoped)
- Dental charts and treatment plans
- Clinical notes

### Staff Role
- Appointments (clinic-scoped)
- Basic patient information (clinic-scoped)
- Billing (clinic-scoped)
- Limited record access

---

## Architecture Overview

### Authentication Flow
```
1. User visits login.html
2. Clicks "Sign in with Microsoft"
3. MSAL redirects to Microsoft login
4. User authenticates with Entra credentials
5. Microsoft redirects to auth-callback.html with token
6. Callback validates token and checks database
7. If user exists and active: create session, redirect to dashboard
8. If not: show error, redirect to login
```

### Session Structure
```javascript
{
    user_id: "uuid",
    email: "user@domain.com",
    first_name: "John",
    last_name: "Doe",
    role: "dentist",
    clinic_id: "clinic-uuid",
    entra_account: {
        localAccountId: "...",
        username: "user@domain.com",
        name: "John Doe"
    }
}
```

### Files Modified/Created

**New Files:**
- `js/entra-auth.js` - MSAL authentication module
- `js/entra-config.js` - Entra configuration
- `auth-callback.html` - OAuth callback handler
- `users.html` - User management interface
- `js/users.js` - User management logic

**Modified Files:**
- `login.html` - Replaced password login with Microsoft sign-in
- `js/auth.js` - Updated to use Entra authentication
- `js/app.js` - Updated session handling
- `js/appointment-form.js` - Updated to use Entra session
- `js/appointments.js` - Updated to use Entra session

---

## Database Schema Updates

### Profiles Table
The existing `profiles` table is used for user provisioning:

```sql
-- Core fields used:
- id (UUID) - User identifier
- email (TEXT) - Microsoft Entra UPN
- first_name (TEXT)
- last_name (TEXT)
- role (TEXT) - admin, dentist, staff
- clinic_id (UUID) - Assigned clinic
- is_active (BOOLEAN) - User status
- phone (TEXT) - Optional
- last_login (TIMESTAMP) - Auto-updated on login
```

---

## Security Considerations

### 1. Token Security
- Tokens stored in sessionStorage (cleared on browser close)
- Automatic token refresh before expiry
- Secure token validation

### 2. Clinic Isolation
- All queries scoped to user's assigned clinic_id
- Cross-clinic data access prevented
- Multi-tenant data separation

### 3. Role-Based Access
- Server-side role validation required (future enhancement)
- Client-side UI restrictions based on role
- Admin-only access to user management

### 4. Session Management
- Session expires on browser close
- Automatic cleanup on logout
- No persistent authentication without re-login

---

## Troubleshooting

### Issue: "User not found in system"
**Solution**: User must be provisioned in database first via User Management interface

### Issue: "MSAL not initialized"
**Solution**: Check that `entra-config.js` has correct clientId and tenantId values

### Issue: Redirect loop after login
**Solution**: Verify redirect URIs match exactly in both Entra and entra-config.js

### Issue: "Unauthorized" error
**Solution**: Grant admin consent for API permissions in Entra

### Issue: User can't access certain features
**Solution**: Check user's role and clinic assignment in User Management

### Issue: Session not persisting
**Solution**: Ensure browser allows sessionStorage, check for JavaScript errors

---

## Testing Checklist

- [ ] Login with Microsoft account succeeds
- [ ] User session displays correct name and clinic
- [ ] Logout properly clears session
- [ ] Admin can access User Management
- [ ] Non-admin cannot access User Management
- [ ] New users can be added with Entra email
- [ ] Users can be activated/deactivated
- [ ] User edits save correctly
- [ ] Clinic-scoped data displays correctly
- [ ] Appointments load only for user's clinic
- [ ] Patients load only for user's clinic
- [ ] Role-based UI restrictions work

---

## URLs Reference

| Page | URL |
|------|-----|
| Login | http://34.162.164.18/dental-app/login.html |
| Dashboard | http://34.162.164.18/dental-app/index.html |
| Patients | http://34.162.164.18/dental-app/patients.html |
| Appointments | http://34.162.164.18/dental-app/appointments.html |
| User Management | http://34.162.164.18/dental-app/users.html |
| Auth Callback | http://34.162.164.18/dental-app/auth-callback.html |

---

## Support & Maintenance

### Regular Tasks
1. **User Provisioning**: Add new users as they join organization
2. **Access Review**: Periodically review and deactivate inactive users
3. **Clinic Assignments**: Update user clinic mappings as needed
4. **Role Updates**: Modify user roles based on organizational changes

### Monitoring
- Check user login activity via `last_login` field
- Review active vs inactive user counts
- Monitor authentication errors in browser console

---

## Future Enhancements (Out of Scope for Part 5)

- Server-side authorization middleware
- Audit logging for user management actions
- Group-based role assignment from Entra
- Automatic user provisioning via Microsoft Graph API
- Password rotation policies (N/A with Entra SSO)
- Multi-factor authentication enforcement
- Conditional access policies integration

---

## Completion Status

✅ **Task 1**: Database Schema Extension  
✅ **Task 2**: Entra Authentication Module (`js/entra-auth.js`)  
✅ **Task 3**: Callback Handler (`auth-callback.html`)  
✅ **Task 4**: Login Page Modification (`login.html`)  
✅ **Task 5**: Authentication Logic Update (all files)  
✅ **Task 6**: User Provisioning Interface (`users.html`, `js/users.js`)  
✅ **Task 7**: Configuration File (`js/entra-config.js`)  
✅ **Task 8**: Documentation (this file)  

**Part 5 Implementation: COMPLETE** ✅

---

## Quick Start Summary

1. Register app in Microsoft Entra admin center
2. Update `js/entra-config.js` with clientId and tenantId
3. Insert first admin user in database
4. Test login at http://34.162.164.18/dental-app/login.html
5. Access User Management to provision additional users
6. Users sign in with their Microsoft Entra credentials

For detailed steps, see sections above.
