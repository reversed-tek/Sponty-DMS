

import { supabase } from './supabase.js';

// MSAL Configuration
let msalInstance = null;
let msalConfig = null;

/**
 * Initialize MSAL with provided configuration
 * @param {Object} config - Entra configuration object
 */
export async function initializeEntraAuth(config) {
    if (!config) {
        throw new Error('Entra configuration object is missing.');
    }

    // Safely retrieve MSAL from global window object
    const msalLib = window.msal || window.Msal;
    if (!msalLib) {
        throw new Error('MSAL SDK missing. Ensure msal-browser.min.js script tag is present in your HTML head.');
    }

    msalConfig = {
        auth: {
            clientId: config.clientId,
            authority: `https://login.microsoftonline.com/${config.tenantId}`,
            redirectUri: config.redirectUri,
            postLogoutRedirectUri: config.postLogoutRedirectUri || config.redirectUri,
            navigateToLoginRequestUrl: false
        },
        cache: {
            cacheLocation: 'sessionStorage',
            storeAuthStateInCookie: false
        },
        system: {
            loggerOptions: {
                loggerCallback: (level, message, containsPii) => {
                    if (containsPii) return;
                    console.log(`[MSAL] ${message}`);
                },
                logLevel: config.logLevel || 'Warning'
            }
        }
    };

    // Initialize MSAL instance safely
    msalInstance = new msalLib.PublicClientApplication(msalConfig);
    
    // Handle redirect promise
    try {
        const response = await msalInstance.handleRedirectPromise();
        return handleRedirectResponse(response);
    } catch (error) {
        console.error('MSAL redirect error:', error);
        throw error;
    }
}

/**
 * Handle response from redirect
 * @param {Object} response - MSAL response
 */
async function handleRedirectResponse(response) {
    if (response !== null) {
        console.log('Redirect response received:', response.account);
        return response;
    }
    return null;
}

/**
 * Initiate Entra sign-in flow
 * @param {Object} options - Login options
 */
export async function signInWithEntra(options = {}) {
    if (!msalInstance) {
        throw new Error('MSAL not initialized. Call initializeEntraAuth first.');
    }

    const loginRequest = {
        scopes: options.scopes || ['openid', 'profile', 'email', 'User.Read'],
        prompt: options.prompt || 'select_account',
        state: generateStateParameter()
    };

    try {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            const silentRequest = {
                ...loginRequest,
                account: accounts[0]
            };
            
            try {
                const response = await msalInstance.acquireTokenSilent(silentRequest);
                return await processAuthenticationResponse(response);
            } catch (silentError) {
                console.log('Silent sign-in failed, initiating interactive login');
            }
        }

        await msalInstance.loginRedirect(loginRequest);
        
    } catch (error) {
        console.error('Sign-in error:', error);
        await logAuthEvent('login', false, null, error.message);
        throw error;
    }
}

/**
 * Process authentication response and create session
 * @param {Object} response - MSAL authentication response
 */
export async function processAuthenticationResponse(response) {
    try {
        const account = response.account;
        const accessToken = response.accessToken;
        
        console.log('Processing authentication for:', account.username);

        const userInfo = await getUserInfoFromGraph(accessToken);
        const appUser = await findUserByEntraId(account.localAccountId);
        
        if (!appUser) {
            await logAuthEvent('login', false, account.localAccountId, 'User not found in system');
            throw new Error('USER_NOT_FOUND');
        }

        if (!appUser.is_active) {
            await logAuthEvent('login', false, account.localAccountId, 'User account is inactive');
            throw new Error('USER_INACTIVE');
        }

        if (!appUser.clinic_id) {
            await logAuthEvent('login', false, account.localAccountId, 'User not assigned to clinic');
            throw new Error('NO_CLINIC_ASSIGNED');
        }

        const session = await createApplicationSession(appUser, account, accessToken);
        await logAuthEvent('login', true, account.localAccountId, null);
        
        return {
            success: true,
            user: appUser,
            session: session,
            entraAccount: account
        };

    } catch (error) {
        console.error('Authentication processing error:', error);
        throw error;
    }
}

/**
 * Get user info from Microsoft Graph API
 * @param {string} accessToken - Access token
 */
async function getUserInfoFromGraph(accessToken) {
    try {
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user info from Graph API');
        }

        return await response.json();
    } catch (error) {
        console.error('Graph API error:', error);
        return null;
    }
}

/**
 * Find user in database by Entra ID
 * @param {string} entraUserId - Entra object ID
 */
async function findUserByEntraId(entraUserId) {
    try {
        const { data, error } = await supabase
            .rpc('find_user_by_entra_id', { p_entra_user_id: entraUserId });

        if (error) {
            console.error('Database error finding user:', error);
            return null;
        }

        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('Error finding user by Entra ID:', error);
        return null;
    }
}

/**
 * Create application session
 * @param {Object} user - Application user
 * @param {Object} entraAccount - Entra account
 * @param {string} accessToken - Access token
 */
async function createApplicationSession(user, entraAccount, accessToken) {
    const session = {
        user_id: user.user_id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        clinic_id: user.clinic_id,
        role: user.role,
        auth_provider: 'entra',
        entra_account: {
            id: entraAccount.localAccountId,
            username: entraAccount.username,
            name: entraAccount.name
        },
        access_token: accessToken,
        created_at: new Date().toISOString()
    };

    sessionStorage.setItem('dental_app_session', JSON.stringify(session));
    sessionStorage.setItem('dental_app_clinic_id', user.clinic_id);
    
    return session;
}

