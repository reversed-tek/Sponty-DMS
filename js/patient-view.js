/**
 * Patient View/Detail Management
 * Handles patient detail display with tabbed interface
 */

class PatientView {
    constructor() {
        this.patientId = null;
        this.clinicId = null;
        this.patient = null;
        this.currentTab = 'contact';
        
        this.init();
    }
    
    async init() {
        // Check authentication
        const user = await checkAuth();
        if (!user) return;
        
        // Get user profile
        const profile = await window.supabaseClient
            .from('profiles')
            .select('clinic_id')
            .eq('id', user.id)
            .single();
            
        if (!profile.data?.clinic_id) {
            showNotification('No clinic assigned to your account', 'error');
            return;
        }
        
        this.clinicId = profile.data.clinic_id;
        
        // Get patient ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        this.patientId = urlParams.get('id');
        
        if (!this.patientId) {
            showNotification('Patient ID not found', 'error');
            setTimeout(() => window.location.href = 'patients.html', 2000);
            return;
        }
        
        // Load patient data
        await this.loadPatient();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Show default tab
        this.showTab('contact');
    }
    
    async loadPatient() {
        try {
            showLoading('patientDetails');
            
            const { data, error } = await window.supabaseClient
                .from('patients')
                .select('*')
                .eq('id', this.patientId)
                .eq('clinic_id', this.clinicId)
                .single();
            
            if (error) throw error;
            
            if (!data) {
                showNotification('Patient not found', 'error');
                setTimeout(() => window.location.href = 'patients.html', 2000);
                return;
            }
            
            this.patient = data;
            this.displayPatient();
            
        } catch (error) {
            console.error('Error loading patient:', error);
            showNotification('Failed to load patient', 'error');
        } finally {
            hideLoading('patientDetails');
        }
    }
    
    displayPatient() {
        if (!this.patient) return;
        
        const age = calculateAge(this.patient.date_of_birth);
        
        // Update patient summary
        document.getElementById('patientName').textContent = 
            `${this.patient.first_name} ${this.patient.last_name}`;
        
        document.getElementById('patientNumber').textContent = 
            this.patient.patient_number;
        
        document.getElementById('patientAge').textContent = 
            `${age} years old`;
        
        document.getElementById('patientGender').textContent = 
            this.patient.gender || 'Not specified';
        
        const statusBadge = document.getElementById('patientStatus');
        statusBadge.textContent = this.patient.status;
        statusBadge.className = `status-badge ${this.patient.status}`;
        
        // Display contact information
        this.displayContactInfo();
        
        // Display medical information
        this.displayMedicalInfo();
        
        // Load related data for other tabs
        this.loadAppointments();
        this.loadTreatments();
        this.loadBillingInfo();
    }
    
    displayContactInfo() {
        const data = this.patient;
        
        this.setInfoValue('phoneInfo', data.phone);
        this.setInfoValue('emailInfo', data.email);
        
        const address = [
            data.address,
            data.city,
            data.state,
            data.zip_code
        ].filter(Boolean).join(', ');
        
        this.setInfoValue('addressInfo', address);
        this.setInfoValue('dobInfo', formatDate(data.date_of_birth));
        this.setInfoValue('emergencyNameInfo', data.emergency_contact_name);
        this.setInfoValue('emergencyPhoneInfo', data.emergency_contact_phone);
        this.setInfoValue('emergencyRelationInfo', data.emergency_contact_relation);
    }
    
    displayMedicalInfo() {
        const data = this.patient;
        
        this.setInfoValue('insuranceProviderInfo', data.insurance_provider);
        this.setInfoValue('insuranceNumberInfo', data.insurance_number);
        this.setInfoValue('insuranceGroupInfo', data.insurance_group_number);
        this.setInfoValue('allergiesInfo', data.allergies);
        this.setInfoValue('medicalNotesInfo', data.medical_notes);
    }
    
