import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export async function signInWithMicrosoft() {
  if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const appUrl = import.meta.env.VITE_APP_URL || window.location.origin
  return supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'openid profile email User.Read Mail.Send Calendars.ReadWrite',
      redirectTo: `${appUrl}/auth/callback`,
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
