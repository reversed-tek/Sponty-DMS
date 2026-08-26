// Clinical Notes Management Module
let currentPatient = null;
let currentUser = null;
let allNotes = [];
let allUsers = [];
let allAppointments = [];
let editingNoteId = null;

// Initialize page
async function initializePage() {
    try {
        // Get patient ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        const patientId = urlParams.get('patient_id');
        
        if (!patientId) {
            showError('No patient selected');
            setTimeout(() => window.location.href = 'patients.html', 2000);
            return;
        }

        // Get current user
        currentUser = await getCurrentUser();
        if (!currentUser) {
            window.location.href = 'login.html';
            return;
        }

        // Load patient data
        await loadPatient(patientId);
        
        // Load related data
        await Promise.all([
            loadUsers(),
            loadAppointments(patientId)
        ]);
        
        // Load clinical notes
        await loadClinicalNotes(patientId);
        
        // Setup event listeners
        setupEventListeners();
        
        // Show medical alerts if any
        showMedicalAlerts();
        
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to load page data');
    }
}

// Load patient data
async function loadPatient(patientId) {
    try {
        const { data, error } = await supabase
            .from('patients')
            .select('*')
            .eq('id', patientId)
            .eq('clinic_id', currentUser.clinic_id)
            .single();
            
        if (error) throw error;
        if (!data) throw new Error('Patient not found');
        
        currentPatient = data;
        
        // Update page header
        const patientName = `${data.first_name} ${data.last_name}`;
        document.getElementById('patientInfo').textContent = patientName;
        document.getElementById('patientBreadcrumb').textContent = patientName;
        
    } catch (error) {
        console.error('Error loading patient:', error);
        throw error;
    }
}

// Load users for filter and form
async function loadUsers() {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, first_name, last_name, role')
            .eq('clinic_id', currentUser.clinic_id)
            .in('role', ['dentist', 'admin'])
            .order('first_name');
            
        if (error) throw error;
        
        allUsers = data || [];
        
        // Populate dentist filter
        const dentistFilter = document.getElementById('dentistFilter');
        allUsers.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.first_name} ${user.last_name}`;
            dentistFilter.appendChild(option);
        });
        
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Load appointments for the form dropdown
async function loadAppointments(patientId) {
    try {
        const { data, error } = await supabase
            .from('appointments')
            .select('id, appointment_date, appointment_time, appointment_type')
            .eq('patient_id', patientId)
            .eq('clinic_id', currentUser.clinic_id)
            .order('appointment_date', { ascending: false })
            .limit(20);
            
        if (error) throw error;
        
        allAppointments = data || [];
        
        // Populate appointment dropdown
        const appointmentSelect = document.getElementById('appointmentId');
        appointmentSelect.innerHTML = '<option value="">None</option>';
        
        allAppointments.forEach(apt => {
            const option = document.createElement('option');
            option.value = apt.id;
            const date = new Date(apt.appointment_date).toLocaleDateString();
            option.textContent = `${date} - ${apt.appointment_time} (${apt.appointment_type})`;
            appointmentSelect.appendChild(option);
        });
        
    } catch (error) {
        console.error('Error loading appointments:', error);
    }
}

// Load clinical notes
async function loadClinicalNotes(patientId) {
    try {
        const { data, error } = await supabase
            .from('clinical_notes')
            .select(`
                *,
                created_by_user:users!clinical_notes_created_by_fkey(first_name, last_name)
            `)
            .eq('patient_id', patientId)
            .eq('clinic_id', currentUser.clinic_id)
            .order('note_date', { ascending: false });
            
        if (error) throw error;
        
        allNotes = data || [];
        displayNotes(allNotes);
        
    } catch (error) {
        console.error('Error loading clinical notes:', error);
        showError('Failed to load clinical notes');
    }
}

// Display notes
function displayNotes(notes) {
    const container = document.getElementById('notesContainer');
    const emptyState = document.getElementById('emptyState');
    
    if (!notes || notes.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    
    let html = '<div class="notes-list">';
    
    notes.forEach(note => {
        const createdBy = note.created_by_user ? 
            `${note.created_by_user.first_name} ${note.created_by_user.last_name}` : 
            'Unknown';
        const noteDate = new Date(note.note_date).toLocaleDateString();
        const createdDate = new Date(note.created_at).toLocaleString();
        
        const categoryClass = `category-${note.category}`;
        const privateLabel = note.is_private ? '<span class="badge badge-warning">Private</span>' : '';
        
        html += `
            <div class="note-card" data-note-id="${note.id}">
                <div class="note-header">
                    <div class="note-header-left">
                        <span class="note-category ${categoryClass}">${formatCategory(note.category)}</span>
                        ${privateLabel}
                        <span class="note-date">${noteDate}</span>
                    </div>
                    <div class="note-header-right">
                        <button class="btn-icon" onclick="editNote('${note.id}')" title="Edit">✏️</button>
                        <button class="btn-icon" onclick="deleteNote('${note.id}')" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="note-body">
                    ${note.chief_complaint ? `
                        <div class="note-section">
                            <div class="note-label">Chief Complaint:</div>
                            <div class="note-text">${escapeHtml(note.chief_complaint)}</div>
                        </div>
                    ` : ''}
                    
                    <div class="note-section">
                        <div class="note-label">Clinical Findings:</div>
                        <div class="note-text">${escapeHtml(note.clinical_findings)}</div>
                    </div>
                    
                    ${note.diagnosis_summary ? `
                        <div class="note-section">
                            <div class="note-label">Diagnosis:</div>
                            <div class="note-text">${escapeHtml(note.diagnosis_summary)}</div>
                        </div>
                    ` : ''}
                    
                    ${note.treatment_plan ? `
                        <div class="note-section">
                            <div class="note-label">Treatment Plan:</div>
                            <div class="note-text">${escapeHtml(note.treatment_plan)}</div>
                        </div>
                    ` : ''}
                    
                    ${note.additional_notes ? `
                        <div class="note-section">
                            <div class="note-label">Additional Notes:</div>
                            <div class="note-text">${escapeHtml(note.additional_notes)}</div>
                        </div>
                    ` : ''}
                </div>
                <div class="note-footer">
                    <span class="note-meta">By ${escapeHtml(createdBy)} on ${createdDate}</span>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Format category for display
