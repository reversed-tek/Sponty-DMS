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
        const user = await checkAuth();
        if (!user) return;
        
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
        
        this.setupEventListeners();
        await this.loadPatients();
    }
    
    setupEventListeners() {
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
        
        const sortField = document.getElementById('sortField');
        const sortOrder = document.getElementById('sortOrder');
        
        if (sortField) {
            sortField.addEventListener('change', () => this.handleSort());
        }
        
        if (sortOrder) {
            sortOrder.addEventListener('change', () => this.handleSort());
        }
        
        const pageSize = document.getElementById('pageSize');
        if (pageSize) {
            pageSize.addEventListener('change', (e) => {
                this.pageSize = parseInt(e.target.value);
                this.currentPage = 1;
                this.loadPatients();
            });
        }
        
        const exportBtn = document.getElementById('exportBtn');
        const printBtn = document.getElementById('printBtn');
        
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToCSV());
        }
        
        if (printBtn) {
            printBtn.addEventListener('click', () => this.printList());
        }
        
        // Add patient — navigate in-shell instead of hard redirect
        const addBtn = document.getElementById('addPatientBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'patient-add' } }));
            });
        }
    }
    
    async loadPatients() {
        try {
            showLoading('patientsTable');
            
            let query = window.supabaseClient
                .from('patients')
                .select('*', { count: 'exact' })
                .eq('clinic_id', this.clinicId);
            
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
            
            query = query.order(this.currentSort.field, { 
                ascending: this.currentSort.order === 'asc' 
            });
            
            const from = (this.currentPage - 1) * this.pageSize;
            const to = from + this.pageSize - 1;
            query = query.range(from, to);
            
            const { data, error, count } = await query;
            
            if (error) throw error;
            
            this.patients = data || [];
            this.totalRecords = count || 0;
            this.totalPages = Math.ceil(this.totalRecords / this.pageSize);

            // Update patient count badge
            const countBadge = document.getElementById('patient-count');
            if (countBadge) countBadge.textContent = this.totalRecords;
            
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
                        <a href="#" class="link" onclick="patientManager.viewPatient('${patient.id}'); return false;">
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
        pages.push(1);
        
        for (let i = Math.max(2, this.currentPage - 1); i <= Math.min(this.totalPages - 1, this.currentPage + 1); i++) {
            if (!pages.includes(i)) pages.push(i);
        }
        
        if (!pages.includes(this.totalPages)) {
            pages.push(this.totalPages);
        }
        
        let html = '<div class="pagination">';
        
        html += `
            <button class="btn-small" ${this.currentPage === 1 ? 'disabled' : ''} 
                onclick="patientManager.goToPage(${this.currentPage - 1})">
                ‹ Previous
            </button>
        `;
        
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
        
        html += `
            <button class="btn-small" ${this.currentPage === this.totalPages ? 'disabled' : ''} 
                onclick="patientManager.goToPage(${this.currentPage + 1})">
                Next ›
            </button>
        `;
        
        html += '</div>';
        
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
        const filterInputs = ['filterGender', 'filterStatus', 'filterAgeFrom', 'filterAgeTo'];
        filterInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        
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
        window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'patient-view', id } }));
    }
    
    editPatient(id) {
        window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'patient-edit', id } }));
    }
    
    confirmDelete(id, name) {
        const modal = document.getElementById('deleteModal');
        const patientNameEl = document.getElementById('deletePatientName');
        const confirmBtn = document.getElementById('confirmDelete');
        const cancelBtn = document.getElementById('cancelDelete');
        
        if (modal && patientNameEl && confirmBtn) {
            patientNameEl.textContent = name;
            modal.classList.remove('hidden');
            
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
            
            let query = window.supabaseClient
                .from('patients')
                .select('*')
                .eq('clinic_id', this.clinicId);
            
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

let patientManager;
document.addEventListener('DOMContentLoaded', () => {
    patientManager = new PatientManager();
});
