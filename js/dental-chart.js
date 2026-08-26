// Dental Chart Management Module
let currentPatient = null;
let currentUser = null;
let allChartRecords = [];
let selectedTooth = null;
let toothConditions = {}; // Track current conditions per tooth

// FDI Tooth Numbering System
const TEETH = {
    upperRight: [18, 17, 16, 15, 14, 13, 12, 11],
    upperLeft: [21, 22, 23, 24, 25, 26, 27, 28],
    lowerLeft: [31, 32, 33, 34, 35, 36, 37, 38],
    lowerRight: [48, 47, 46, 45, 44, 43, 42, 41]
};

// Tooth names for display
const TOOTH_NAMES = {
    // Incisors
    11: 'Upper Right Central Incisor', 21: 'Upper Left Central Incisor',
    31: 'Lower Left Central Incisor', 41: 'Lower Right Central Incisor',
    12: 'Upper Right Lateral Incisor', 22: 'Upper Left Lateral Incisor',
    32: 'Lower Left Lateral Incisor', 42: 'Lower Right Lateral Incisor',
    // Canines
    13: 'Upper Right Canine', 23: 'Upper Left Canine',
    33: 'Lower Left Canine', 43: 'Lower Right Canine',
    // Premolars
    14: 'Upper Right First Premolar', 24: 'Upper Left First Premolar',
    34: 'Lower Left First Premolar', 44: 'Lower Right First Premolar',
    15: 'Upper Right Second Premolar', 25: 'Upper Left Second Premolar',
    35: 'Lower Left Second Premolar', 45: 'Lower Right Second Premolar',
    // Molars
    16: 'Upper Right First Molar', 26: 'Upper Left First Molar',
    36: 'Lower Left First Molar', 46: 'Lower Right First Molar',
    17: 'Upper Right Second Molar', 27: 'Upper Left Second Molar',
    37: 'Lower Left Second Molar', 47: 'Lower Right Second Molar',
    18: 'Upper Right Third Molar', 28: 'Upper Left Third Molar',
    38: 'Lower Left Third Molar', 48: 'Lower Right Third Molar'
};

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
        
        // Render dental chart
        renderDentalChart();
        
        // Load chart records
        await loadChartRecords(patientId);
        
        // Setup event listeners
        setupEventListeners();
        
        // Populate tooth filter dropdown
        populateToothFilter();
        
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

// Render dental chart
function renderDentalChart() {
    // Render each quadrant
    Object.keys(TEETH).forEach(quadrant => {
        const container = document.getElementById(quadrant);
        const teeth = TEETH[quadrant];
        
        let html = '';
        teeth.forEach(toothNum => {
            html += `
                <div class="tooth" data-tooth="${toothNum}" id="tooth-${toothNum}">
                    <div class="tooth-number">${toothNum}</div>
                    <div class="tooth-icon">🦷</div>
                    <div class="tooth-status"></div>
                </div>
            `;
        });
        
        container.innerHTML = html;
    });
}

// Load chart records
async function loadChartRecords(patientId) {
    try {
        const { data, error } = await supabase
            .from('dental_chart_records')
            .select(`
                *,
                created_by_user:users!dental_chart_records_created_by_fkey(first_name, last_name)
            `)
            .eq('patient_id', patientId)
            .eq('clinic_id', currentUser.clinic_id)
            .order('record_date', { ascending: false });
            
        if (error) throw error;
        
        allChartRecords = data || [];
        
        // Build current tooth conditions map (latest record per tooth)
        buildToothConditionsMap();
        
        // Update visual chart
        updateChartVisuals();
        
        // Display records list
        displayRecords(allChartRecords);
        
    } catch (error) {
        console.error('Error loading chart records:', error);
        showError('Failed to load dental chart records');
    }
}

// Build tooth conditions map
function buildToothConditionsMap() {
    toothConditions = {};
    
    // Group records by tooth and get the most recent condition for each
    allChartRecords.forEach(record => {
        const tooth = record.tooth_number;
        if (!toothConditions[tooth]) {
            toothConditions[tooth] = [];
        }
        toothConditions[tooth].push(record);
    });
    
    // Sort each tooth's records by date (most recent first)
    Object.keys(toothConditions).forEach(tooth => {
        toothConditions[tooth].sort((a, b) => 
            new Date(b.record_date) - new Date(a.record_date)
        );
    });
}