    setInfoValue(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            if (value) {
                element.textContent = value;
                element.classList.remove('empty');
            } else {
                element.textContent = 'Not provided';
                element.classList.add('empty');
            }
        }
    }
    
    async loadAppointments() {
        try {
            const { data, error } = await window.supabaseClient
                .from('appointments')
                .select('*')
                .eq('patient_id', this.patientId)
                .order('appointment_date', { ascending: false })
                .limit(10);
            
            if (error) throw error;
            
            const container = document.getElementById('appointmentsContent');
            if (!container) return;
            
            if (!data || data.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <div style="font-size: 16px; margin-bottom: 10px;">No appointments found</div>
                        <div style="font-size: 13px;">Schedule an appointment to get started</div>
                    </div>
                `;
                return;
            }
            
            // Display appointments
            const html = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Time</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(apt => `
                            <tr>
                                <td>${formatDate(apt.appointment_date)}</td>
                                <td>${apt.appointment_time || '-'}</td>
                                <td>${escapeHtml(apt.appointment_type || '-')}</td>
                                <td>${escapeHtml(apt.status || '-')}</td>
                                <td>${escapeHtml(apt.notes || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
            
            container.innerHTML = html;
            
        } catch (error) {
            console.error('Error loading appointments:', error);
            const container = document.getElementById('appointmentsContent');
            if (container) {
                container.innerHTML = `
                    <div style="color: #cc0000; padding: 20px;">
                        Failed to load appointments
                    </div>
                `;
            }
        }
    }
    
    async loadTreatments() {
        try {
            const { data, error } = await window.supabaseClient
                .from('treatments')
                .select('*')
                .eq('patient_id', this.patientId)
                .order('treatment_date', { ascending: false })
                .limit(10);
            
            if (error) throw error;
            
            const container = document.getElementById('treatmentsContent');
            if (!container) return;
            
            if (!data || data.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <div style="font-size: 16px; margin-bottom: 10px;">No treatments found</div>
                        <div style="font-size: 13px;">Treatment history will appear here</div>
                    </div>
                `;
                return;
            }
            
            // Display treatments
            const html = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Tooth</th>
                            <th>Procedure</th>
                            <th>Status</th>
                            <th>Cost</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(treatment => `
                            <tr>
                                <td>${formatDate(treatment.treatment_date)}</td>
                                <td>${escapeHtml(treatment.tooth_number || '-')}</td>
                                <td>${escapeHtml(treatment.procedure_name || '-')}</td>
                                <td>${escapeHtml(treatment.status || '-')}</td>
                                <td>${treatment.cost ? '$' + parseFloat(treatment.cost).toFixed(2) : '-'}</td>
                                <td>${escapeHtml(treatment.notes || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
            
            container.innerHTML = html;
            
        } catch (error) {
            console.error('Error loading treatments:', error);
            const container = document.getElementById('treatmentsContent');
            if (container) {
                container.innerHTML = `
                    <div style="color: #cc0000; padding: 20px;">
                        Failed to load treatments
                    </div>
                `;
            }
        }
    }
    
    async loadBillingInfo() {
        try {
            // Load invoices with items
            const { data, error } = await window.supabaseClient
                .from('invoices')
                .select(`
                    *,
                    invoice_items (*)
                `)
                .eq('patient_id', this.patientId)
                .order('invoice_date', { ascending: false })
                .limit(10);
            
            if (error) throw error;
            
            const container = document.getElementById('billingContent');
            if (!container) return;
            
            if (!data || data.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <div style="font-size: 16px; margin-bottom: 10px;">No invoices found</div>
                        <div style="font-size: 13px;">Billing information will appear here</div>
                    </div>
                `;
                return;
            }
            
            // Calculate totals
            let totalBilled = 0;
            let totalPaid = 0;
            let totalBalance = 0;
            
            data.forEach(invoice => {
                totalBilled += parseFloat(invoice.total_amount || 0);
                totalPaid += parseFloat(invoice.paid_amount || 0);
                totalBalance += parseFloat(invoice.balance || 0);
            });
            
            // Display billing summary and invoices
            const html = `
                <div class="form-grid" style="margin-bottom: 20px;">
                    <div class="form-group">
                        <label>Total Billed:</label>
                        <div class="info-value" style="font-weight: bold;">
                            $${totalBilled.toFixed(2)}
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Total Paid:</label>
                        <div class="info-value" style="font-weight: bold; color: #008000;">
                            $${totalPaid.toFixed(2)}
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Total Balance:</label>
                        <div class="info-value" style="font-weight: bold; color: ${totalBalance > 0 ? '#cc0000' : '#008000'};">
                            $${totalBalance.toFixed(2)}
                        </div>
                    </div>
                </div>
                
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Paid</th>
                            <th>Balance</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(invoice => `
                            <tr>
                                <td>${escapeHtml(invoice.invoice_number)}</td>
                                <td>${formatDate(invoice.invoice_date)}</td>
                                <td>$${parseFloat(invoice.total_amount || 0).toFixed(2)}</td>
                                <td>$${parseFloat(invoice.paid_amount || 0).toFixed(2)}</td>
                                <td>$${parseFloat(invoice.balance || 0).toFixed(2)}</td>
                                <td>${escapeHtml(invoice.status || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
            
            container.innerHTML = html;
            
        } catch (error) {
            console.error('Error loading billing info:', error);
            const container = document.getElementById('billingContent');
            if (container) {
                container.innerHTML = `
                    <div style="color: #cc0000; padding: 20px;">
                        Failed to load billing information
                    </div>
                `;
            }
        }
    }
    
    setupEventListeners() {
        // Tab buttons
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabName = button.getAttribute('data-tab');
                this.showTab(tabName);
            });
        });
        
        // Edit button
        const editBtn = document.getElementById('editBtn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                window.location.href = `patient-edit.html?id=${this.patientId}`;
            });
        }
        
        // Print button
        const printBtn = document.getElementById('printBtn');
        if (printBtn) {
            printBtn.addEventListener('click', () => this.printPatient());
        }
        
        // Back button
        const backBtn = document.getElementById('backBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                window.location.href = 'patients.html';
            });
        }
        
        // Part 4: Patient Records Navigation Links
        const clinicalNotesLink = document.getElementById('clinicalNotesLink');
        if (clinicalNotesLink) {
            clinicalNotesLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = `clinical-notes.html?patient_id=${this.patientId}`;
            });
        }
        
        const medicalHistoryLink = document.getElementById('medicalHistoryLink');
        if (medicalHistoryLink) {
            medicalHistoryLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = `medical-history.html?patient_id=${this.patientId}`;
            });
        }
        
        const dentalChartLink = document.getElementById('dentalChartLink');
        if (dentalChartLink) {
            dentalChartLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = `dental-chart.html?patient_id=${this.patientId}`;
            });
        }
        
        const appointmentsLink = document.getElementById('appointmentsLink');
        if (appointmentsLink) {
            appointmentsLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = `appointments.html?patient_id=${this.patientId}`;
            });
        }
    }
    
    showTab(tabName) {
        // Update buttons
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            if (button.getAttribute('data-tab') === tabName) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
        
        // Update content
        const tabContents = document.querySelectorAll('.tab-content');
        tabContents.forEach(content => {
            if (content.id === `${tabName}Tab`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
        
        this.currentTab = tabName;
    }
    
    printPatient() {
        window.print();
    }
}

// Initialize
let patientView;
document.addEventListener('DOMContentLoaded', () => {
    patientView = new PatientView();
});
