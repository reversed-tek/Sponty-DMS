/**
 * Outlook Calendar Integration
 * Uses MSAL + Microsoft Graph to create calendar events from appointments.
 */

const GRAPH_CALENDAR_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/events';
const CALENDAR_SCOPES = ['Calendars.ReadWrite'];

/**
 * Get all MSAL accounts available for calendar sync.
 * @returns {Array} MSAL account objects
 */
export function getEntraAccounts() {
    const msalLib = window.msal || window.Msal;
    if (!msalLib) return [];

    // Find the active MSAL instance via the global cache
    // MSAL stores the instance internally; we access accounts from session
    try {
        const instance = getMsalInstance();
        if (!instance) return [];
        return instance.getAllAccounts() || [];
    } catch (e) {
        console.error('[OutlookCal] Error listing accounts:', e);
        return [];
    }
}

/**
 * Acquire a calendar-scoped access token for a specific account.
 * Falls back to interactive consent if the scope hasn't been granted yet.
 * @param {Object} account - MSAL account object
 * @returns {Promise<string>} Access token
 */
export async function getCalendarToken(account) {
    const instance = getMsalInstance();
    if (!instance) throw new Error('MSAL not initialized');
    if (!account) throw new Error('No account provided');

    const request = {
        scopes: CALENDAR_SCOPES,
        account: account
    };

    try {
        const response = await instance.acquireTokenSilent(request);
        return response.accessToken;
    } catch (silentError) {
        console.log('[OutlookCal] Silent token failed, trying interactive consent');
        const msalLib = window.msal || window.Msal;
        if (msalLib?.InteractionRequiredAuthError &&
            silentError instanceof msalLib.InteractionRequiredAuthError) {
            // Use popup so the form state is preserved
            const response = await instance.acquireTokenPopup(request);
            return response.accessToken;
        }
        throw silentError;
    }
}

/**
 * Create an Outlook calendar event via Microsoft Graph.
 * @param {string} accessToken - Calendar-scoped token
 * @param {Object} appointmentData - Appointment form data
 * @param {string} patientName - Display name of the patient
 * @returns {Promise<Object>} Created event from Graph API
 */
export async function createCalendarEvent(accessToken, appointmentData, patientName) {
    const payload = buildEventPayload(appointmentData, patientName);

    const response = await fetch(GRAPH_CALENDAR_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const msg = errorBody?.error?.message || response.statusText;
        throw new Error(`Graph API error: ${msg}`);
    }

    return response.json();
}

/**
 * Build a Microsoft Graph event payload from appointment data.
 * @param {Object} d - Appointment fields (appointment_date, appointment_time, duration_minutes, appointment_type, notes)
 * @param {string} patientName - Patient display name
 * @returns {Object} Graph event resource
 */
export function buildEventPayload(d, patientName) {
    const startDateTime = `${d.appointment_date}T${d.appointment_time}`;

    // Calculate end time
    const [h, m] = d.appointment_time.split(':').map(Number);
    const totalMin = h * 60 + m + (d.duration_minutes || 30);
    const endH = String(Math.floor(totalMin / 60)).padStart(2, '0');
    const endM = String(totalMin % 60).padStart(2, '0');
    const endDateTime = `${d.appointment_date}T${endH}:${endM}:00`;

    const typeLabel = (d.appointment_type || 'appointment')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

    return {
        subject: `${typeLabel} — ${patientName}`,
        body: {
            contentType: 'Text',
            content: d.notes || `Dental ${typeLabel} for ${patientName}`
        },
        start: {
            dateTime: startDateTime,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
            dateTime: endDateTime,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        isReminderOn: true,
        reminderMinutesBeforeStart: 15
    };
}

/**
 * Locate the active MSAL PublicClientApplication instance.
 * MSAL stores its instance on the global; we look for it via the known
 * pattern used in entra-auth.js.
 */
function getMsalInstance() {
    // entra-auth keeps msalInstance in module scope — not directly accessible.
    // However MSAL v2 browser registers instances and we can reconstruct from
    // session storage keys, OR we piggyback on the same pattern:
    // look for any PublicClientApplication on window.
    const msalLib = window.msal || window.Msal;
    if (!msalLib) return null;

    // Try to find cached instance
    if (window.__msalInstance) return window.__msalInstance;

    // If entra-auth exposes it (will be wired in Task 4)
    return null;
}

/**
 * Set the shared MSAL instance (called from entra-auth initialization).
 * @param {Object} instance - PublicClientApplication
 */
export function setMsalInstance(instance) {
    window.__msalInstance = instance;
}