// Update chart visuals based on conditions
function updateChartVisuals() {
    // Reset all teeth
    document.querySelectorAll('.tooth').forEach(toothEl => {
        toothEl.classList.remove('healthy', 'cavity', 'filled', 'crown', 'root-canal', 'missing', 'implant');
    });
    
    // Apply conditions
    Object.keys(toothConditions).forEach(toothNum => {
        const records = toothConditions[toothNum];
        if (records && records.length > 0) {
            const latestCondition = records[0].condition_type;
            const toothEl = document.getElementById(`tooth-${toothNum}`);
            if (toothEl) {
                toothEl.classList.add(latestCondition.replace('_', '-'));
            }
        }
    });
}

// Display records list
function displayRecords(records) {
    const container = document.getElementById('recordsContainer');
    
    if (!records || records.length === 0) {
        container.innerHTML = '<div class="empty-message">No chart records found</div>';
        return;
    }
    
    let html = '<div class="records-list">';
    
    records.forEach(record => {
        const createdBy = record.created_by_user ? 
            `${record.created_by_user.first_name} ${record.created_by_user.last_name}` : 
            'Unknown';
        const recordDate = new Date(record.record_date).toLocaleDateString();
        const treatmentDate = record.treatment_date ? 
            new Date(record.treatment_date).toLocaleDateString() : 'N/A';
        const toothName = TOOTH_NAMES[record.tooth_number] || `Tooth ${record.tooth_number}`;
        
        const conditionClass = `condition-${record.condition_type}`;
        const severityBadge = record.severity ? 
            `<span class="badge badge-${getSeverityColor(record.severity)}">${record.severity}</span>` : '';
        const followupBadge = record.requires_followup ? 
            '<span class="badge badge-warning">Follow-up Required</span>' : '';
        
        html += `
            <div class="record-card">
                <div class="record-header">
                    <div class="record-title">
                        <strong>Tooth ${record.tooth_number}</strong> - ${toothName}
                        <span class="condition-badge ${conditionClass}">${formatConditionType(record.condition_type)}</span>
                        ${severityBadge}
                        ${followupBadge}
                    </div>
                    <div class="record-actions">
                        <button class="btn-icon" onclick="editRecord('${record.id}')" title="Edit">✏️</button>
                        <button class="btn-icon" onclick="deleteRecord('${record.id}')" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="record-body">
                    ${record.surface ? `<div class="record-detail"><strong>Surface:</strong> ${escapeHtml(record.surface)}</div>` : ''}
                    <div class="record-detail"><strong>Record Date:</strong> ${recordDate}</div>
                    ${record.treatment_date ? `<div class="record-detail"><strong>Treatment Date:</strong> ${treatmentDate}</div>` : ''}
                    ${record.notes ? `<div class="record-notes">${escapeHtml(record.notes)}</div>` : ''}
                    <div class="record-footer">Recorded by ${escapeHtml(createdBy)}</div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Format condition type
function formatConditionType(type) {
    const types = {
        'healthy': 'Healthy',
        'cavity': 'Cavity',
        'filled': 'Filling',
        'crown': 'Crown',
        'root_canal': 'Root Canal',
        'missing': 'Missing',
        'implant': 'Implant',
        'bridge': 'Bridge',
        'fractured': 'Fractured',
        'impacted': 'Impacted',
        'extracted': 'Extracted',
        'other': 'Other'
    };
    return types[type] || type;
}

// Get severity color
function getSeverityColor(severity) {
    const colors = {
        'mild': 'info',
        'moderate': 'warning',
        'severe': 'danger'
    };
    return colors[severity] || 'secondary';
}

// Setup event listeners
function setupEventListeners() {
    // Back button
    document.getElementById('backToPatientBtn').addEventListener('click', () => {
        window.location.href = `patient-view.html?id=${currentPatient.id}`;
    });
    
    // Print button
    document.getElementById('printChartBtn').addEventListener('click', printChart);
    
    // Tooth clicks
    document.querySelectorAll('.tooth').forEach(tooth => {
        tooth.addEventListener('click', (e) => {
            const toothNum = e.currentTarget.dataset.tooth;
            selectTooth(toothNum);
        });
    });
    
    // Quick condition select
    document.getElementById('quickConditionSelect').addEventListener('change', (e) => {
        if (e.target.value && selectedTooth) {
            openConditionModal(selectedTooth, e.target.value);
            e.target.value = '';
        } else if (e.target.value && !selectedTooth) {
            showError('Please select a tooth first');
            e.target.value = '';
        }
    });
    
    // Clear selection
    document.getElementById('clearSelectionBtn').addEventListener('click', clearSelection);
    
    // Close tooth info panel
    document.getElementById('closeToothInfo').addEventListener('click', () => {
        document.getElementById('selectedToothInfo').style.display = 'none';
        clearSelection();
    });
    
    // Add condition button in panel
    document.getElementById('addToothConditionBtn').addEventListener('click', () => {
        if (selectedTooth) {
            openConditionModal(selectedTooth);
        }
    });
    
    // Modal controls
    document.getElementById('closeConditionModal').addEventListener('click', closeConditionModal);
    document.getElementById('cancelConditionBtn').addEventListener('click', closeConditionModal);
    document.getElementById('toothConditionForm').addEventListener('submit', handleConditionSubmit);
    
    // Filters
    document.getElementById('searchRecords').addEventListener('input', applyRecordFilters);
    document.getElementById('filterByTooth').addEventListener('change', applyRecordFilters);
    document.getElementById('filterByCondition').addEventListener('change', applyRecordFilters);
}

// Select tooth
function selectTooth(toothNum) {
    // Clear previous selection
    document.querySelectorAll('.tooth').forEach(t => t.classList.remove('selected'));
    
    // Select new tooth
    selectedTooth = toothNum;
    const toothEl = document.getElementById(`tooth-${toothNum}`);
    if (toothEl) {
        toothEl.classList.add('selected');
    }
    
    // Show tooth info panel
    showToothInfo(toothNum);
}

// Clear selection
function clearSelection() {
    selectedTooth = null;
    document.querySelectorAll('.tooth').forEach(t => t.classList.remove('selected'));
    document.getElementById('selectedToothInfo').style.display = 'none';
}

// Show tooth info panel
function showToothInfo(toothNum) {
    const panel = document.getElementById('selectedToothInfo');
    const toothName = TOOTH_NAMES[toothNum] || `Tooth ${toothNum}`;
    
    document.getElementById('selectedToothNumber').textContent = `${toothNum} - ${toothName}`;
    
    // Show current conditions
    const conditionsDiv = document.getElementById('toothConditionsList');
    const records = toothConditions[toothNum] || [];
    
    if (records.length === 0) {
        conditionsDiv.innerHTML = '<p class="text-muted">No conditions recorded</p>';
    } else {
        let html = '<div class="tooth-conditions-list">';
        records.slice(0, 3).forEach(record => {
            const date = new Date(record.record_date).toLocaleDateString();
            html += `
                <div class="tooth-condition-item">
                    <span class="condition-badge condition-${record.condition_type}">
                        ${formatConditionType(record.condition_type)}
                    </span>
                    <span class="condition-date">${date}</span>
                </div>
            `;
        });
        html += '</div>';
        conditionsDiv.innerHTML = html;
    }
    
    // Show history
    const historyDiv = document.getElementById('toothHistoryList');
    if (records.length === 0) {
        historyDiv.innerHTML = '<p class="text-muted">No history available</p>';
    } else {
        let html = '<div class="tooth-history-list">';
        records.forEach(record => {
            const date = new Date(record.record_date).toLocaleDateString();
            html += `
                <div class="history-item">
                    <div class="history-date">${date}</div>
                    <div class="history-desc">${formatConditionType(record.condition_type)}${record.surface ? ` (${record.surface})` : ''}</div>
                    ${record.notes ? `<div class="history-notes">${escapeHtml(record.notes)}</div>` : ''}
                </div>
            `;
        });
        html += '</div>';
        historyDiv.innerHTML = html;
    }
    
    panel.style.display = 'block';
}

// Open condition modal
function openConditionModal(toothNum, preselectedCondition = null) {
    const modal = document.getElementById('toothConditionModal');
    const form = document.getElementById('toothConditionForm');
    const modalTitle = document.getElementById('conditionModalTitle');
    
    form.reset();
    modalTitle.textContent = 'Add Tooth Condition';
    
    document.getElementById('toothNumberInput').value = toothNum;
    document.getElementById('toothNumberDisplay').value = `${toothNum} - ${TOOTH_NAMES[toothNum] || 'Tooth ' + toothNum}`;
    document.getElementById('recordDate').value = new Date().toISOString().split('T')[0];
    
    if (preselectedCondition) {
        document.getElementById('conditionType').value = preselectedCondition;
    }
    
    modal.style.display = 'block';
}

// Close condition modal
function closeConditionModal() {
    document.getElementById('toothConditionModal').style.display = 'none';
}

// Handle condition form submit
async function handleConditionSubmit(e) {
    e.preventDefault();
    
    const saveBtn = document.getElementById('saveConditionBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
        const recordData = {
            patient_id: currentPatient.id,
            clinic_id: currentUser.clinic_id,
            tooth_number: parseInt(document.getElementById('toothNumberInput').value),
            condition_type: document.getElementById('conditionType').value,
            surface: document.getElementById('surface').value || null,
            severity: document.getElementById('severity').value || null,
            record_date: document.getElementById('recordDate').value,
            treatment_date: document.getElementById('treatmentDate').value || null,
            notes: document.getElementById('conditionNotes').value || null,
            requires_followup: document.getElementById('requiresFollowup').checked,
            created_by: currentUser.id
        };
        
        const recordId = document.getElementById('recordId').value;
        let result;
        
        if (recordId) {
            result = await supabase
                .from('dental_chart_records')
                .update(recordData)
                .eq('id', recordId)
                .eq('clinic_id', currentUser.clinic_id)
                .select();
        } else {
            result = await supabase
                .from('dental_chart_records')
                .insert([recordData])
                .select();
        }
        
        if (result.error) throw result.error;
        
        showSuccess(recordId ? 'Record updated successfully' : 'Record added successfully');
        closeConditionModal();
        await loadChartRecords(currentPatient.id);
        
        // Update tooth info if still selected
        if (selectedTooth) {
            showToothInfo(selectedTooth);
        }
        
    } catch (error) {
        console.error('Error saving record:', error);
        showError('Failed to save record');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Condition';
    }
}

// Edit record
function editRecord(recordId) {
    const record = allChartRecords.find(r => r.id === recordId);
    if (!record) return;
    
    const modal = document.getElementById('toothConditionModal');
    const form = document.getElementById('toothConditionForm');
    const modalTitle = document.getElementById('conditionModalTitle');
    
    modalTitle.textContent = 'Edit Tooth Condition';
    
    document.getElementById('recordId').value = record.id;
    document.getElementById('toothNumberInput').value = record.tooth_number;
    document.getElementById('toothNumberDisplay').value = `${record.tooth_number} - ${TOOTH_NAMES[record.tooth_number]}`;
    document.getElementById('conditionType').value = record.condition_type;
    document.getElementById('surface').value = record.surface || '';
    document.getElementById('severity').value = record.severity || '';
    document.getElementById('recordDate').value = record.record_date;
    document.getElementById('treatmentDate').value = record.treatment_date || '';
    document.getElementById('conditionNotes').value = record.notes || '';
    document.getElementById('requiresFollowup').checked = record.requires_followup;
    
    modal.style.display = 'block';
}

// Delete record
async function deleteRecord(recordId) {
    if (!confirm('Are you sure you want to delete this dental chart record?')) {
        return;
    }
    
    try {
        const { error } = await supabase
            .from('dental_chart_records')
            .delete()
            .eq('id', recordId)
            .eq('clinic_id', currentUser.clinic_id);
            
        if (error) throw error;
        
        showSuccess('Record deleted successfully');
        await loadChartRecords(currentPatient.id);
        
        // Update tooth info if still selected
        if (selectedTooth) {
            showToothInfo(selectedTooth);
        }
        
    } catch (error) {
        console.error('Error deleting record:', error);
        showError('Failed to delete record');
    }
}

// Apply record filters
function applyRecordFilters() {
    const searchTerm = document.getElementById('searchRecords').value.toLowerCase();
    const toothFilter = document.getElementById('filterByTooth').value;
    const conditionFilter = document.getElementById('filterByCondition').value;
    
    let filtered = allChartRecords.filter(record => {
        // Search filter
        if (searchTerm) {
            const searchableText = [
                record.tooth_number.toString(),
                TOOTH_NAMES[record.tooth_number],
                record.condition_type,
                record.surface,
                record.notes
            ].join(' ').toLowerCase();
            
            if (!searchableText.includes(searchTerm)) return false;
        }
        
        // Tooth filter
        if (toothFilter && record.tooth_number.toString() !== toothFilter) return false;
        
        // Condition filter
        if (conditionFilter && record.condition_type !== conditionFilter) return false;
        
        return true;
    });
    
    displayRecords(filtered);
}

// Populate tooth filter
function populateToothFilter() {
    const select = document.getElementById('filterByTooth');
    Object.values(TEETH).flat().forEach(toothNum => {
        const option = document.createElement('option');
        option.value = toothNum;
        option.textContent = `${toothNum} - ${TOOTH_NAMES[toothNum]}`;
        select.appendChild(option);
    });
}

// Print chart
function printChart() {
    window.print();
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializePage);
