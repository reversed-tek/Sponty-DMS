// Supabase Configuration
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://gdbvdvctadvgunirfclm.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkYnZkdmN0YWR2Z3VuaXJmY2xtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MjY3OTAsImV4cCI6MjEwMzMwMjc5MH0.mWHX490eSUSWEbDZcPi0pl14WzcmV05DESSX86ucwYk';

// Import Supabase client from CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Create Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Check if Supabase is properly configured
export function checkSupabaseConfig() {
    const isKeyInvalid = !SUPABASE_ANON_KEY || 
                         SUPABASE_ANON_KEY === 'PLACEHOLDER_KEY' || 
                         SUPABASE_ANON_KEY.length < 20;

    if (!SUPABASE_URL || isKeyInvalid) {
        console.warn('Supabase is not configured. Please update supabase.js with your credentials.');
        return false;
    }
    return true;
}

// Get user profile with role
export async function getUserProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    
    if (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
    
    return data;
}

// Sign out
export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error('Error signing out:', error);
        throw error;
    }
}
