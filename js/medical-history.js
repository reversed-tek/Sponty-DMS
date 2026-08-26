// Medical History Management Module
let currentPatient = null;
let currentUser = null;
let allConditions = [];
let allMedications = [];
let allAllergies = [];
let currentTab = 'conditions';
let editingItemId = null;
let editingItemType = null;

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
        
        // Load all medical history data
        await Promise.all([
            loadConditions(patientId),
            loadMedications(patientId),
            loadAllergies(patientId)
        ]);
        
        // Setup event listeners
        setupEventListeners();
        
        // Show active tab
        showTab('conditions');
        
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

// Load medical conditions
async function loadConditions(patientId) {
    try {
        const { data, error } = await supabase
            .from('medical_conditions')
            .select('*')
            .eq('patient_id', patientId)
            .eq('clinic_id', currentUser.clinic_id)
            .order('diagnosed_date', { ascending: false });
            
        if (error) throw error;
        
        allConditions = data || [];
        displayConditions();
        
    } catch (error) {
        console.error('Error loading conditions:', error);
        showError('Failed to load medical conditions');
    }
}

// Load medications
async function loadMedications(patientId) {
    try {
        const { data, error } = await supabase
            .from('medications')
            .select('*')
            .eq('patient_id', patientId)
            .eq('clinic_id', currentUser.clinic_id)
            .order('start_date', { ascending: false });
            
        if (error) throw error;
        
        allMedications = data || [];
        displayMedications();
        
    } catch (error) {
        console.error('Error loading medications:', error);
        showError('Failed to load medications');
    }
}

// Load allergies
async function loadAllergies(patientId) {
    try {
        const { data, error } = await supabase
            .from('patient_allergies')
            .select('*')
            .eq('patient_id', patientId)
            .eq('clinic_id', currentUser.clinic_id)
            .order('onset_date', { ascending: false });
            
        if (error) throw error;
        
        allAllergies = data || [];
        displayAllergies();
        
    } catch (error) {
        console.error('Error loading allergies:', error);
        showError('Failed to load allergies');
    }
}

