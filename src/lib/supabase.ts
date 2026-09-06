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
