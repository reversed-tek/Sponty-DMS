/**
 * AppointmentManager - Handles appointment calendar and list views
 * Supports day, week, month, and list views with filtering and search
 */
class AppointmentManager {
    constructor() {
        this.currentView = 'week'; // day, week, month, list
        this.currentDate = new Date();
        this.appointments = [];
        this.patients = [];
        this.filters = {
            search: '',
            status: '',
            type: '',
            patient: ''
        };
        this.clinicId = null;
    }

    async init() {
        try {
            // Get user's clinic
            // Get user's clinic from Entra session
            const currentUser = await getCurrentUser();
            if (!currentUser || !currentUser.clinic_id) {
                throw new Error('No clinic assigned to user');
            }
            this.clinicId = currentUser.clinic_id;

            // Load patients for filter dropdown
            await this.loadPatients();

            // Set up event listeners
            this.setupEventListeners();

            // Set initial view
            this.changeView('week');

        } catch (error) {
            console.error('Error initializing appointments:', error);
            showError('Failed to initialize appointments page');
        }
    }

    setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('search-appointments');
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => {
                this.filters.search = e.target.value;
                this.loadAndRenderAppointments();
            }, 300));
        }

        // Filter dropdowns
        ['filter-status', 'filter-type', 'filter-patient'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', (e) => {
                    const filterName = id.replace('filter-', '');
                    this.filters[filterName] = e.target.value;
                    this.loadAndRenderAppointments();
                });
            }
        });
    }

    async loadPatients() {
        try {
            const { data, error } = await supabase
                .from('patients')
                .select('id, first_name, last_name, patient_number')
                .eq('clinic_id', this.clinicId)
                .eq('status', 'active')
                .order('last_name', { ascending: true });

            if (error) throw error;

            this.patients = data || [];

            // Populate patient filter dropdown
            const patientFilter = document.getElementById('filter-patient');
            if (patientFilter) {
                patientFilter.innerHTML = '<option value="">All Patients</option>';
                this.patients.forEach(patient => {
                    const option = document.createElement('option');
                    option.value = patient.id;
                    option.textContent = `${patient.last_name}, ${patient.first_name} (${patient.patient_number})`;
                    patientFilter.appendChild(option);
                });
            }

        } catch (error) {
            console.error('Error loading patients:', error);
        }
    }

    async loadAndRenderAppointments() {
        try {
            showLoading();

            // Determine date range based on current view
            let startDate, endDate;
            
            if (this.currentView === 'day') {
                startDate = new Date(this.currentDate);
                endDate = new Date(this.currentDate);
            } else if (this.currentView === 'week') {
                startDate = this.getStartOfWeek(this.currentDate);
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 6);
            } else if (this.currentView === 'month') {
                startDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
                endDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
            } else {
                // List view - show 30 days from today
                startDate = new Date();
                endDate = new Date();
                endDate.setDate(endDate.getDate() + 30);
            }

            // Build query
            let query = supabase
                .from('appointments')
                .select(`
                    *,
                    patient:patients(id, first_name, last_name, patient_number, phone, email)
                `)
                .eq('clinic_id', this.clinicId)
                .gte('appointment_date', startDate.toISOString().split('T')[0])
                .lte('appointment_date', endDate.toISOString().split('T')[0])
                .order('appointment_date', { ascending: true })
                .order('appointment_time', { ascending: true });

            // Apply filters
            if (this.filters.status) {
                query = query.eq('status', this.filters.status);
            }
            if (this.filters.type) {
                query = query.eq('appointment_type', this.filters.type);
            }
            if (this.filters.patient) {
                query = query.eq('patient_id', this.filters.patient);
            }

            const { data, error } = await query;

            if (error) throw error;

            this.appointments = data || [];

            // Apply search filter on client side (for patient name)
            if (this.filters.search) {
                const searchLower = this.filters.search.toLowerCase();
                this.appointments = this.appointments.filter(apt => {
                    const patientName = `${apt.patient.first_name} ${apt.patient.last_name}`.toLowerCase();
                    return patientName.includes(searchLower);
                });
            }

            // Render based on current view
            this.renderView();

            hideLoading();

        } catch (error) {
            hideLoading();
            console.error('Error loading appointments:', error);
            showError('Failed to load appointments');
        }
    }

    renderView() {
        // Update active view button
        ['day', 'week', 'month', 'list'].forEach(view => {
            const btn = document.getElementById(`view-${view}`);
            if (btn) {
                btn.classList.toggle('active', view === this.currentView);
            }
        });

        // Update period header
        this.updatePeriodHeader();

        // Render appropriate view
        switch (this.currentView) {
            case 'day':
                this.renderDayView();
                break;
            case 'week':
                this.renderWeekView();
                break;
            case 'month':
                this.renderMonthView();
                break;
            case 'list':
                this.renderListView();
                break;
        }
    }

    updatePeriodHeader() {
        const header = document.getElementById('current-period');
        if (!header) return;

        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        
        if (this.currentView === 'day') {
            header.textContent = this.currentDate.toLocaleDateString('en-US', options);
        } else if (this.currentView === 'week') {
            const startOfWeek = this.getStartOfWeek(this.currentDate);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(endOfWeek.getDate() + 6);
            header.textContent = `${startOfWeek.toLocaleDateString('en-US', options)} - ${endOfWeek.toLocaleDateString('en-US', options)}`;
        } else if (this.currentView === 'month') {
            header.textContent = this.currentDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        } else {
            header.textContent = 'All Appointments';
        }
    }

    renderDayView() {
        const container = document.getElementById('appointments-container');
        if (!container) return;

        const dateStr = this.currentDate.toISOString().split('T')[0];
        const dayAppointments = this.appointments.filter(apt => apt.appointment_date === dateStr);

        let html = '<div class="calendar-day-view">';
        html += '<div class="time-slots">';

        // Generate time slots from 8 AM to 6 PM
        for (let hour = 8; hour <= 18; hour++) {
            for (let minute = 0; minute < 60; minute += 15) {
                const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
                const appointments = dayAppointments.filter(apt => apt.appointment_time === timeStr);

                html += `<div class="time-slot" data-time="${timeStr}">`;
                html += `<div class="time-label">${this.formatTime(timeStr)}</div>`;
                html += `<div class="time-slot-content">`;

                appointments.forEach(apt => {
                    html += this.renderAppointmentCard(apt);
                });

                html += '</div></div>';
            }
        }

        html += '</div></div>';
        container.innerHTML = html;
    }

    renderWeekView() {
        const container = document.getElementById('appointments-container');
        if (!container) return;

        const startOfWeek = this.getStartOfWeek(this.currentDate);
        
        let html = '<div class="calendar-week-view">';
        html += '<div class="week-header">';

        // Day headers
        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(date.getDate() + i);
            const isToday = this.isToday(date);
            
            html += `<div class="day-header ${isToday ? 'today' : ''}">`;
            html += `<div class="day-name">${date.toLocaleDateString('en-US', { weekday: 'short' })}</div>`;
            html += `<div class="day-date">${date.getDate()}</div>`;
            html += '</div>';
        }

        html += '</div><div class="week-days">';

        // Day columns
        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            const dayAppointments = this.appointments.filter(apt => apt.appointment_date === dateStr);
            const isToday = this.isToday(date);

            html += `<div class="day-column ${isToday ? 'today' : ''}">`;
            
            dayAppointments.forEach(apt => {
                html += this.renderAppointmentCard(apt, true);
            });

            if (dayAppointments.length === 0) {
                html += '<div class="no-appointments">No appointments</div>';
            }

            html += '</div>';
        }

        html += '</div></div>';
        container.innerHTML = html;
    }

    renderMonthView() {
        const container = document.getElementById('appointments-container');
        if (!container) return;

        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDay = firstDay.getDay(); // 0 = Sunday
        const daysInMonth = lastDay.getDate();

        let html = '<div class="calendar-month-view">';
        html += '<div class="month-header">';
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
            html += `<div class="month-day-name">${day}</div>`;
        });
        html += '</div><div class="month-days">';

        // Empty cells before first day
        for (let i = 0; i < startDay; i++) {
            html += '<div class="month-day empty"></div>';
        }

        // Days of month
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toISOString().split('T')[0];
            const dayAppointments = this.appointments.filter(apt => apt.appointment_date === dateStr);
            const isToday = this.isToday(date);

            html += `<div class="month-day ${isToday ? 'today' : ''}" data-date="${dateStr}">`;
            html += `<div class="month-day-number">${day}</div>`;
            html += `<div class="month-day-appointments">`;

            dayAppointments.slice(0, 3).forEach(apt => {
                const statusClass = `status-${apt.status}`;
                html += `<div class="month-appointment ${statusClass}" onclick="appointmentManager.viewAppointment('${apt.id}')">`;
                html += `${this.formatTime(apt.appointment_time)} - ${apt.patient.first_name} ${apt.patient.last_name}`;
                html += '</div>';
            });

            if (dayAppointments.length > 3) {
                html += `<div class="more-appointments">+${dayAppointments.length - 3} more</div>`;
            }

            html += '</div></div>';
        }

        html += '</div></div>';
        container.innerHTML = html;
    }

    renderListView() {
        const container = document.getElementById('appointments-container');
        if (!container) return;

        if (this.appointments.length === 0) {
            container.innerHTML = '<div class="no-data">No appointments found</div>';
            return;
        }

        let html = '<div class="appointments-list">';
        html += '<table class="data-table">';
        html += '<thead><tr>';
        html += '<th>Date</th>';
        html += '<th>Time</th>';
        html += '<th>Patient</th>';
        html += '<th>Type</th>';
        html += '<th>Duration</th>';
        html += '<th>Status</th>';
        html += '<th>Actions</th>';
        html += '</tr></thead><tbody>';

        this.appointments.forEach(apt => {
            const statusClass = `status-${apt.status}`;
            html += '<tr>';
            html += `<td>${formatDate(apt.appointment_date)}</td>`;
            html += `<td>${this.formatTime(apt.appointment_time)}</td>`;
            html += `<td><a href="patient-view.html?id=${apt.patient.id}">${apt.patient.first_name} ${apt.patient.last_name}</a></td>`;
            html += `<td>${this.formatAppointmentType(apt.appointment_type)}</td>`;
            html += `<td>${apt.duration_minutes} min</td>`;
            html += `<td><span class="status-badge ${statusClass}">${this.formatStatus(apt.status)}</span></td>`;
            html += '<td>';
            html += `<button onclick="appointmentManager.viewAppointment('${apt.id}')" class="btn-small">View</button> `;
            html += `<button onclick="appointmentManager.editAppointment('${apt.id}')" class="btn-small">Edit</button>`;
            html += '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        html += '</div>';
        container.innerHTML = html;
    }

    renderAppointmentCard(apt, compact = false) {
        const statusClass = `status-${apt.status}`;
        let html = `<div class="appointment-card ${statusClass}" onclick="appointmentManager.viewAppointment('${apt.id}')">`;
        
        if (!compact) {
            html += `<div class="apt-time">${this.formatTime(apt.appointment_time)}</div>`;
        }
        
        html += `<div class="apt-patient">${apt.patient.first_name} ${apt.patient.last_name}</div>`;
        html += `<div class="apt-type">${this.formatAppointmentType(apt.appointment_type)}</div>`;
        html += `<div class="apt-duration">${apt.duration_minutes} min</div>`;
        html += `<div class="apt-status"><span class="status-badge ${statusClass}">${this.formatStatus(apt.status)}</span></div>`;
        html += '</div>';
        
        return html;
    }

    changeView(view) {
        this.currentView = view;
        this.loadAndRenderAppointments();
    }

    previousPeriod() {
        if (this.currentView === 'day') {
            this.currentDate.setDate(this.currentDate.getDate() - 1);
        } else if (this.currentView === 'week') {
            this.currentDate.setDate(this.currentDate.getDate() - 7);
        } else if (this.currentView === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        }
        this.loadAndRenderAppointments();
    }

    nextPeriod() {
        if (this.currentView === 'day') {
            this.currentDate.setDate(this.currentDate.getDate() + 1);
        } else if (this.currentView === 'week') {
            this.currentDate.setDate(this.currentDate.getDate() + 7);
        } else if (this.currentView === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        }
        this.loadAndRenderAppointments();
    }

    goToToday() {
        this.currentDate = new Date();
        this.loadAndRenderAppointments();
    }

    clearFilters() {
        this.filters = { search: '', status: '', type: '', patient: '' };
        document.getElementById('search-appointments').value = '';
        document.getElementById('filter-status').value = '';
        document.getElementById('filter-type').value = '';
        document.getElementById('filter-patient').value = '';
        this.loadAndRenderAppointments();
    }

    showAddForm() {
        window.location.href = 'appointment-form.html';
    }

    viewAppointment(id) {
        window.location.href = `appointment-view.html?id=${id}`;
    }

    editAppointment(id) {
        window.location.href = `appointment-form.html?id=${id}`;
    }

    async exportToCSV() {
        if (this.appointments.length === 0) {
            showError('No appointments to export');
            return;
        }

        const headers = ['Date', 'Time', 'Patient', 'Phone', 'Type', 'Duration', 'Status', 'Notes'];
        const rows = this.appointments.map(apt => [
            apt.appointment_date,
            this.formatTime(apt.appointment_time),
            `${apt.patient.first_name} ${apt.patient.last_name}`,
            apt.patient.phone || '',
            this.formatAppointmentType(apt.appointment_type),
            `${apt.duration_minutes} min`,
            this.formatStatus(apt.status),
            apt.notes || ''
        ]);

        const csv = [headers, ...rows].map(row => 
            row.map(cell => `"${cell}"`).join(',')
        ).join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `appointments-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        showSuccess('Appointments exported successfully');
    }

    printSchedule() {
        window.print();
    }

    // Helper methods
    getStartOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day;
        return new Date(d.setDate(diff));
    }

    isToday(date) {
        const today = new Date();
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    }

    formatTime(timeStr) {
        const [hours, minutes] = timeStr.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
        return `${displayHour}:${minutes} ${ampm}`;
    }

    formatAppointmentType(type) {
        const types = {
            'checkup': 'Checkup',
            'cleaning': 'Cleaning',
            'filling': 'Filling',
            'extraction': 'Extraction',
            'root_canal': 'Root Canal',
            'crown': 'Crown',
            'emergency': 'Emergency',
            'consultation': 'Consultation',
            'other': 'Other'
        };
        return types[type] || type;
    }

    formatStatus(status) {
        const statuses = {
            'scheduled': 'Scheduled',
            'confirmed': 'Confirmed',
            'in_progress': 'In Progress',
            'completed': 'Completed',
            'cancelled': 'Cancelled',
            'no_show': 'No Show'
        };
        return statuses[status] || status;
    }
}