/**
 * Get current session
 */
export function getCurrentSession() {
    const sessionData = sessionStorage.getItem('dental_app_session');
    if (!sessionData) return null;
    
    try {
        return JSON.parse(sessionData);
    } catch (error) {
        console.error('Error parsing session:', error);
        return null;
    }
}

/**
 * Get current MSAL account
 */
export function getCurrentEntraAccount() {
    if (!msalInstance) return null;
    
    const accounts = msalInstance.getAllAccounts();
    return accounts.length > 0 ? accounts[0] : null;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
    const session = getCurrentSession();
    const entraAccount = getCurrentEntraAccount();
    
    return session !== null && entraAccount !== null;
}

/**
 * Acquire access token silently
 * @param {Array} scopes - Required scopes
 */
export async function acquireTokenSilently(scopes = ['User.Read']) {
    if (!msalInstance) {
        throw new Error('MSAL not initialized');
    }

    const account = getCurrentEntraAccount();
    if (!account) {
        throw new Error('No active account');
    }

    const request = {
        scopes: scopes,
        account: account
    };

    try {
        const response = await msalInstance.acquireTokenSilent(request);
        return response.accessToken;
    } catch (error) {
        console.error('Token acquisition error:', error);
        
        const msalLib = window.msal || window.Msal;
        if (msalLib?.InteractionRequiredAuthError && error instanceof msalLib.InteractionRequiredAuthError) {
            await msalInstance.acquireTokenRedirect(request);
        }
        
        throw error;
    }
}

/**
 * Sign out user
 */
export async function signOut() {
    try {
        const session = getCurrentSession();
        const entraUserId = session?.entra_account?.id;

        if (entraUserId) {
            await logAuthEvent('logout', true, entraUserId, null);
        }

        sessionStorage.removeItem('dental_app_session');
        sessionStorage.removeItem('dental_app_clinic_id');
        localStorage.clear();

        if (msalInstance) {
            const account = getCurrentEntraAccount();
            if (account) {
                const logoutRequest = {
                    account: account,
                    postLogoutRedirectUri: msalConfig.auth.postLogoutRedirectUri
                };
                await msalInstance.logoutRedirect(logoutRequest);
            }
        }

    } catch (error) {
        console.error('Sign-out error:', error);
        sessionStorage.clear();
        localStorage.clear();
        window.location.href = 'login.html';
    }
}

/**
 * Refresh user session
 */
export function refreshSession() {
    return acquireTokenSilently()
        .then(accessToken => {
            const session = getCurrentSession();
            if (session) {
                session.access_token = accessToken;
                sessionStorage.setItem('dental_app_session', JSON.stringify(session));
            }
            return session;
        })
        .catch(error => {
            console.error('Session refresh error:', error);
            throw error;
        });
}

/**
 * Log authentication event to audit log
 */
async function logAuthEvent(eventType, success, entraUserId, errorMessage) {
    try {
        const { error } = await supabase
            .from('auth_audit_log')
            .insert({
                auth_provider: 'entra',
                event_type: eventType,
                entra_user_id: entraUserId,
                success: success,
                error_message: errorMessage,
                ip_address: await getClientIP(),
                user_agent: navigator.userAgent,
                metadata: {
                    timestamp: new Date().toISOString(),
                    url: window.location.href
                }
            });

        if (error) {
            console.error('Error logging auth event:', error);
        }
    } catch (error) {
        console.error('Error in logAuthEvent:', error);
    }
}

/**
 * Get client IP address
 */
async function getClientIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        return 'unknown';
    }
}

/**
 * Generate secure state parameter
 */
function generateStateParameter() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Handle authentication errors
 */
export function handleAuthError(error) {
    console.error('Authentication error:', error);

    if (error.message === 'USER_NOT_FOUND') {
        return {
            title: 'Account Not Found',
            message: 'Your Microsoft account is not registered in the system. Please contact your administrator.',
            code: 'USER_NOT_FOUND'
        };
    }

    if (error.message === 'USER_INACTIVE') {
        return {
            title: 'Account Inactive',
            message: 'Your account has been deactivated. Please contact your administrator.',
            code: 'USER_INACTIVE'
        };
    }

    if (error.message === 'NO_CLINIC_ASSIGNED') {
        return {
            title: 'No Clinic Assignment',
            message: 'You have not been assigned to a clinic. Please contact your administrator.',
            code: 'NO_CLINIC_ASSIGNED'
        };
    }

    const msalLib = window.msal || window.Msal;
    if (msalLib?.BrowserAuthError && error instanceof msalLib.BrowserAuthError) {
        return {
            title: 'Authentication Error',
            message: 'Failed to authenticate with Microsoft. Please try again.',
            code: 'BROWSER_AUTH_ERROR'
        };
    }

    return {
        title: 'Authentication Failed',
        message: 'An unexpected error occurred. Please try again or contact support.',
        code: 'UNKNOWN_ERROR'
    };
}

/**
 * Validate session and redirect if not authenticated
 */
export function requireAuth() {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

/**
 * Get user display name from session
 */
export function getUserDisplayName() {
    const session = getCurrentSession();
    if (!session) return 'User';
    
    return session.first_name 
        ? `${session.first_name} ${session.last_name || ''}`.trim()
        : session.email;
}

export default {
    initializeEntraAuth,
    signInWithEntra,
    signOut,
    getCurrentSession,
    getCurrentEntraAccount,
    isAuthenticated,
    acquireTokenSilently,
    refreshSession,
    handleAuthError,
    requireAuth,
    getUserDisplayName
};
