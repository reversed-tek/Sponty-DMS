// Main Application Script
import { checkAuth, logout, getCurrentUserWithProfile } from './auth.js';
import { supabase, checkSupabaseConfig } from './supabase.js';
import { showNotification, formatDate, formatTime } from './ui.js';
import { isToday } from './utils.js';

// Make logout available globally
window.logout = logout;

// Initialize app
async function init() {
    try {
        // Check authentication
        const user = await checkAuth();
        if (!user) return;
        
        // Check Supabase config
        if (!checkSupabaseConfig()) {
            showNotification('Supabase is not configured. Please update configuration.', 'warning');
        }
        
        // Load user info
        await loadUserInfo();
        
        // Load dashboard data
        await loadDashboard();
        
        // Setup navigation
        setupNavigation();
        
        // Setup status bar time
        updateStatusTime();
        setInterval(updateStatusTime, 1000);
        
    } catch (error) {
        console.error('Initialization error:', error);
        showNotification('Error initializing application', 'error');
    }
}

// Load user information
async function loadUserInfo() {
    try {
        const user = await getCurrentUserWithProfile();
        
        if (user) {
            const displayName = user.profile?.full_name || user.email || 'User';
            const role = user.profile?.role || 'staff';
            
            document.getElementById('currentUser').textContent = displayName;
            document.getElementById('statusUser').textContent = displayName;
            document.getElementById('statusRole').textContent = role.charAt(0).toUpperCase() + role.slice(1);
        }
    } catch (error) {
        console.error('Error loading user info:', error);
        // Use fallback from Entra session
        const session = await import('./entra-auth.js').then(m => m.getCurrentSession());
        if (session) {
            const displayName = session.first_name 
                ? `${session.first_name} ${session.last_name || ''}`.trim()
                : session.email;
            document.getElementById('currentUser').textContent = displayName;
            document.getElementById('statusUser').textContent = displayName;
            document.getElementById('statusRole').textContent = (session.role || 'User').charAt(0).toUpperCase() + (session.role || 'User').slice(1);
        }
    }
}

// Load dashboard data
async function loadDashboard() {
    try {
        // Load statistics
        await loadStatistics();
        
        // Load recent patients
        await loadRecentPatients();
        
        // Load today's schedule
        await loadTodaySchedule();
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showNotification('Error loading dashboard data', 'error');
    }
}

// Load statistics
async function loadStatistics() {
    try {
        // Today's appointments
        const today = new Date().toISOString().split('T')[0];
        const { count: todayCount, error: todayError } = await supabase
            .from('appointments')
            .select('*', { count: 'exact', head: true })
            .gte('appointment_date', today)
            .lt('appointment_date', new Date(Date.now() + 86400000).toISOString().split('T')[0]);
        
        if (!todayError) {
            document.getElementById('statTodayAppointments').textContent = todayCount || 0;
        }
        
        // Total patients
        const { count: patientCount, error: patientError } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'active');
        
        if (!patientError) {
            document.getElementById('statTotalPatients').textContent = patientCount || 0;
        }
        
        // Pending appointments
        const { count: pendingCount, error: pendingError } = await supabase
            .from('appointments')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'scheduled');
        
        if (!pendingError) {
            document.getElementById('statPendingAppointments').textContent = pendingCount || 0;
        }
        
        // Unpaid invoices
        const { count: unpaidCount, error: unpaidError } = await supabase
            .from('invoices')
            .select('*', { count: 'exact', head: true })
            .neq('status', 'paid');
        
        if (!unpaidError) {
            document.getElementById('statUnpaidInvoices').textContent = unpaidCount || 0;
        }
        
    } catch (error) {
        console.error('Error loading statistics:', error);
        // Set default values on error
        document.getElementById('statTodayAppointments').textContent = '0';
        document.getElementById('statTotalPatients').textContent = '0';
        document.getElementById('statPendingAppointments').textContent = '0';
        document.getElementById('statUnpaidInvoices').textContent = '0';
    }
}

