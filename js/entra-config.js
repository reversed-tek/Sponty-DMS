/**
 * Microsoft Entra Configuration
 * Part 5: Entra Integration
 * 
 * INSTRUCTIONS:
 * 1. Register your application in Microsoft Entra admin center
 * 2. Copy the Client ID (Application ID) and Tenant ID
 * 3. Add redirect URI in Entra: https://YOUR_DOMAIN/auth-callback.html
 * 4. Replace the placeholder values below
 */

export const entraConfig = {
    // Replace with your Application (client) ID from Entra
    clientId: 'f22ddb91-c7e5-4aa3-b7ec-8daed605ec70',
    
    // Replace with your Directory (tenant) ID from Entra
    tenantId: '7cc6e8d5-0c87-4c60-af44-333eaf6d4d75',
    
    // Replace with your actual redirect URI (must match Entra registration)
    redirectUri: 'https://sponty-dms.vercel.app/auth-callback.html',
    
    // Optional: Custom logout redirect (defaults to redirectUri if not set)
    postLogoutRedirectUri: 'https://sponty-dms.vercel.app/login.html'
};
