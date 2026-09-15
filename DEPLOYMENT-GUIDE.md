# Sponty Dental Services Deployment Guide

This guide deploys the single-practice application with Supabase Auth using Microsoft Entra ID as the OAuth provider. This architecture is recommended because Supabase Auth issues the session JWT used by `auth.uid()` and therefore works correctly with Supabase Row Level Security.

## Architecture Decision

Use this flow in production:

1. The user selects **Sign in with Microsoft** in the application.
2. The frontend calls `supabase.auth.signInWithOAuth({ provider: 'azure' })`.
3. Supabase Auth redirects the user to Microsoft Entra ID.
4. Entra authenticates the user and redirects back to Supabase.
5. Supabase redirects to the application callback URL with a Supabase session.
6. The application loads `public.profiles` using `auth.uid()`.
7. RLS policies enforce the user's active status and role.

Do not use a browser-only MSAL token as a substitute for the Supabase session. A token acquired directly from MSAL does not automatically make `auth.uid()` available to Supabase RLS. Direct MSAL integration requires a trusted backend that validates the Entra token and exchanges it for a trusted application session.

## 1. Reuse the Existing Supabase Project

1. Open the existing project at [supabase.com](https://supabase.com).
2. Open **Project Settings > API** and keep the existing project URL and publishable anon key.
3. Confirm that the existing Auth users should be preserved.
4. In **SQL Editor**, run [`supabase/complete-schema.sql`](supabase/complete-schema.sql) only after confirming the old application data can be discarded.

The complete script removes and recreates only the `public` application tables, functions, and enums. It does not remove `auth.users`, so the existing Supabase Auth identities remain available. Take a database backup before running it. The separate `reset-public-schema.sql` and `schema.sql` files remain available for advanced or staged deployments.

The schema creates:

- Single-row practice settings
- Auth-linked staff profiles
- Patients and appointments
- Clinical notes and medical history
- Dental chart records
- Treatments and diagnoses
- Invoices and invoice items
- Audit events
- Indexes, timestamps, enums, and RLS policies

## 2. Configure Microsoft Entra ID

1. Open the existing application registration in the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Reuse its existing **Application (client) ID** and **Directory (tenant) ID**.
3. Keep the old callback URI if the old app still needs to run.
4. Add a redirect URI using the Supabase callback URL:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

5. Add delegated Microsoft Graph permissions `openid`, `profile`, `email`, `User.Read`, `Mail.Send`, and `Calendars.ReadWrite` as required by the tenant. Add `offline_access` if the tenant requires explicit refresh-token consent.
6. Grant admin consent if the tenant requires it.

The application does not need a client secret in the browser for Supabase Auth's Azure provider flow.

## 3. Configure the Supabase Azure Provider

In Supabase, open **Authentication > Providers > Azure** and enable it.

Set:

- **Client ID**: the Entra Application (client) ID
- **Client secret**: the secret generated in Entra for the Supabase provider
- **Tenant URL**: `https://login.microsoftonline.com/<tenant-id>`
- **Scopes**: `email profile openid User.Read Mail.Send Calendars.ReadWrite offline_access`

Create the Entra client secret under **App registrations > Certificates & secrets**. Store it only in Supabase provider settings. Never put it in frontend code or commit it to the repository.

## 4. Configure Redirect URLs

In Supabase, open **Authentication > URL Configuration**.

Set the site URL for local development:

```text
http://localhost:5173
```

Add the production URL and any preview URL to the allowed redirect list:

```text
http://localhost:5173/**
https://app.example.com/**
```

The frontend should call the OAuth flow with an explicit return path, for example `/dashboard`.

## 5. Frontend Environment Variables

Create `.env.local` in the project root:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-anon-key>
VITE_APP_URL=http://localhost:5173
```

For production, set the equivalent variables in the hosting provider. Only the Supabase URL and publishable anon key may be exposed to browser code. Never expose the service-role key, Azure client secret, or Graph application secret.

## 6. Create the First Administrator

1. In Supabase, open **Authentication > Users**.
2. Create or invite the first administrator using the same Microsoft email/UPN that will sign in.
3. Copy the created Auth user UUID.
4. Run this SQL with the correct values:

```sql
insert into public.profiles (id, email, full_name, role)
values (
  'AUTH_USER_UUID',
  'admin@example.com',
  'Practice Administrator',
  'admin'
);
```

The email should match the verified Entra identity. Do not create an active profile without a corresponding Auth user.

## 7. Staff Provisioning

Only an administrator should create or activate staff profiles.

```sql
insert into public.profiles (id, email, full_name, role)
values
  ('STAFF_AUTH_UUID', 'dentist@example.com', 'Dental Provider', 'dentist'),
  ('RECEPTION_AUTH_UUID', 'frontdesk@example.com', 'Front Desk', 'receptionist');
```

Supported roles:

- `admin`: user management, practice settings, all records, and audit access
- `dentist`: clinical records, dental charting, treatment, diagnoses, patients, and appointments
- `receptionist`: patients, appointments, operational billing, and permitted practice workflows

Set `is_active = false` to block a user without deleting their history.

## 8. Frontend Auth Integration

Install the Supabase client:

```bash
npm install @supabase/supabase-js
```

Create a client using the environment variables:

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
```

Sign in with Entra through Supabase Auth:

```ts
await supabase.auth.signInWithOAuth({
  provider: 'azure',
  options: {
    scopes: 'openid profile email User.Read',
    redirectTo: `${window.location.origin}/auth/callback`,
  },
})
```

Load the application profile after authentication:

```ts
const { data: { user } } = await supabase.auth.getUser()

const { data: profile } = await supabase
  .from('profiles')
  .select('id, email, full_name, role, is_active')
  .eq('id', user?.id)
  .single()

if (!profile?.is_active) {
  await supabase.auth.signOut()
  throw new Error('This account is not active in Sponty Dental Services.')
}
```

Subscribe to session changes and redirect unauthenticated users to `/login`. Use `supabase.auth.signOut()` for logout.

## 9. Optional Direct MSAL Integration

Direct MSAL is appropriate only when a backend is present. The backend must:

1. Validate the Entra access token signature, issuer, audience, tenant, and expiration.
2. Find the matching local profile.
3. Authorize the requested operation.
4. Perform database operations using a trusted server-side client.
5. Never trust role or practice data supplied by the browser.

Do not send a raw MSAL token to Supabase and assume it will satisfy `auth.uid()` policies. For the current browser-only rebuild, Supabase Auth's Azure provider is the supported path.

## 10. Local Development

From the project root:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

Build for production:

```bash
npm run build
```

Preview the build locally:

```bash
npm run preview
```

## 11. Deployment

The app is a static Vite build and can be hosted on Vercel, Netlify, Azure Static Web Apps, Cloudflare Pages, or an equivalent static host.

```bash
npm run build
```

Deploy the generated `dist` directory. Configure these environment variables on the host:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`

The Entra client ID, tenant ID, and client secret are configured in Supabase's Azure provider settings. They are not read from browser environment variables in this build.

Configure the deployed URL in both:

- Supabase Authentication URL Configuration
- Microsoft Entra SPA redirect and Supabase provider settings

If the host uses client-side routing, configure a fallback so unknown routes serve `index.html`.

## 12. Outlook Calendar Integration

For optional Microsoft Graph calendar sync:

3. Add delegated `Calendars.ReadWrite` permission to the Entra application for calendar sync.
4. Add delegated `Mail.Send` permission to the Entra application for invoice emails.
5. Grant tenant consent if required.
6. Request `Mail.Send` and `Calendars.ReadWrite` during Supabase Azure sign-in. Existing users must sign in again and accept the consent prompt to grant the new permissions.
7. The invoice email action uses the Supabase session's Microsoft provider token and calls `POST https://graph.microsoft.com/v1.0/me/sendMail`.
8. Because the endpoint is `/me/sendMail`, the message is sent from the logged-in user's Outlook mailbox and saved to their Sent Items.
9. If Graph send fails, keep the invoice unchanged and show a retryable error.

## 13. Deploy the Patient Portal Database Changes

The patient portal is a passwordless flow. A staff member issues a one-time access token, the patient opens `/portal/<token>`, and Supabase exchanges that token for a short-lived portal session. The original token is consumed once and is never stored in browser storage.

Run the migrations in this order from the Supabase SQL Editor:

1. [`supabase/migrations/20260915000000_waitlist_slot_prerequisites.sql`](supabase/migrations/20260915000000_waitlist_slot_prerequisites.sql)
2. [`supabase/migrations/20260915000001_waitlist_claiming.sql`](supabase/migrations/20260915000001_waitlist_claiming.sql)
3. [`supabase/migrations/20260915000002_patient_portal.sql`](supabase/migrations/20260915000002_patient_portal.sql)

The patient portal migration creates:

- `access_tokens` for expiring one-time links
- `portal_sessions` for 30-minute derived sessions
- `payment_proofs` and `patient_documents` metadata
- `payment-proofs` and `patient-documents` private Storage buckets
- RPCs for issuing, consuming, and validating portal sessions
- RPCs for reading patient invoices and marking a receipt as pending verification
- Bank detail fields on `practice_settings`

After running the migration, configure the clinic bank details:

```sql
update public.practice_settings
set bank_name = 'Example Bank',
    bank_account_name = 'Sponty Dental Services',
    bank_account_number = 'ACCOUNT-NUMBER',
    portal_staff_email = 'clinic@example.com'
where id = true;
```

Do not make either Storage bucket public. Patient uploads are validated by the `patient-portal-upload` Edge Function using the short-lived portal session.

## 14. Issue a Patient Portal Link

Only an authenticated staff user with an active profile may issue a link. The frontend helper is `issue_patient_portal_token` through Supabase RPC. The returned token should be sent using [`sendPatientPortalAccessEmail`](src/lib/outlook.ts).

For a controlled SQL test, use the Supabase dashboard while signed in as staff or call the application helper:

```ts
const { data: token, error } = await supabase.rpc('issue_patient_portal_token', {
  p_patient_id: patientId,
})
```

The production link format is:

```text
https://app.example.com/portal/<ONE_TIME_TOKEN>
```

The token expires after 24 hours by default. Once consumed, it cannot be used again. A refresh remains possible for 30 minutes because the app keeps only the derived session in `sessionStorage`.

## 15. Deploy the Patient Upload Edge Function

Install and authenticate the Supabase CLI, then link the project:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy patient-portal-upload
```

The function uses the Supabase service-role key only inside the Edge Function runtime. Never put that key in `.env.local`, Vercel variables prefixed with `VITE_`, or browser code.

Set the Edge Function secrets:

```bash
supabase secrets set \
  MICROSOFT_TENANT_ID=<tenant-id> \
  MICROSOFT_CLIENT_ID=<application-client-id> \
  MICROSOFT_CLIENT_SECRET=<application-secret> \
  MICROSOFT_GRAPH_SENDER=clinic-mailbox@example.com \
  PORTAL_STAFF_EMAILS=staff-one@example.com,staff-two@example.com
```

The first three Graph secrets are used for server-side staff notification after a payment receipt upload. `MICROSOFT_GRAPH_SENDER` must be a mailbox the application is allowed to send as. `PORTAL_STAFF_EMAILS` is a comma-separated recipient list.

## 16. Microsoft Graph Permissions for Portal Notifications

The Edge Function uses the OAuth 2.0 client-credentials flow. In the Entra app registration:

1. Add Microsoft Graph **Application** permission `Mail.Send`.
2. Grant admin consent for the tenant.
3. Create a client secret and store it only as the Edge Function secret above.
4. Restrict the application mailbox with an Exchange application access policy if the tenant requires limited send-as scope.

The existing browser-based invoice and calendar features continue to use delegated permissions through Supabase Azure Auth. The Edge Function notification uses application permissions because a patient portal visitor does not have a staff delegated token.

## 17. Patient Portal Deployment Smoke Test

Run these checks after deployment:

1. Staff issues a portal token for an active patient.
2. The patient opens `/portal/<token>` in a private browser window.
3. Confirm the patient name and only that patient’s invoices are displayed.
4. Confirm the bank name, account name, account number, and reference code are shown.
5. Upload a PNG, JPG, or PDF payment receipt and confirm the invoice changes to `pending_verification`.
6. Confirm the receipt appears in the private `payment-proofs` bucket and staff receives the verification email.
7. Upload an X-ray or medical record through the drag-and-drop panel.
8. Confirm the file is stored under the patient folder in the private `patient-documents` bucket.
9. Open the original link again and confirm it is rejected as consumed.
10. Wait for or simulate session expiry and confirm the portal asks for a new link.

Do not test by making the buckets public. A successful portal upload should work while unauthenticated in Supabase Auth, because authorization comes from the one-time portal session validated by the Edge Function.
10. Calendar sync can continue to use the same signed-in provider token for calendar operations.

Calendar sync must never be the only persistence path for an appointment.

## 13. Production Checklist

- [ ] Supabase project created
- [ ] `supabase/schema.sql` executed successfully
- [ ] Azure provider enabled in Supabase Auth
- [ ] Entra redirect URI configured
- [ ] Supabase site and redirect URLs configured
- [ ] First admin Auth user and profile created
- [ ] Environment variables configured without secrets in source control
- [ ] RLS tested with admin, dentist, and receptionist accounts
- [ ] Inactive user is denied access
- [ ] Clinical private notes are not visible to unauthorized users
- [ ] Appointment overlap validation tested
- [ ] Production host serves SPA fallback routes
- [ ] Print layouts verified
- [ ] Outlook consent and failure paths tested if enabled