function formatCategory(category) {
    const categories = {
        'general': 'General',
        'follow_up': 'Follow-up',
        'emergency': 'Emergency',
        'consultation': 'Consultation',
        'treatment': 'Treatment'
    };
    return categories[category] || category;
}

// Show medical alerts
function showMedicalAlerts() {
    const alertsDiv = document.getElementById('medicalAlerts');
    
    if (!currentPatient) return;
    
    let alerts = [];
    
    if (currentPatient.allergies) {
        alerts.push({
            type: 'danger',
            icon: '⚠️',
            message: `Allergies: ${currentPatient.allergies}`
        });
    }
    
    if (currentPatient.medical_notes) {
        alerts.push({
            type: 'warning',
            icon: '📋',
            message: `Medical Notes: ${currentPatient.medical_notes}`
        });
    }
    
    if (alerts.length > 0) {
        let html = '<div class="medical-alerts">';
        alerts.forEach(alert => {
            html += `
                <div class="alert alert-${alert.type}">
                    <span class="alert-icon">${alert.icon}</span>
                    <span class="alert-message">${escapeHtml(alert.message)}</span>
                </div>
            `;
        });
        html += '</div>';
        
        alertsDiv.innerHTML = html;
        alertsDiv.style.display = 'block';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Add note buttons
    document.getElementById('addNoteBtn').addEventListener('click', () => openNoteModal());
    document.getElementById('addFirstNoteBtn').addEventListener('click', () => openNoteModal());
    
    // Back button
    document.getElementById('backToPatientBtn').addEventListener('click', () => {
        window.location.href = `patient-view.html?id=${currentPatient.id}`;
    });
    
    // Modal controls
    document.getElementById('closeModal').addEventListener('click', closeNoteModal);
    document.getElementById('cancelBtn').addEventListener('click', closeNoteModal);
    
    // Form submit
    document.getElementById('noteForm').addEventListener('submit', handleFormSubmit);
    
    // Search and filters
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('categoryFilter').addEventListener('change', applyFilters);
    document.getElementById('dentistFilter').addEventListener('change', applyFilters);
    document.getElementById('dateFromFilter').addEventListener('change', applyFilters);
    document.getElementById('dateToFilter').addEventListener('change', applyFilters);
    document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);
    
    // Export and print
    document.getElementById('exportCsvBtn').addEventListener('click', exportToCSV);
    document.getElementById('printBtn').addEventListener('click', printNotes);
}

// Open note modal
function openNoteModal(noteId = null) {
    editingNoteId = noteId;
    const modal = document.getElementById('noteModal');
    const form = document.getElementById('noteForm');
    const modalTitle = document.getElementById('modalTitle');
    
    form.reset();
    
    if (noteId) {
        modalTitle.textContent = 'Edit Clinical Note';
        const note = allNotes.find(n => n.id === noteId);
        if (note) {
            document.getElementById('noteId').value = note.id;
            document.getElementById('noteDate').value = note.note_date;
            document.getElementById('noteCategory').value = note.category;
            document.getElementById('appointmentId').value = note.appointment_id || '';
            document.getElementById('chiefComplaint').value = note.chief_complaint || '';
            document.getElementById('clinicalFindings').value = note.clinical_findings || '';
            document.getElementById('diagnosisSummary').value = note.diagnosis_summary || '';
            document.getElementById('treatmentPlan').value = note.treatment_plan || '';
            document.getElementById('additionalNotes').value = note.additional_notes || '';
            document.getElementById('isPrivate').checked = note.is_private || false;
        }
    } else {
        modalTitle.textContent = 'Add Clinical Note';
        document.getElementById('noteDate').value = new Date().toISOString().split('T')[0];
    }
    
    modal.style.display = 'block';
}