// Display medical conditions
function displayConditions() {
    const container = document.getElementById('conditionsContainer');
    const emptyState = document.getElementById('conditionsEmpty');
    
    if (!allConditions || allConditions.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    
    let html = '<div class="medical-records-list">';
    
    allConditions.forEach(condition => {
        const typeClass = `type-${condition.condition_type}`;
        const severityBadge = condition.severity ? 
            `<span class="badge badge-${getSeverityColor(condition.severity)}">${condition.severity}</span>` : '';
        const diagnosedDate = condition.diagnosed_date ? 
            new Date(condition.diagnosed_date).toLocaleDateString() : 'Not specified';
        const resolvedDate = condition.resolved_date ? 
            `<div class="record-meta">Resolved: ${new Date(condition.resolved_date).toLocaleDateString()}</div>` : '';
        
        html += `
            <div class="medical-record-card">
                <div class="record-header">
                    <div class="record-title">
                        <strong>${escapeHtml(condition.condition_name)}</strong>
                        <span class="record-type ${typeClass}">${formatConditionType(condition.condition_type)}</span>
                        ${severityBadge}
                    </div>
                    <div class="record-actions">
                        <button class="btn-icon" onclick="editCondition('${condition.id}')" title="Edit">✏️</button>
                        <button class="btn-icon" onclick="deleteCondition('${condition.id}')" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="record-body">
                    <div class="record-meta">Diagnosed: ${diagnosedDate}</div>
                    ${resolvedDate}
                    ${condition.notes ? `<div class="record-notes">${escapeHtml(condition.notes)}</div>` : ''}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Display medications
function displayMedications() {
    const container = document.getElementById('medicationsContainer');
    const emptyState = document.getElementById('medicationsEmpty');
    
    if (!allMedications || allMedications.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    
    let html = '<div class="medical-records-list">';
    
    allMedications.forEach(medication => {
        const activeBadge = medication.is_active ? 
            '<span class="badge badge-success">Active</span>' : 
            '<span class="badge badge-secondary">Inactive</span>';
        const startDate = medication.start_date ? 
            new Date(medication.start_date).toLocaleDateString() : 'Not specified';
        const endDate = medication.end_date ? 
            `<div class="record-meta">End: ${new Date(medication.end_date).toLocaleDateString()}</div>` : '';
        
        html += `
            <div class="medical-record-card">
                <div class="record-header">
                    <div class="record-title">
                        <strong>${escapeHtml(medication.medication_name)}</strong>
                        ${activeBadge}
                    </div>
                    <div class="record-actions">
                        <button class="btn-icon" onclick="editMedication('${medication.id}')" title="Edit">✏️</button>
                        <button class="btn-icon" onclick="deleteMedication('${medication.id}')" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="record-body">
                    <div class="record-detail"><strong>Dosage:</strong> ${escapeHtml(medication.dosage)}</div>
                    <div class="record-detail"><strong>Frequency:</strong> ${escapeHtml(medication.frequency)}</div>
                    ${medication.route ? `<div class="record-detail"><strong>Route:</strong> ${escapeHtml(medication.route)}</div>` : ''}
                    ${medication.purpose ? `<div class="record-detail"><strong>Purpose:</strong> ${escapeHtml(medication.purpose)}</div>` : ''}
                    <div class="record-meta">Started: ${startDate}</div>
                    ${endDate}
                    ${medication.prescribed_by ? `<div class="record-meta">Prescribed by: ${escapeHtml(medication.prescribed_by)}</div>` : ''}
                    ${medication.notes ? `<div class="record-notes">${escapeHtml(medication.notes)}</div>` : ''}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Display allergies
function displayAllergies() {
    const container = document.getElementById('allergiesContainer');
    const emptyState = document.getElementById('allergiesEmpty');
    
    if (!allAllergies || allAllergies.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    
    let html = '<div class="medical-records-list">';
    
    allAllergies.forEach(allergy => {
        const severityBadge = `<span class="badge badge-${getSeverityColor(allergy.severity)}">${allergy.severity.replace('_', ' ')}</span>`;
        const verifiedBadge = allergy.is_verified ? 
            '<span class="badge badge-info">Verified</span>' : '';
        const onsetDate = allergy.onset_date ? 
            new Date(allergy.onset_date).toLocaleDateString() : 'Not specified';
        
        html += `
            <div class="medical-record-card allergy-card">
                <div class="record-header">
                    <div class="record-title">
                        <strong>⚠️ ${escapeHtml(allergy.allergen)}</strong>
                        ${severityBadge}
                        ${verifiedBadge}
                    </div>
                    <div class="record-actions">
                        <button class="btn-icon" onclick="editAllergy('${allergy.id}')" title="Edit">✏️</button>
                        <button class="btn-icon" onclick="deleteAllergy('${allergy.id}')" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="record-body">
                    <div class="record-detail"><strong>Type:</strong> ${formatAllergyType(allergy.allergy_type)}</div>
                    <div class="record-detail"><strong>Reaction:</strong> ${escapeHtml(allergy.reaction)}</div>
                    <div class="record-meta">Onset: ${onsetDate}</div>
                    ${allergy.notes ? `<div class="record-notes">${escapeHtml(allergy.notes)}</div>` : ''}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Format helpers
function formatConditionType(type) {
    const types = {
        'chronic': 'Chronic',
        'acute': 'Acute',
        'past': 'Past Condition'
    };
    return types[type] || type;
}

function formatAllergyType(type) {
    const types = {
        'medication': 'Medication',
        'food': 'Food',
        'environmental': 'Environmental',
        'material': 'Material',
        'other': 'Other'
    };
    return types[type] || type;
}

function getSeverityColor(severity) {
    const colors = {
        'mild': 'info',
        'moderate': 'warning',
        'severe': 'danger',
        'life_threatening': 'danger'
    };
    return colors[severity] || 'secondary';
}

// Setup event listeners
function setupEventListeners() {
    // Back button
    document.getElementById('backToPatientBtn').addEventListener('click', () => {
        window.location.href = `patient-view.html?id=${currentPatient.id}`;
    });
    
    // Tab navigation
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            showTab(tabName);
        });
    });
    
    // Condition buttons
    document.getElementById('addConditionBtn').addEventListener('click', () => openConditionModal());
    document.getElementById('addFirstConditionBtn').addEventListener('click', () => openConditionModal());
    document.getElementById('closeConditionModal').addEventListener('click', closeConditionModal);
    document.getElementById('cancelConditionBtn').addEventListener('click', closeConditionModal);
    document.getElementById('conditionForm').addEventListener('submit', handleConditionSubmit);
    
    // Medication buttons
    document.getElementById('addMedicationBtn').addEventListener('click', () => openMedicationModal());
    document.getElementById('addFirstMedicationBtn').addEventListener('click', () => openMedicationModal());
    document.getElementById('closeMedicationModal').addEventListener('click', closeMedicationModal);
    document.getElementById('cancelMedicationBtn').addEventListener('click', closeMedicationModal);
    document.getElementById('medicationForm').addEventListener('submit', handleMedicationSubmit);
    
    // Allergy buttons
    document.getElementById('addAllergyBtn').addEventListener('click', () => openAllergyModal());
    document.getElementById('addFirstAllergyBtn').addEventListener('click', () => openAllergyModal());
    document.getElementById('closeAllergyModal').addEventListener('click', closeAllergyModal);
    document.getElementById('cancelAllergyBtn').addEventListener('click', closeAllergyModal);
    document.getElementById('allergyForm').addEventListener('submit', handleAllergySubmit);
}

// Tab management
function showTab(tabName) {
    currentTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.getElementById(`${tabName}Tab`).classList.add('active');
}

// Medical Condition CRUD Operations
function openConditionModal(conditionId = null) {
    editingItemId = conditionId;
    editingItemType = 'condition';
    const modal = document.getElementById('conditionModal');
    const form = document.getElementById('conditionForm');
    const modalTitle = document.getElementById('conditionModalTitle');
    
    form.reset();
    
    if (conditionId) {
        modalTitle.textContent = 'Edit Medical Condition';
        const condition = allConditions.find(c => c.id === conditionId);
        if (condition) {
            document.getElementById('conditionId').value = condition.id;
            document.getElementById('conditionName').value = condition.condition_name;
            document.getElementById('conditionType').value = condition.condition_type;
            document.getElementById('conditionSeverity').value = condition.severity || '';
            document.getElementById('diagnosedDate').value = condition.diagnosed_date || '';
            document.getElementById('resolvedDate').value = condition.resolved_date || '';
            document.getElementById('conditionNotes').value = condition.notes || '';
        }
    } else {
        modalTitle.textContent = 'Add Medical Condition';
    }
    
    modal.style.display = 'block';
}

function closeConditionModal() {
    document.getElementById('conditionModal').style.display = 'none';
    editingItemId = null;
    editingItemType = null;
}

async function handleConditionSubmit(e) {
    e.preventDefault();
    
    const saveBtn = document.getElementById('saveConditionBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
        const conditionData = {
            patient_id: currentPatient.id,
            clinic_id: currentUser.clinic_id,
            condition_name: document.getElementById('conditionName').value,
            condition_type: document.getElementById('conditionType').value,
            severity: document.getElementById('conditionSeverity').value || null,
            diagnosed_date: document.getElementById('diagnosedDate').value || null,
            resolved_date: document.getElementById('resolvedDate').value || null,
            notes: document.getElementById('conditionNotes').value || null,
            created_by: currentUser.id
        };
        
        let result;
        
        if (editingItemId) {
            result = await supabase
                .from('medical_conditions')
                .update(conditionData)
                .eq('id', editingItemId)
                .eq('clinic_id', currentUser.clinic_id)
                .select();
        } else {
            result = await supabase
                .from('medical_conditions')
                .insert([conditionData])
                .select();
        }
        
        if (result.error) throw result.error;
        
        showSuccess(editingItemId ? 'Condition updated successfully' : 'Condition added successfully');
        closeConditionModal();
        await loadConditions(currentPatient.id);
        
    } catch (error) {
        console.error('Error saving condition:', error);
        showError('Failed to save condition');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Condition';
    }
}

function editCondition(conditionId) {
    openConditionModal(conditionId);
}

async function deleteCondition(conditionId) {
    if (!confirm('Are you sure you want to delete this medical condition?')) {
        return;
    }
    
    try {
        const { error } = await supabase
            .from('medical_conditions')
            .delete()
            .eq('id', conditionId)
            .eq('clinic_id', currentUser.clinic_id);
            
        if (error) throw error;
        
        showSuccess('Condition deleted successfully');
        await loadConditions(currentPatient.id);
        
    } catch (error) {
        console.error('Error deleting condition:', error);
        showError('Failed to delete condition');
    }
}

// Medication CRUD Operations
function openMedicationModal(medicationId = null) {
    editingItemId = medicationId;
    editingItemType = 'medication';
    const modal = document.getElementById('medicationModal');
    const form = document.getElementById('medicationForm');
    const modalTitle = document.getElementById('medicationModalTitle');
    
    form.reset();
    document.getElementById('medicationActive').checked = true; // Default to active
    
    if (medicationId) {
        modalTitle.textContent = 'Edit Medication';
        const medication = allMedications.find(m => m.id === medicationId);
        if (medication) {
            document.getElementById('medicationId').value = medication.id;
            document.getElementById('medicationName').value = medication.medication_name;
            document.getElementById('medicationDosage').value = medication.dosage;
            document.getElementById('medicationFrequency').value = medication.frequency;
            document.getElementById('medicationRoute').value = medication.route || 'oral';
            document.getElementById('medicationPurpose').value = medication.purpose || '';
            document.getElementById('medicationStartDate').value = medication.start_date || '';
            document.getElementById('medicationEndDate').value = medication.end_date || '';
            document.getElementById('prescribedBy').value = medication.prescribed_by || '';
            document.getElementById('medicationNotes').value = medication.notes || '';
            document.getElementById('medicationActive').checked = medication.is_active;
        }
    } else {
        modalTitle.textContent = 'Add Medication';
    }
    
    modal.style.display = 'block';
}

function closeMedicationModal() {
    document.getElementById('medicationModal').style.display = 'none';
    editingItemId = null;
    editingItemType = null;
}

async function handleMedicationSubmit(e) {
    e.preventDefault();
    
    const saveBtn = document.getElementById('saveMedicationBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
        const medicationData = {
            patient_id: currentPatient.id,
            clinic_id: currentUser.clinic_id,
            medication_name: document.getElementById('medicationName').value,
            dosage: document.getElementById('medicationDosage').value,
            frequency: document.getElementById('medicationFrequency').value,
            route: document.getElementById('medicationRoute').value || null,
            purpose: document.getElementById('medicationPurpose').value || null,
            start_date: document.getElementById('medicationStartDate').value || null,
            end_date: document.getElementById('medicationEndDate').value || null,
            prescribed_by: document.getElementById('prescribedBy').value || null,
            notes: document.getElementById('medicationNotes').value || null,
            is_active: document.getElementById('medicationActive').checked,
            created_by: currentUser.id
        };
        
        let result;
        
        if (editingItemId) {
            result = await supabase
                .from('medications')
                .update(medicationData)
                .eq('id', editingItemId)
                .eq('clinic_id', currentUser.clinic_id)
                .select();
        } else {
            result = await supabase
                .from('medications')
                .insert([medicationData])
                .select();
        }
        
        if (result.error) throw result.error;
        
        showSuccess(editingItemId ? 'Medication updated successfully' : 'Medication added successfully');
        closeMedicationModal();
        await loadMedications(currentPatient.id);
        
    } catch (error) {
        console.error('Error saving medication:', error);
        showError('Failed to save medication');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Medication';
    }
}

function editMedication(medicationId) {
    openMedicationModal(medicationId);
}

async function deleteMedication(medicationId) {
    if (!confirm('Are you sure you want to delete this medication?')) {
        return;
    }
    
    try {
        const { error } = await supabase
            .from('medications')
            .delete()
            .eq('id', medicationId)
            .eq('clinic_id', currentUser.clinic_id);
            
        if (error) throw error;
        
        showSuccess('Medication deleted successfully');
        await loadMedications(currentPatient.id);
        
    } catch (error) {
        console.error('Error deleting medication:', error);
        showError('Failed to delete medication');
    }
}

// Allergy CRUD Operations
function openAllergyModal(allergyId = null) {
    editingItemId = allergyId;
    editingItemType = 'allergy';
    const modal = document.getElementById('allergyModal');
    const form = document.getElementById('allergyForm');
    const modalTitle = document.getElementById('allergyModalTitle');
    
    form.reset();
    
    if (allergyId) {
        modalTitle.textContent = 'Edit Allergy';
        const allergy = allAllergies.find(a => a.id === allergyId);
        if (allergy) {
            document.getElementById('allergyId').value = allergy.id;
            document.getElementById('allergen').value = allergy.allergen;
            document.getElementById('allergyType').value = allergy.allergy_type;
            document.getElementById('allergySeverity').value = allergy.severity;
            document.getElementById('allergyReaction').value = allergy.reaction;
            document.getElementById('allergyOnsetDate').value = allergy.onset_date || '';
            document.getElementById('allergyNotes').value = allergy.notes || '';
            document.getElementById('allergyVerified').checked = allergy.is_verified;
        }
    } else {
        modalTitle.textContent = 'Add Allergy';
    }
    
    modal.style.display = 'block';
}

function closeAllergyModal() {
    document.getElementById('allergyModal').style.display = 'none';
    editingItemId = null;
    editingItemType = null;
}

async function handleAllergySubmit(e) {
    e.preventDefault();
    
    const saveBtn = document.getElementById('saveAllergyBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
        const allergyData = {
            patient_id: currentPatient.id,
            clinic_id: currentUser.clinic_id,
            allergen: document.getElementById('allergen').value,
            allergy_type: document.getElementById('allergyType').value,
            severity: document.getElementById('allergySeverity').value,
            reaction: document.getElementById('allergyReaction').value,
            onset_date: document.getElementById('allergyOnsetDate').value || null,
            notes: document.getElementById('allergyNotes').value || null,
            is_verified: document.getElementById('allergyVerified').checked,
            created_by: currentUser.id
        };
        
        let result;
        
        if (editingItemId) {
            result = await supabase
                .from('patient_allergies')
                .update(allergyData)
                .eq('id', editingItemId)
                .eq('clinic_id', currentUser.clinic_id)
                .select();
        } else {
            result = await supabase
                .from('patient_allergies')
                .insert([allergyData])
                .select();
        }
        
        if (result.error) throw result.error;
        
        showSuccess(editingItemId ? 'Allergy updated successfully' : 'Allergy added successfully');
        closeAllergyModal();
        await loadAllergies(currentPatient.id);
        
    } catch (error) {
        console.error('Error saving allergy:', error);
        showError('Failed to save allergy');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Allergy';
    }
}

function editAllergy(allergyId) {
    openAllergyModal(allergyId);
}

async function deleteAllergy(allergyId) {
    if (!confirm('Are you sure you want to delete this allergy record?')) {
        return;
    }
    
    try {
        const { error } = await supabase
            .from('patient_allergies')
            .delete()
            .eq('id', allergyId)
            .eq('clinic_id', currentUser.clinic_id);
            
        if (error) throw error;
        
        showSuccess('Allergy deleted successfully');
        await loadAllergies(currentPatient.id);
        
    } catch (error) {
        console.error('Error deleting allergy:', error);
        showError('Failed to delete allergy');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializePage);
