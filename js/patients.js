/**
 * Patient List Management
 * Handles patient listing, search, filtering, pagination, export, and soft delete
 */

class PatientManager {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 25;
        this.totalRecords = 0;
        this.totalPages = 0;
        this.currentFilters = {};
        this.currentSort = { field: 'created_at', order: 'desc' };
        this.patients = [];
        
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
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Load initial data
        await this.loadPatients();
    }
    
    setupEventListeners() {
        // Search
        const searchInput = document.getElementById('searchInput');
        const searchBtn = document.getElementById('searchBtn');
        
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleSearch();
            });
        }
        
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.handleSearch());
        }
        
        // Advanced filters
        const filterBtn = document.getElementById('filterBtn');
        const applyFiltersBtn = document.getElementById('applyFilters');
        const resetFiltersBtn = document.getElementById('resetFilters');
        
        if (filterBtn) {
            filterBtn.addEventListener('click', () => this.toggleFilters());
        }
        
        if (applyFiltersBtn) {
            applyFiltersBtn.addEventListener('click', () => this.applyFilters());
        }
        
        if (resetFiltersBtn) {
            resetFiltersBtn.addEventListener('click', () => this.resetFilters());
        }
        
        // Sorting
        const sortField = document.getElementById('sortField');
        const sortOrder = document.getElementById('sortOrder');
        
        if (sortField) {
            sortField.addEventListener('change', () => this.handleSort());
        }
        
        if (sortOrder) {
            sortOrder.addEventListener('change', () => this.handleSort());
        }
        
        // Page size
        const pageSize = document.getElementById('pageSize');
        if (pageSize) {
            pageSize.addEventListener('change', (e) => {
                this.pageSize = parseInt(e.target.value);
                this.currentPage = 1;
                this.loadPatients();
            });
        }
        
        // Actions
        const exportBtn = document.getElementById('exportBtn');
        const printBtn = document.getElementById('printBtn');
        
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToCSV());
        }
        
        if (printBtn) {
            printBtn.addEventListener('click', () => this.printList());
        }
        
        // Add patient button
        const addBtn = document.getElementById('addPatientBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                window.location.href = 'patient-add.html';
            });
        }
    }
    
    async loadPatients() {
        try {
            showLoading('patientsTable');
            
            // Build query
            let query = window.supabaseClient
                .from('patients')
                .select('*', { count: 'exact' })
                .eq('clinic_id', this.clinicId);
            
            // Apply search
            if (this.currentFilters.search) {
                const search = `%${this.currentFilters.search}%`;
                query = query.or(`first_name.ilike.${search},last_name.ilike.${search},patient_number.ilike.${search},phone.ilike.${search},email.ilike.${search}`);
            }
            
            // Apply filters
            if (this.currentFilters.gender) {
                query = query.eq('gender', this.currentFilters.gender);
            }
            
            if (this.currentFilters.status) {
                query = query.eq('status', this.currentFilters.status);
            }
            
            if (this.currentFilters.ageFrom) {
                const maxDate = new Date();
                maxDate.setFullYear(maxDate.getFullYear() - parseInt(this.currentFilters.ageFrom));
                query = query.lte('date_of_birth', maxDate.toISOString().split('T')[0]);
            }
            
            if (this.currentFilters.ageTo) {
                const minDate = new Date();
                minDate.setFullYear(minDate.getFullYear() - parseInt(this.currentFilters.ageTo) - 1);
                query = query.gte('date_of_birth', minDate.toISOString().split('T')[0]);
            }
            
            // Apply sorting
            query = query.order(this.currentSort.field, { 
                ascending: this.currentSort.order === 'asc' 
            });
            
            // Apply pagination
            const from = (this.currentPage - 1) * this.pageSize;
            const to = from + this.pageSize - 1;
            query = query.range(from, to);
            
            const { data, error, count } = await query;
            
            if (error) throw error;
            
            this.patients = data || [];
            this.totalRecords = count || 0;
            this.totalPages = Math.ceil(this.totalRecords / this.pageSize);
            
            this.renderPatients();
            this.renderPagination();
            
        } catch (error) {
            console.error('Error loading patients:', error);
            showNotification('Failed to load patients', 'error');
        } finally {
            hideLoading('patientsTable');
        }
    }
    
    renderPatients() {
        const tbody = document.getElementById('patientsTableBody');
        if (!tbody) return;
        
        if (this.patients.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: #666;">
                        <div style="font-size: 16px; margin-bottom: 10px;">No patients found</div>
                        <div style="font-size: 13px;">Try adjusting your search or filters</div>
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = this.patients.map(patient => {
            const age = calculateAge(patient.date_of_birth);
            const statusClass = patient.status === 'active' ? 'active' : 'inactive';
            
            return `
                <tr>
                    <td>${escapeHtml(patient.patient_number)}</td>
                    <td>
                        <a href="patient-view.html?id=${patient.id}" class="link">
                            ${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}
                        </a>
                    </td>
                    <td>${age} years</td>
                    <td>${escapeHtml(patient.gender || '')}</td>
                    <td>${escapeHtml(patient.phone || '-')}</td>
                    <td>${escapeHtml(patient.email || '-')}</td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            ${patient.status}
                        </span>
                    </td>
                    <td>
                        <button class="btn-small" onclick="patientManager.viewPatient('${patient.id}')" title="View">
                            👁️
                        </button>
                        <button class="btn-small" onclick="patientManager.editPatient('${patient.id}')" title="Edit">
                            ✏️
                        </button>
                        <button class="btn-small" onclick="patientManager.confirmDelete('${patient.id}', '${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}')" title="Deactivate">
                            🗑️
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    renderPagination() {
        const paginationEl = document.getElementById('pagination');
        if (!paginationEl) return;
        
        if (this.totalPages <= 1) {
            paginationEl.innerHTML = '';
            return;
        }
        
        let pages = [];
        
        // Always show first page
        pages.push(1);
        
        // Show pages around current page
        for (let i = Math.max(2, this.currentPage - 1); i <= Math.min(this.totalPages - 1, this.currentPage + 1); i++) {
            if (!pages.includes(i)) pages.push(i);
        }
        
        // Always show last page
        if (!pages.includes(this.totalPages)) {
            pages.push(this.totalPages);
        }
        
        let html = '<div class="pagination">';
        
        // Previous button
        html += `
            <button class="btn-small" ${this.currentPage === 1 ? 'disabled' : ''} 
                onclick="patientManager.goToPage(${this.currentPage - 1})">
                ‹ Previous
            </button>
        `;
        
        // Page numbers
        let lastPage = 0;
        pages.forEach(page => {
            if (page > lastPage + 1) {
                html += '<span style="padding: 0 5px;">...</span>';
            }
            
            html += `
                <button class="btn-small ${page === this.currentPage ? 'active' : ''}" 
                    onclick="patientManager.goToPage(${page})">
                    ${page}
                </button>
            `;
            
            lastPage = page;
        });
        
        // Next button
        html += `
            <button class="btn-small" ${this.currentPage === this.totalPages ? 'disabled' : ''} 
                onclick="patientManager.goToPage(${this.currentPage + 1})">
                Next ›
            </button>
        `;
        
        html += '</div>';
        
        // Page info
        const from = (this.currentPage - 1) * this.pageSize + 1;
        const to = Math.min(this.currentPage * this.pageSize, this.totalRecords);
        
        html += `
            <div style="margin-top: 10px; text-align: center; font-size: 12px; color: #666;">
                Showing ${from}-${to} of ${this.totalRecords} patients
            </div>
        `;
        
        paginationEl.innerHTML = html;
    }
    
    goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) return;
        this.currentPage = page;
        this.loadPatients();
    }
    
    handleSearch() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            this.currentFilters.search = searchInput.value.trim();
            this.currentPage = 1;
            this.loadPatients();
        }
    }
    
    toggleFilters() {
        const filtersPanel = document.getElementById('advancedFilters');
        if (filtersPanel) {
            filtersPanel.classList.toggle('hidden');
        }
    }
    
    applyFilters() {
        const gender = document.getElementById('filterGender')?.value;
        const status = document.getElementById('filterStatus')?.value;
        const ageFrom = document.getElementById('filterAgeFrom')?.value;
        const ageTo = document.getElementById('filterAgeTo')?.value;
        
        this.currentFilters = {
            ...this.currentFilters,
            gender: gender || null,
            status: status || null,
            ageFrom: ageFrom || null,
            ageTo: ageTo || null
        };
        
        this.currentPage = 1;
        this.loadPatients();
        this.toggleFilters();
    }
    
    resetFilters() {
        // Clear filter inputs
        const filterInputs = ['filterGender', 'filterStatus', 'filterAgeFrom', 'filterAgeTo'];
        filterInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        
        // Clear search
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        
        // Reset filters
        this.currentFilters = {};
        this.currentPage = 1;
        this.loadPatients();
        this.toggleFilters();
    }
    
    handleSort() {
        const sortField = document.getElementById('sortField')?.value;
        const sortOrder = document.getElementById('sortOrder')?.value;
        
        if (sortField && sortOrder) {
            this.currentSort = { field: sortField, order: sortOrder };
            this.currentPage = 1;
            this.loadPatients();
        }
    }
    
    viewPatient(id) {
        window.location.href = `patient-view.html?id=${id}`;
    }
    
    editPatient(id) {
        window.location.href = `patient-edit.html?id=${id}`;
    }
    
    confirmDelete(id, name) {
        const modal = document.getElementById('deleteModal');
        const patientNameEl = document.getElementById('deletePatientName');
        const confirmBtn = document.getElementById('confirmDelete');
        const cancelBtn = document.getElementById('cancelDelete');
        
        if (modal && patientNameEl && confirmBtn) {
            patientNameEl.textContent = name;
            modal.classList.remove('hidden');
            
            // Remove old listeners
            const newConfirmBtn = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            
            newConfirmBtn.addEventListener('click', () => {
                this.deletePatient(id);
                modal.classList.add('hidden');
            });
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }
    }
    
    async deletePatient(id) {
        try {
            // Soft delete - set status to inactive
            const { error } = await window.supabaseClient
                .from('patients')
                .update({ 
                    status: 'inactive',
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);
            
            if (error) throw error;
            
            showNotification('Patient deactivated successfully', 'success');
            this.loadPatients();
            
        } catch (error) {
            console.error('Error deactivating patient:', error);
            showNotification('Failed to deactivate patient', 'error');
        }
    }
    
    async exportToCSV() {
        try {
            showNotification('Preparing export...', 'info');
            
            // Fetch all patients with current filters (no pagination)
            let query = window.supabaseClient
                .from('patients')
                .select('*')
                .eq('clinic_id', this.clinicId);
            
            // Apply same filters as current view
            if (this.currentFilters.search) {
                const search = `%${this.currentFilters.search}%`;
                query = query.or(`first_name.ilike.${search},last_name.ilike.${search},patient_number.ilike.${search},phone.ilike.${search},email.ilike.${search}`);
            }
            
            if (this.currentFilters.gender) {
                query = query.eq('gender', this.currentFilters.gender);
            }
            
            if (this.currentFilters.status) {
                query = query.eq('status', this.currentFilters.status);
            }
            
            const { data, error } = await query;
            
            if (error) throw error;
            
            // Create CSV
            const headers = ['Patient Number', 'First Name', 'Last Name', 'Date of Birth', 'Age', 'Gender', 'Phone', 'Email', 'Address', 'Status', 'Created Date'];
            const rows = data.map(p => [
                p.patient_number,
                p.first_name,
                p.last_name,
                p.date_of_birth,
                calculateAge(p.date_of_birth),
                p.gender || '',
                p.phone || '',
                p.email || '',
                `${p.address || ''} ${p.city || ''} ${p.state || ''} ${p.zip_code || ''}`.trim(),
                p.status,
                formatDate(p.created_at)
            ]);
            
            const csv = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');
            
            // Download
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `patients-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showNotification('Export completed successfully', 'success');
            
        } catch (error) {
            console.error('Error exporting patients:', error);
            showNotification('Failed to export patients', 'error');
        }
    }
    
    printList() {
        window.print();
    }
}

// Initialize
let patientManager;
document.addEventListener('DOMContentLoaded', () => {
    patientManager = new PatientManager();
});
