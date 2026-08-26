/**
 * Patient Form Management
 * Handles patient add and edit forms with validation
 */

class PatientForm {
    constructor(mode = 'add') {
        this.mode = mode; // 'add' or 'edit'
        this.patientId = null;
        this.clinicId = null;
        this.originalData = null;
        
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
        
        // For edit mode, get patient ID from URL
        if (this.mode === 'edit') {
            const urlParams = new URLSearchParams(window.location.search);
            this.patientId = urlParams.get('id');
            
            if (!this.patientId) {
                showNotification('Patient ID not found', 'error');
                setTimeout(() => window.location.href = 'patients.html', 2000);
                return;
            }
            
            await this.loadPatient();
        } else {
            // Generate patient number for new patient
            await this.generatePatientNumber();
        }
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup date of birth listener for age calculation
        this.setupAgeCalculation();
    }
    
    async generatePatientNumber() {
        try {
            // Get the latest patient number for this clinic
            const { data, error } = await window.supabaseClient
                .from('patients')
                .select('patient_number')
                .eq('clinic_id', this.clinicId)
                .order('created_at', { ascending: false })
                .limit(1);
            
            if (error) throw error;
            
            let nextNumber = 1;
            
            if (data && data.length > 0) {
                // Extract number from format P-XXXX
                const lastNumber = data[0].patient_number;
                const match = lastNumber.match(/P-(\d+)/);
                if (match) {
                    nextNumber = parseInt(match[1]) + 1;
                }
            }
            
            // Format as P-0001, P-0002, etc.
            const patientNumber = `P-${String(nextNumber).padStart(4, '0')}`;
            
            const numberInput = document.getElementById('patientNumber');
            if (numberInput) {
                numberInput.value = patientNumber;
            }
            
        } catch (error) {
            console.error('Error generating patient number:', error);
            showNotification('Failed to generate patient number', 'error');
        }
    }
    
    async loadPatient() {
        try {
            showLoading('patientForm');
            
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
            
            this.originalData = data;
            this.populateForm(data);
            
        } catch (error) {
            console.error('Error loading patient:', error);
            showNotification('Failed to load patient', 'error');
        } finally {
            hideLoading('patientForm');
        }
    }
    
    populateForm(data) {
        // Basic information
        this.setFieldValue('patientNumber', data.patient_number);
        this.setFieldValue('firstName', data.first_name);
        this.setFieldValue('lastName', data.last_name);
        this.setFieldValue('dateOfBirth', data.date_of_birth);
        this.setFieldValue('gender', data.gender);
        this.setFieldValue('status', data.status);
        
        // Contact information
        this.setFieldValue('phone', data.phone);
        this.setFieldValue('email', data.email);
        this.setFieldValue('address', data.address);
        this.setFieldValue('city', data.city);
        this.setFieldValue('state', data.state);
        this.setFieldValue('zipCode', data.zip_code);
        
        // Emergency contact
        this.setFieldValue('emergencyName', data.emergency_contact_name);
        this.setFieldValue('emergencyPhone', data.emergency_contact_phone);
        this.setFieldValue('emergencyRelation', data.emergency_contact_relation);
        
        // Insurance information
        this.setFieldValue('insuranceProvider', data.insurance_provider);
        this.setFieldValue('insuranceNumber', data.insurance_number);
        this.setFieldValue('insuranceGroupNumber', data.insurance_group_number);
        
        // Medical information
        this.setFieldValue('allergies', data.allergies);
        this.setFieldValue('medicalNotes', data.medical_notes);
        
        // Calculate and display age
        this.calculateAge();
        
        // Update timestamps if available
        if (data.created_at) {
            const createdEl = document.getElementById('createdAt');
            if (createdEl) {
                createdEl.textContent = formatDateTime(data.created_at);
            }
        }
        
        if (data.updated_at) {
            const updatedEl = document.getElementById('updatedAt');
            if (updatedEl) {
                updatedEl.textContent = formatDateTime(data.updated_at);
            }
        }
    }
    
    setFieldValue(fieldId, value) {
        const field = document.getElementById(fieldId);
        if (field && value !== null && value !== undefined) {
            field.value = value;
        }
    }
    
