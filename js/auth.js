// Authentication Module - Microsoft Entra Integration
// Updated for Part 5: Entra-only authentication
import { 
    getCurrentSession, 
    isAuthenticated, 
    signOut as entraSignOut,
    requireAuth,
    getUserDisplayName
} from './entra-auth.js';

// Check if user is authenticated
export async function checkAuth() {
    if (!isAuthenticated()) {
        // Redirect to login if not authenticated
        window.location.href = 'login.html';
        return null;
    }
    
    const session = getCurrentSession();
    return session ? {
        user_id: session.user_id,
        email: session.email,
        role: session.role
    } : null;
}

// Logout function
export async function logout() {
    try {
        await entraSignOut();
        // entraSignOut handles redirect to login
    } catch (error) {
        console.error('Logout error:', error);
        // Force redirect even if error
        window.location.href = 'login.html';
    }
}

// Get current user with profile
export async function getCurrentUserWithProfile() {
    if (!isAuthenticated()) {
        return null;
    }
    
    const session = getCurrentSession();
    
    if (!session) {
        return null;
    }
    
    // Return user with profile from session
    return {
        id: session.user_id,
        email: session.email,
        profile: {
            user_id: session.user_id,
            email: session.email,
            full_name: `${session.first_name} ${session.last_name}`.trim(),
            first_name: session.first_name,
            last_name: session.last_name,
            role: session.role,
            clinic_id: session.clinic_id,
            auth_provider: session.auth_provider || 'entra',
            entra_account: session.entra_account
        }
    };
}

// Get current user (simple version)
export function getCurrentUser() {
    const session = getCurrentSession();
    
    if (!session) {
        return null;
    }
    
    return {
        id: session.user_id,
        email: session.email,
        user_metadata: {
            first_name: session.first_name,
            last_name: session.last_name,
            full_name: `${session.first_name} ${session.last_name}`.trim()
        }
    };
}

// Get user profile
export function getUserProfile(userId) {
    const session = getCurrentSession();
    
    if (!session || session.user_id !== userId) {
        return null;
    }
    
    return {
        user_id: session.user_id,
        email: session.email,
        full_name: `${session.first_name} ${session.last_name}`.trim(),
        first_name: session.first_name,
        last_name: session.last_name,
        role: session.role,
        clinic_id: session.clinic_id,
        auth_provider: session.auth_provider || 'entra'
    };
}

// Check user role
export async function checkUserRole(requiredRole) {
    const user = await getCurrentUserWithProfile();
    
    if (!user || !user.profile) {
        return false;
    }
    
    if (requiredRole === 'admin' && user.profile.role !== 'admin') {
        return false;
    }
    
    return true;
}

// Get clinic ID from session
export function getCurrentClinicId() {
    const session = getCurrentSession();
    return session ? session.clinic_id : null;
}

// Check if user has access to clinic
export function hasClinicAccess(clinicId) {
    const currentClinicId = getCurrentClinicId();
    return currentClinicId === clinicId;
}

// Setup auth state listener (stub for compatibility)
// Note: Entra uses redirect-based auth, not real-time listeners like Supabase
export function setupAuthListener(callback) {
    console.log('Auth state listener setup (Entra uses redirect-based auth)');
    
    // Check auth state on page load/visibility change
    const checkAuthState = () => {
        if (!isAuthenticated()) {
            window.location.href = 'login.html';
        } else {
            const session = getCurrentSession();
            callback(session);
        }
    };
    
    // Check on visibility change (user returns to tab)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            checkAuthState();
        }
    });
    
    // Initial check
    checkAuthState();
}

// Require authentication (redirect if not authenticated)
export function requireAuthentication() {
    return requireAuth();
}

// Get user display name
export function getDisplayName() {
    return getUserDisplayName();
}
