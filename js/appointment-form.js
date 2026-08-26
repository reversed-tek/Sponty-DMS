/**
 * AppointmentForm - Handles appointment creation and editing
 * Includes validation, conflict detection, and patient selection
 */
class AppointmentForm {
    constructor(appointmentId = null, patientId = null) {
        this.appointmentId = appointmentId;
        this.preSelectedPatientId = patientId;
        this.clinicId = null;
        this.patients = [];
        this.dentists = [];
        this.isEditMode = !!appointmentId;
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

            // Load data
            await this.loadPatients();
            await this.loadDentists();
            this.generateTimeSlots();

            // Set up form
            this.setupEventListeners();

            if (this.isEditMode) {
                document.getElementById('form-title').textContent = '📅 Edit Appointment';
                await this.loadAppointment();
            } else if (this.preSelectedPatientId) {
                document.getElementById('patient-id').value = this.preSelectedPatientId;
                this.showPatientInfo();
            }

            // Set minimum date to today
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('appointment-date').min = today;

        } catch (error) {
            console.error('Error initializing form:', error);
            showError('Failed to initialize appointment form');
        }
    }

    async loadPatients() {
        try {
            const { data, error } = await supabase
                .from('patients')
                .select('id, first_name, last_name, patient_number, phone, email')
                .eq('clinic_id', this.clinicId)
                .eq('status', 'active')
                .order('last_name', { ascending: true });

            if (error) throw error;

            this.patients = data || [];

            // Populate patient dropdown
            const patientSelect = document.getElementById('patient-id');
            patientSelect.innerHTML = '<option value="">-- Select Patient --</option>';
            
            this.patients.forEach(patient => {
                const option = document.createElement('option');
                option.value = patient.id;
                option.textContent = `${patient.last_name}, ${patient.first_name} (${patient.patient_number})`;
                option.dataset.phone = patient.phone || '';
                option.dataset.email = patient.email || '';
                option.dataset.patientNumber = patient.patient_number;
                patientSelect.appendChild(option);
            });

        } catch (error) {
            console.error('Error loading patients:', error);
            showError('Failed to load patients');
        }
    }

    async loadDentists() {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, email, full_name')
                .eq('clinic_id', this.clinicId)
                .eq('role', 'dentist')
                .order('full_name', { ascending: true });

            if (error) throw error;

            this.dentists = data || [];

            // Populate dentist dropdown
            const dentistSelect = document.getElementById('dentist-id');
            dentistSelect.innerHTML = '<option value="">-- Not Assigned --</option>';
            
            this.dentists.forEach(dentist => {
                const option = document.createElement('option');
                option.value = dentist.id;
                option.textContent = dentist.full_name || dentist.email;
                dentistSelect.appendChild(option);
            });

        } catch (error) {
            console.error('Error loading dentists:', error);
            // Non-critical error, continue without dentists
        }
    }

    generateTimeSlots() {
        const timeSelect = document.getElementById('appointment-time');
        timeSelect.innerHTML = '<option value="">-- Select Time --</option>';

        // Generate slots from 8 AM to 6 PM in 15-minute intervals
        for (let hour = 8; hour <= 18; hour++) {
            for (let minute = 0; minute < 60; minute += 15) {
                // Don't add slots after 6 PM
                if (hour === 18 && minute > 0) break;

                const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
                const displayTime = this.formatTime(timeStr);
                
                const option = document.createElement('option');
                option.value = timeStr;
                option.textContent = displayTime;
                timeSelect.appendChild(option);
            }
        }
    }

    setupEventListeners() {
        // Form submission
        const form = document.getElementById('appointment-form');
        form.addEventListener('submit', (e) => this.handleSubmit(e));

        // Patient selection
        const patientSelect = document.getElementById('patient-id');
        patientSelect.addEventListener('change', () => this.showPatientInfo());

        // Date/time change - check for conflicts
        const dateInput = document.getElementById('appointment-date');
        const timeInput = document.getElementById('appointment-time');
        const durationInput = document.getElementById('duration');

        dateInput.addEventListener('change', () => this.checkConflicts());
        timeInput.addEventListener('change', () => this.checkConflicts());
        durationInput.addEventListener('change', () => this.checkConflicts());
    }

    showPatientInfo() {
        const patientSelect = document.getElementById('patient-id');
        const selectedOption = patientSelect.options[patientSelect.selectedIndex];
        const infoBox = document.getElementById('patient-info');

        if (selectedOption && selectedOption.value) {
            document.getElementById('display-patient-number').textContent = selectedOption.dataset.patientNumber || '-';
            document.getElementById('display-phone').textContent = selectedOption.dataset.phone || '-';
            document.getElementById('display-email').textContent = selectedOption.dataset.email || '-';
            infoBox.style.display = 'block';
        } else {
            infoBox.style.display = 'none';
        }
    }

    async loadAppointment() {
        try {
            showLoading();

            const { data, error } = await supabase
                .from('appointments')
                .select(`
                    *,
                    patient:patients(id, first_name, last_name, patient_number, phone, email)
                `)
                .eq('id', this.appointmentId)
                .single();

            if (error) throw error;

            // Populate form fields
            document.getElementById('patient-id').value = data.patient_id;
            document.getElementById('appointment-date').value = data.appointment_date;
            document.getElementById('appointment-time').value = data.appointment_time;
            document.getElementById('appointment-type').value = data.appointment_type;
            document.getElementById('duration').value = data.duration_minutes;
            document.getElementById('status').value = data.status;
            document.getElementById('dentist-id').value = data.dentist_id || '';
            document.getElementById('notes').value = data.notes || '';

            this.showPatientInfo();

            hideLoading();

        } catch (error) {
            hideLoading();
            console.error('Error loading appointment:', error);
            showError('Failed to load appointment details');
        }
    }

    async checkConflicts() {
        const patientId = document.getElementById('patient-id').value;
        const date = document.getElementById('appointment-date').value;
        const time = document.getElementById('appointment-time').value;
        const duration = parseInt(document.getElementById('duration').value);

        if (!patientId || !date || !time || !duration) {
            this.hideConflictWarning();
            return;
        }

        try {
            // Calculate end time
            const [hours, minutes] = time.split(':').map(Number);
            const startMinutes = hours * 60 + minutes;
            const endMinutes = startMinutes + duration;

            // Query for overlapping appointments
            let query = supabase
                .from('appointments')
                .select('id, appointment_time, duration_minutes, patient:patients(first_name, last_name)')
                .eq('appointment_date', date)
                .eq('clinic_id', this.clinicId)
                .neq('status', 'cancelled')
                .neq('status', 'no_show');

            // Exclude current appointment if editing
            if (this.isEditMode) {
                query = query.neq('id', this.appointmentId);
            }

            const { data, error } = await query;

            if (error) throw error;

            // Check for overlaps
            const conflicts = data.filter(apt => {
                const [aptHours, aptMinutes] = apt.appointment_time.split(':').map(Number);
                const aptStartMinutes = aptHours * 60 + aptMinutes;
                const aptEndMinutes = aptStartMinutes + apt.duration_minutes;

                // Check if appointments overlap
                return (startMinutes < aptEndMinutes && endMinutes > aptStartMinutes);
            });

            if (conflicts.length > 0) {
                const messages = conflicts.map(apt => {
                    return `${this.formatTime(apt.appointment_time)} - ${apt.patient.first_name} ${apt.patient.last_name}`;
                }).join(', ');
                
                this.showConflictWarning(`Overlapping appointments: ${messages}`);
            } else {
                this.hideConflictWarning();
            }

        } catch (error) {
            console.error('Error checking conflicts:', error);
        }
    }

    showConflictWarning(message) {
        const warningBox = document.getElementById('conflict-warning');
        const messageSpan = document.getElementById('conflict-message');
        messageSpan.textContent = message;
        warningBox.style.display = 'block';
    }

    hideConflictWarning() {
        const warningBox = document.getElementById('conflict-warning');
        warningBox.style.display = 'none';
    }

    async handleSubmit(e) {
        e.preventDefault();

        if (!this.validateForm()) {
            return;
        }

        try {
            showLoading();

            const formData = {
                patient_id: document.getElementById('patient-id').value,
                clinic_id: this.clinicId,
                appointment_date: document.getElementById('appointment-date').value,
                appointment_time: document.getElementById('appointment-time').value,
                duration_minutes: parseInt(document.getElementById('duration').value),
                appointment_type: document.getElementById('appointment-type').value,
                status: document.getElementById('status').value,
                dentist_id: document.getElementById('dentist-id').value || null,
                notes: document.getElementById('notes').value || null
            };

            let result;
            if (this.isEditMode) {
                // Update existing appointment
                result = await supabase
                    .from('appointments')
                    .update(formData)
                    .eq('id', this.appointmentId);
            } else {
                // Create new appointment
                const currentUser = await getCurrentUser();
                formData.created_by = currentUser.user_id;

                result = await supabase
                    .from('appointments')
                    .insert(formData);
            }

            if (result.error) throw result.error;

            hideLoading();
            showSuccess(this.isEditMode ? 'Appointment updated successfully' : 'Appointment created successfully');

            // Redirect after short delay
            setTimeout(() => {
                window.location.href = 'appointments.html';
            }, 1000);

        } catch (error) {
            hideLoading();
            console.error('Error saving appointment:', error);
            showError('Failed to save appointment: ' + error.message);
        }
    }

    validateForm() {
        const patientId = document.getElementById('patient-id').value;
        const date = document.getElementById('appointment-date').value;
        const time = document.getElementById('appointment-time').value;
        const type = document.getElementById('appointment-type').value;

        if (!patientId) {
            showError('Please select a patient');
            document.getElementById('patient-id').focus();
            return false;
        }

        if (!date) {
            showError('Please select an appointment date');
            document.getElementById('appointment-date').focus();
            return false;
        }

        // Check if date is not in the past
        const selectedDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (selectedDate < today && !this.isEditMode) {
            showError('Appointment date cannot be in the past');
            document.getElementById('appointment-date').focus();
            return false;
        }

        if (!time) {
            showError('Please select an appointment time');
            document.getElementById('appointment-time').focus();
            return false;
        }

        if (!type) {
            showError('Please select an appointment type');
            document.getElementById('appointment-type').focus();
            return false;
        }

        return true;
    }

    formatTime(timeStr) {
        const [hours, minutes] = timeStr.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
        return `${displayHour}:${minutes} ${ampm}`;
    }
}
