import { createClient } from '@supabase/supabase-js'

const appConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  appUrl: import.meta.env.VITE_APP_URL || window.location.origin,
  entraClientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
  entraTenantId: import.meta.env.VITE_ENTRA_TENANT_ID,
}

const supabaseUrl = appConfig.supabaseUrl
const supabaseAnonKey = appConfig.supabaseAnonKey

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export const appEnv = appConfig

export async function signInWithMicrosoft() {
  if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const appUrl = appEnv.appUrl
  return supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'openid profile email User.Read Mail.Send Calendars.ReadWrite offline_access',
      redirectTo: `${appUrl}/auth/callback`,
      queryParams: { prompt: 'consent' },
    },
  })
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut()
}

export type WaitlistClaimedAppointment = {
  id: string
  patient_id: string
  provider_id: string | null
  appointment_date: string
  appointment_time: string
  duration_minutes: number
  appointment_type: string
  status: string
  outlook_event_id: string | null
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function createWaitlistClaim(
  slotId: string,
  patientId: string,
  expiresAt?: string,
) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_waitlist_claim', {
    p_slot_id: slotId,
    p_patient_id: patientId,
    ...(expiresAt ? { p_expires_at: expiresAt } : {}),
  })
  if (error) throw new Error(`Could not create waitlist claim: ${error.message}`)
  return data as string
}

export async function validateWaitlistClaim(
  slotId: string,
  patientId: string,
  token: string,
) {
  if (!slotId || !patientId || !token) return false
  const client = requireSupabase()
  const { data, error } = await client.rpc('validate_waitlist_claim', {
    p_slot_id: slotId,
    p_patient_id: patientId,
    p_token: token,
  })
  if (error) throw new Error(`Could not validate waitlist claim: ${error.message}`)
  return data === true
}

export async function claimWaitlistSlot(
  slotId: string,
  patientId: string,
  token: string,
) {
  const valid = await validateWaitlistClaim(slotId, patientId, token)
  if (!valid) throw new Error('This waitlist link is invalid, expired, or already used.')

  const client = requireSupabase()
  const { data, error } = await client.rpc('claim_waitlist_slot', {
    p_slot_id: slotId,
    p_patient_id: patientId,
  })
  if (error) throw new Error(error.message)
  return data as WaitlistClaimedAppointment
}

export type PortalInvoice = {
  id: string
  invoice_number: string
  invoice_date: string
  total: number
  amount_paid: number
  balance: number
  status: string
}

export type PortalContext = {
  session_token: string
  patient_id: string
  patient_name: string
  expires_at: string
}

export async function consumePatientPortalToken(token: string) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('consume_patient_portal_token', { p_token: token })
  if (error) throw new Error('This portal link is invalid, expired, or already used.')
  return data as PortalContext
}

export async function getPatientPortalData(sessionToken: string) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_patient_portal_data', { p_session_token: sessionToken })
  if (error) throw new Error('This portal session has expired. Request a new link.')
  return data as { patient_id: string; patient_name: string; invoices: PortalInvoice[]; documents: Array<{ id: string; file_name: string; content_type: string; storage_path: string; uploaded_at: string }>; bank: { bank_name: string | null; account_name: string | null; account_number: string | null } | null }
}

export async function uploadPatientPortalFile(
  sessionToken: string,
  bucket: 'payment-proofs' | 'patient-documents',
  file: File,
  invoiceId?: string,
) {
  const client = requireSupabase()
  const form = new FormData()
  form.append('session_token', sessionToken)
  form.append('bucket', bucket)
  form.append('file', file)
  if (invoiceId) form.append('invoice_id', invoiceId)
  const { data, error } = await client.functions.invoke('patient-portal-upload', { body: form })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data as { path: string; file_name: string }
}
