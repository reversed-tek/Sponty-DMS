/**
 * AppointmentView - Handles appointment detail display and quick actions
 * Supports status updates, cancellation, and navigation
 */
class AppointmentView {
    constructor(appointmentId) {
        this.appointmentId = appointmentId;
        this.appointment = null;
    }

    async init() {
        try {
            await this.loadAppointment();
            this.updateActionButtons();
        } catch (error) {
            console.error('Error initializing appointment view:', error);
            showError('Failed to load appointment details');
        }
    }

    async loadAppointment() {
        try {
            showLoading();

            const { data, error } = await supabase
                .from('appointments')
                .select(`
                    *,
                    patient:patients(
                        id, 
                        first_name, 
                        last_name, 
                        patient_number, 
                        phone, 
                        email,
                        date_of_birth
                    ),
                    dentist:dentist_id(
                        id,
                        full_name,
                        email
                    )
                `)
                .eq('id', this.appointmentId)
                .single();

            if (error) throw error;

            this.appointment = data;
            this.displayAppointment();

            hideLoading();

        } catch (error) {
            hideLoading();
            console.error('Error loading appointment:', error);
            showError('Failed to load appointment details');
            
            setTimeout(() => {
                window.location.href = 'appointments.html';
            }, 2000);
        }
    }

    displayAppointment() {
        const apt = this.appointment;

        // Status with badge
        const statusBadge = `<span class="status-badge status-${apt.status}">${this.formatStatus(apt.status)}</span>`;
        document.getElementById('display-status').innerHTML = statusBadge;

        // Appointment details
        document.getElementById('display-date').textContent = formatDate(apt.appointment_date);
        document.getElementById('display-time').textContent = this.formatTime(apt.appointment_time);
        document.getElementById('display-duration').textContent = `${apt.duration_minutes} minutes`;
        document.getElementById('display-type').textContent = this.formatAppointmentType(apt.appointment_type);
        
        // Dentist
        if (apt.dentist) {
            document.getElementById('display-dentist').textContent = apt.dentist.full_name || apt.dentist.email;
        } else {
            document.getElementById('display-dentist').textContent = 'Not assigned';
        }

        // Patient details
        document.getElementById('display-patient-name').innerHTML = 
            `<a href="patient-view.html?id=${apt.patient.id}">${apt.patient.first_name} ${apt.patient.last_name}</a>`;
        document.getElementById('display-patient-number').textContent = apt.patient.patient_number;
        document.getElementById('display-phone').textContent = apt.patient.phone || '-';
        document.getElementById('display-email').textContent = apt.patient.email || '-';

        // Reason and notes
        document.getElementById('display-reason').textContent = apt.notes || '-';
        document.getElementById('display-notes').textContent = apt.notes || '-';

        // Metadata
        document.getElementById('display-created').textContent = formatDateTime(apt.created_at);
        document.getElementById('display-updated').textContent = formatDateTime(apt.updated_at);
    }

    updateActionButtons() {
        const status = this.appointment.status;

        // Show/hide buttons based on current status
        document.getElementById('confirm-btn').style.display = 
            (status === 'scheduled') ? 'inline-block' : 'none';

        document.getElementById('start-btn').style.display = 
            (status === 'scheduled' || status === 'confirmed') ? 'inline-block' : 'none';

        document.getElementById('complete-btn').style.display = 
            (status === 'in_progress') ? 'inline-block' : 'none';

        document.getElementById('cancel-btn').style.display = 
            (status !== 'cancelled' && status !== 'completed') ? 'inline-block' : 'none';

        document.getElementById('noshow-btn').style.display = 
            (status === 'scheduled' || status === 'confirmed') ? 'inline-block' : 'none';

        document.getElementById('reschedule-btn').style.display = 
            (status !== 'completed' && status !== 'cancelled') ? 'inline-block' : 'none';

        // Disable edit for completed/cancelled appointments
        if (status === 'completed' || status === 'cancelled') {
            document.getElementById('edit-btn').disabled = true;
            document.getElementById('edit-btn').title = 'Cannot edit completed or cancelled appointments';
        }
    }

    async confirmAppointment() {
        if (!confirm('Confirm this appointment?')) return;

        await this.updateStatus('confirmed', 'Appointment confirmed successfully');
    }

    async startAppointment() {
        if (!confirm('Mark this appointment as in progress?')) return;

        await this.updateStatus('in_progress', 'Appointment started');
    }

    async completeAppointment() {
        if (!confirm('Mark this appointment as completed?')) return;

        await this.updateStatus('completed', 'Appointment completed successfully');
    }

    async cancelAppointment() {
        const reason = prompt('Please provide a reason for cancellation:');
        if (reason === null) return; // User clicked cancel

        try {
            showLoading();

            const { error } = await supabase
                .from('appointments')
                .update({
                    status: 'cancelled',
                    notes: this.appointment.notes 
                        ? `${this.appointment.notes}\n\nCancellation reason: ${reason}`
                        : `Cancellation reason: ${reason}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', this.appointmentId);

            if (error) throw error;

            hideLoading();
            showSuccess('Appointment cancelled successfully');

            // Reload to update display
            await this.loadAppointment();
            this.updateActionButtons();

        } catch (error) {
            hideLoading();
            console.error('Error cancelling appointment:', error);
            showError('Failed to cancel appointment');
        }
    }

    async markNoShow() {
        if (!confirm('Mark this appointment as no-show?')) return;

        await this.updateStatus('no_show', 'Appointment marked as no-show');
    }

    async updateStatus(newStatus, successMessage) {
        try {
            showLoading();

            const { error } = await supabase
                .from('appointments')
                .update({
                    status: newStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('id', this.appointmentId);

            if (error) throw error;

            hideLoading();
            showSuccess(successMessage);

            // Reload to update display
            await this.loadAppointment();
            this.updateActionButtons();

        } catch (error) {
            hideLoading();
            console.error('Error updating appointment status:', error);
            showError('Failed to update appointment status');
        }
    }

    rescheduleAppointment() {
        // Navigate to edit form
        window.location.href = `appointment-form.html?id=${this.appointmentId}`;
    }

    editAppointment() {
        window.location.href = `appointment-form.html?id=${this.appointmentId}`;
    }

    viewPatient() {
        window.location.href = `patient-view.html?id=${this.appointment.patient.id}`;
    }

    printAppointment() {
        window.print();
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