// Close note modal
function closeNoteModal() {
    document.getElementById('noteModal').style.display = 'none';
    editingNoteId = null;
}

// Handle form submit
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
        const noteData = {
            patient_id: currentPatient.id,
            clinic_id: currentUser.clinic_id,
            note_date: document.getElementById('noteDate').value,
            category: document.getElementById('noteCategory').value,
            appointment_id: document.getElementById('appointmentId').value || null,
            chief_complaint: document.getElementById('chiefComplaint').value || null,
            clinical_findings: document.getElementById('clinicalFindings').value,
            diagnosis_summary: document.getElementById('diagnosisSummary').value || null,
            treatment_plan: document.getElementById('treatmentPlan').value || null,
            additional_notes: document.getElementById('additionalNotes').value || null,
            is_private: document.getElementById('isPrivate').checked,
            created_by: currentUser.id
        };
        
        let result;
        
        if (editingNoteId) {
            // Update existing note
            result = await supabase
                .from('clinical_notes')
                .update(noteData)
                .eq('id', editingNoteId)
                .eq('clinic_id', currentUser.clinic_id)
                .select();
        } else {
            // Create new note
            result = await supabase
                .from('clinical_notes')
                .insert([noteData])
                .select();
        }
        
        if (result.error) throw result.error;
        
        showSuccess(editingNoteId ? 'Clinical note updated successfully' : 'Clinical note added successfully');
        closeNoteModal();
        await loadClinicalNotes(currentPatient.id);
        
    } catch (error) {
        console.error('Error saving note:', error);
        showError('Failed to save clinical note');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Note';
    }
}

// Edit note
function editNote(noteId) {
    openNoteModal(noteId);
}

// Delete note
async function deleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this clinical note? This action cannot be undone.')) {
        return;
    }
    
    try {
        const { error } = await supabase
            .from('clinical_notes')
            .delete()
            .eq('id', noteId)
            .eq('clinic_id', currentUser.clinic_id);
            
        if (error) throw error;
        
        showSuccess('Clinical note deleted successfully');
        await loadClinicalNotes(currentPatient.id);
        
    } catch (error) {
        console.error('Error deleting note:', error);
        showError('Failed to delete clinical note');
    }
}

// Apply filters
function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const categoryFilter = document.getElementById('categoryFilter').value;
    const dentistFilter = document.getElementById('dentistFilter').value;
    const dateFrom = document.getElementById('dateFromFilter').value;
    const dateTo = document.getElementById('dateToFilter').value;
    
    let filtered = allNotes.filter(note => {
        // Search filter
        if (searchTerm) {
            const searchableText = [
                note.chief_complaint,
                note.clinical_findings,
                note.diagnosis_summary,
                note.treatment_plan,
                note.additional_notes
            ].join(' ').toLowerCase();
            
            if (!searchableText.includes(searchTerm)) return false;
        }
        
        // Category filter
        if (categoryFilter && note.category !== categoryFilter) return false;
        
        // Dentist filter
        if (dentistFilter && note.created_by !== dentistFilter) return false;
        
        // Date range filter
        if (dateFrom && note.note_date < dateFrom) return false;
        if (dateTo && note.note_date > dateTo) return false;
        
        return true;
    });
    
    displayNotes(filtered);
}

// Clear filters
function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('categoryFilter').value = '';
    document.getElementById('dentistFilter').value = '';
    document.getElementById('dateFromFilter').value = '';
    document.getElementById('dateToFilter').value = '';
    displayNotes(allNotes);
}

// Export to CSV
function exportToCSV() {
    if (allNotes.length === 0) {
        showError('No notes to export');
        return;
    }
    
    const headers = ['Date', 'Category', 'Chief Complaint', 'Clinical Findings', 'Diagnosis', 'Treatment Plan', 'Created By'];
    const rows = allNotes.map(note => [
        note.note_date,
        formatCategory(note.category),
        note.chief_complaint || '',
        note.clinical_findings || '',
        note.diagnosis_summary || '',
        note.treatment_plan || '',
        note.created_by_user ? `${note.created_by_user.first_name} ${note.created_by_user.last_name}` : 'Unknown'
    ]);
    
    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clinical_notes_${currentPatient.first_name}_${currentPatient.last_name}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Print notes
function printNotes() {
    window.print();
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializePage);