// Load recent patients
async function loadRecentPatients() {
    try {
        const { data, error } = await supabase
            .from('patients')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);
        
        const tbody = document.getElementById('recentPatientsTable');
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No patients registered yet</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.map(patient => `
            <tr>
                <td>${patient.patient_id || '-'}</td>
                <td>${patient.first_name} ${patient.last_name}</td>
                <td>${patient.phone || '-'}</td>
                <td>${formatDate(patient.created_at)}</td>
                <td><span class="status-badge status-${patient.status}">${patient.status}</span></td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Error loading recent patients:', error);
        document.getElementById('recentPatientsTable').innerHTML = 
            '<tr><td colspan="5" class="table-empty">No recent patients</td></tr>';
    }
}

// Load today's schedule
async function loadTodaySchedule() {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const { data, error } = await supabase
            .from('appointments')
            .select(`
                *,
                patients (first_name, last_name)
            `)
            .eq('appointment_date', today)
            .order('appointment_time', { ascending: true });
        
        const tbody = document.getElementById('todayScheduleTable');
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No appointments scheduled for today</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.map(apt => `
            <tr>
                <td>${formatTime(apt.appointment_time)}</td>
                <td>${apt.patients ? `${apt.patients.first_name} ${apt.patients.last_name}` : '-'}</td>
                <td>${apt.appointment_type || '-'}</td>
                <td><span class="status-badge status-${apt.status}">${apt.status}</span></td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Error loading today\'s schedule:', error);
        document.getElementById('todayScheduleTable').innerHTML = 
            '<tr><td colspan="4" class="table-empty">No appointments today</td></tr>';
    }
}

// Setup navigation
function setupNavigation() {
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    
    sidebarItems.forEach(item => {
        item.addEventListener('click', function() {
            // Remove active class from all items
            sidebarItems.forEach(i => i.classList.remove('active'));
            
            // Add active class to clicked item
            this.classList.add('active');
            
            // Get page name
            const page = this.getAttribute('data-page');
            
            // Load page content
            loadPage(page);
        });
    });
}

// Load page content
function loadPage(page) {
    const contentArea = document.getElementById('contentArea');
    
    switch(page) {
        case 'dashboard':
            // Reload dashboard
            contentArea.scrollTop = 0;
            loadDashboard();
            break;
            
        case 'patients':
            contentArea.innerHTML = '<div class="page-title">Patient Management</div><p>Patient management coming in Part 2...</p>';
            break;
            
        case 'appointments':
            contentArea.innerHTML = '<div class="page-title">Appointments</div><p>Appointment management coming in Part 3...</p>';
            break;
            
        case 'dental-records':
            contentArea.innerHTML = '<div class="page-title">Dental Records</div><p>Dental records coming in Part 4...</p>';
            break;
            
        case 'dental-chart':
            contentArea.innerHTML = '<div class="page-title">Dental Chart</div><p>Interactive dental chart coming in Part 4...</p>';
            break;
            
        case 'treatments':
            contentArea.innerHTML = '<div class="page-title">Treatments</div><p>Treatment management coming in Part 4...</p>';
            break;
            
        case 'billing':
            contentArea.innerHTML = '<div class="page-title">Billing</div><p>Billing system coming in Part 5...</p>';
            break;
            
        case 'reports':
            contentArea.innerHTML = '<div class="page-title">Reports</div><p>Reports coming in Part 6...</p>';
            break;
            
        case 'users':
            contentArea.innerHTML = '<div class="page-title">User Management</div><p>User management coming in Part 6...</p>';
            break;
            
        case 'settings':
            contentArea.innerHTML = '<div class="page-title">Settings</div><p>Settings coming in Part 6...</p>';
            break;
            
        default:
            contentArea.innerHTML = '<div class="page-title">Page Not Found</div>';
    }
}

// Update status bar time
function updateStatusTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
    });
    const dateString = now.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
    });
    
    document.getElementById('statusTime').textContent = `${dateString} ${timeString}`;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