    setupEventListeners() {
        // Save button
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.savePatient());
        }
        
        // Save and add another (add mode only)
        const saveAddBtn = document.getElementById('saveAddBtn');
        if (saveAddBtn && this.mode === 'add') {
            saveAddBtn.addEventListener('click', () => this.savePatient(true));
        }
        
        // Cancel button
        const cancelBtn = document.getElementById('cancelBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to cancel? Any unsaved changes will be lost.')) {
                    window.location.href = 'patients.html';
                }
            });
        }
        
        // View detail button (edit mode only)
        const viewBtn = document.getElementById('viewBtn');
        if (viewBtn && this.mode === 'edit') {
            viewBtn.addEventListener('click', () => {
                window.location.href = `patient-view.html?id=${this.patientId}`;
            });
        }
        
        // Form validation on input
        const form = document.getElementById('patientForm');
        if (form) {
            const requiredFields = form.querySelectorAll('[required]');
            requiredFields.forEach(field => {
                field.addEventListener('blur', () => this.validateField(field));
                field.addEventListener('input', () => {
                    if (field.classList.contains('error')) {
                        this.validateField(field);
                    }
                });
            });
        }
    }
    
    setupAgeCalculation() {
        const dobField = document.getElementById('dateOfBirth');
        if (dobField) {
            dobField.addEventListener('change', () => this.calculateAge());
        }
    }
    
    calculateAge() {
        const dobField = document.getElementById('dateOfBirth');
        const ageDisplay = document.getElementById('ageDisplay');
        
        if (dobField && ageDisplay && dobField.value) {
            const age = calculateAge(dobField.value);
            ageDisplay.textContent = `${age} years old`;
        }
    }
    
    validateField(field) {
        const value = field.value.trim();
        let isValid = true;
        let errorMessage = '';
        
        // Required field validation
        if (field.hasAttribute('required') && !value) {
            isValid = false;
            errorMessage = 'This field is required';
        }
        
        // Email validation
        if (field.type === 'email' && value) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                isValid = false;
                errorMessage = 'Please enter a valid email address';
            }
        }
        
        // Phone validation
        if (field.id === 'phone' && value) {
            const phoneRegex = /^[\d\s\-\+\(\)]+$/;
            if (!phoneRegex.test(value)) {
                isValid = false;
                errorMessage = 'Please enter a valid phone number';
            }
        }
        
        // Date of birth validation
        if (field.id === 'dateOfBirth' && value) {
            const dob = new Date(value);
            const today = new Date();
            if (dob > today) {
                isValid = false;
                errorMessage = 'Date of birth cannot be in the future';
            }
        }
        
        // Update field styling
        if (isValid) {
            field.classList.remove('error');
            this.removeFieldError(field);
        } else {
            field.classList.add('error');
            this.showFieldError(field, errorMessage);
        }
        
        return isValid;
    }
    
    showFieldError(field, message) {
        // Remove existing error
        this.removeFieldError(field);
        
        // Create error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'field-error';
        errorDiv.textContent = message;
        errorDiv.style.color = '#cc0000';
        errorDiv.style.fontSize = '11px';
        errorDiv.style.marginTop = '3px';
        
        // Insert after field
        field.parentNode.insertBefore(errorDiv, field.nextSibling);
    }
    
    removeFieldError(field) {
        const errorDiv = field.parentNode.querySelector('.field-error');
        if (errorDiv) {
            errorDiv.remove();
        }
    }
    
    validateForm() {
        const form = document.getElementById('patientForm');
        if (!form) return false;
        
        let isValid = true;
        const requiredFields = form.querySelectorAll('[required]');
        
        requiredFields.forEach(field => {
            if (!this.validateField(field)) {
                isValid = false;
            }
        });
        
        // Validate non-required fields with values
        const emailField = document.getElementById('email');
        if (emailField && emailField.value) {
            if (!this.validateField(emailField)) {
                isValid = false;
            }
        }
        
        const phoneField = document.getElementById('phone');
        if (phoneField && phoneField.value) {
            if (!this.validateField(phoneField)) {
                isValid = false;
            }
        }
        
        if (!isValid) {
            showNotification('Please fix the errors in the form', 'error');
        }
        
        return isValid;
    }
    
    getFormData() {
        return {
            patient_number: document.getElementById('patientNumber')?.value.trim(),
            first_name: document.getElementById('firstName')?.value.trim(),
            last_name: document.getElementById('lastName')?.value.trim(),
            date_of_birth: document.getElementById('dateOfBirth')?.value,
            gender: document.getElementById('gender')?.value,
            status: document.getElementById('status')?.value || 'active',
            phone: document.getElementById('phone')?.value.trim() || null,
            email: document.getElementById('email')?.value.trim() || null,
            address: document.getElementById('address')?.value.trim() || null,
            city: document.getElementById('city')?.value.trim() || null,
            state: document.getElementById('state')?.value.trim() || null,
            zip_code: document.getElementById('zipCode')?.value.trim() || null,
            emergency_contact_name: document.getElementById('emergencyName')?.value.trim() || null,
            emergency_contact_phone: document.getElementById('emergencyPhone')?.value.trim() || null,
            emergency_contact_relation: document.getElementById('emergencyRelation')?.value.trim() || null,
            insurance_provider: document.getElementById('insuranceProvider')?.value.trim() || null,
            insurance_number: document.getElementById('insuranceNumber')?.value.trim() || null,
            insurance_group_number: document.getElementById('insuranceGroupNumber')?.value.trim() || null,
            allergies: document.getElementById('allergies')?.value.trim() || null,
            medical_notes: document.getElementById('medicalNotes')?.value.trim() || null,
            clinic_id: this.clinicId
        };
    }
    
    async savePatient(addAnother = false) {
        try {
            // Validate form
            if (!this.validateForm()) {
                return;
            }
            
            const formData = this.getFormData();
            
            // Disable save buttons
            const saveBtn = document.getElementById('saveBtn');
            const saveAddBtn = document.getElementById('saveAddBtn');
            if (saveBtn) saveBtn.disabled = true;
            if (saveAddBtn) saveAddBtn.disabled = true;
            
            let result;
            
            if (this.mode === 'add') {
                // Insert new patient
                result = await window.supabaseClient
                    .from('patients')
                    .insert([formData])
                    .select()
                    .single();
                    
                if (result.error) throw result.error;
                
                showNotification('Patient added successfully', 'success');
                
                if (addAnother) {
                    // Reset form and generate new patient number
                    document.getElementById('patientForm').reset();
                    await this.generatePatientNumber();
                    
                    // Re-enable buttons
                    if (saveBtn) saveBtn.disabled = false;
                    if (saveAddBtn) saveAddBtn.disabled = false;
                } else {
                    // Redirect to patient view
                    setTimeout(() => {
                        window.location.href = `patient-view.html?id=${result.data.id}`;
                    }, 1500);
                }
                
            } else {
                // Update existing patient
                const { updated_at, created_at, id, ...updateData } = formData;
                
                result = await window.supabaseClient
                    .from('patients')
                    .update({
                        ...updateData,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', this.patientId)
                    .eq('clinic_id', this.clinicId)
                    .select()
                    .single();
                    
                if (result.error) throw result.error;
                
                showNotification('Patient updated successfully', 'success');
                
                // Reload patient data
                setTimeout(() => {
                    this.loadPatient();
                }, 1500);
            }
            
        } catch (error) {
            console.error('Error saving patient:', error);
            showNotification(`Failed to ${this.mode === 'add' ? 'add' : 'update'} patient`, 'error');
            
            // Re-enable buttons
            const saveBtn = document.getElementById('saveBtn');
            const saveAddBtn = document.getElementById('saveAddBtn');
            if (saveBtn) saveBtn.disabled = false;
            if (saveAddBtn) saveAddBtn.disabled = false;
        }
    }
}

// Initialize based on page
let patientForm;
document.addEventListener('DOMContentLoaded', () => {
    // Determine mode based on page
    const isEditPage = window.location.pathname.includes('patient-edit.html');
    const mode = isEditPage ? 'edit' : 'add';
    
    patientForm = new PatientForm(mode);
});
