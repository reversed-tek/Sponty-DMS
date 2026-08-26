/**
 * User Management Module
 * Part 5: Entra Integration - User Provisioning
 * Handles manual user provisioning with clinic assignment
 */

class UsersManager {
    constructor() {
        this.users = [];
        this.clinics = [];
        this.currentUser = null;
        this.editingUserId = null;
        
        // DOM elements
        this.modal = document.getElementById('userModal');
        this.userForm = document.getElementById('userForm');
        this.modalTitle = document.getElementById('modalTitle');
        this.usersTableBody = document.getElementById('usersTableBody');
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Add user button
        document.getElementById('btnAddUser').addEventListener('click', () => {
            this.openModal();
        });

        // Modal close
        document.getElementById('modalClose').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('btnCancelUser').addEventListener('click', () => {
            this.closeModal();
        });

        // Form submit
        this.userForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveUser();
        });

        // Filters
        document.getElementById('filterSearch').addEventListener('input', () => {
            this.filterUsers();
        });

        document.getElementById('filterClinic').addEventListener('change', () => {
            this.filterUsers();
        });

        document.getElementById('filterRole').addEventListener('change', () => {
            this.filterUsers();
        });

        document.getElementById('filterStatus').addEventListener('change', () => {
            this.filterUsers();
        });

        // Close modal on outside click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });
    }

    async init() {
        try {
            showLoading('Loading users...');
            
            this.currentUser = await getCurrentUser();
            
            // Load clinics for dropdowns
            await this.loadClinics();
            
            // Load users
            await this.loadUsers();
            
            hideLoading();
        } catch (error) {
            console.error('Init error:', error);
            hideLoading();
            showError('Failed to initialize user management: ' + error.message);
        }
    }

    async loadClinics() {
        try {
            const { data, error } = await supabase
                .from('clinics')
                .select('id, name')
                .order('name');

            if (error) throw error;

            this.clinics = data || [];

            // Populate clinic dropdowns
            const filterClinic = document.getElementById('filterClinic');
            const userClinic = document.getElementById('userClinic');

            // Clear existing options (except "All Clinics" in filter)
            while (filterClinic.options.length > 1) {
                filterClinic.remove(1);
            }
            userClinic.innerHTML = '<option value="">Select Clinic</option>';

            // Add clinic options
            this.clinics.forEach(clinic => {
                const filterOption = new Option(clinic.name, clinic.id);
                const userOption = new Option(clinic.name, clinic.id);
                filterClinic.add(filterOption);
                userClinic.add(userOption);
            });

        } catch (error) {
            console.error('Load clinics error:', error);
            throw error;
        }
    }

    async loadUsers() {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select(`
                    id,
                    email,
                    first_name,
                    last_name,
                    role,
                    phone,
                    is_active,
                    last_login,
                    clinic_id,
                    clinics (
                        name
                    )
                `)
                .order('last_name');

            if (error) throw error;

            this.users = data || [];
            this.renderUsers();

        } catch (error) {
            console.error('Load users error:', error);
            throw error;
        }
    }

    renderUsers() {
        if (this.users.length === 0) {
            this.usersTableBody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <div class="empty-state-icon">👥</div>
                            <h3>No users found</h3>
                            <p>Add users to get started</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        this.usersTableBody.innerHTML = this.users.map(user => `
            <tr data-user-id="${user.id}">
                <td>${this.escapeHtml(user.first_name)} ${this.escapeHtml(user.last_name)}</td>
                <td>${this.escapeHtml(user.email)}</td>
                <td><span class="user-role">${this.escapeHtml(user.role.toUpperCase())}</span></td>
                <td>${user.clinics ? this.escapeHtml(user.clinics.name) : 'N/A'}</td>
                <td>
                    <span class="user-status ${user.is_active ? 'active' : 'inactive'}">
                        ${user.is_active ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>${user.last_login ? this.formatDateTime(user.last_login) : 'Never'}</td>
                <td>
                    <div class="user-actions">
                        <button class="btn-icon btn-edit" onclick="usersManager.editUser('${user.id}')">
                            ✏️ Edit
                        </button>
                        ${user.is_active ? `
                            <button class="btn-icon btn-deactivate" onclick="usersManager.toggleUserStatus('${user.id}', false)">
                                🚫 Deactivate
                            </button>
                        ` : `
                            <button class="btn-icon btn-activate" onclick="usersManager.toggleUserStatus('${user.id}', true)">
                                ✅ Activate
                            </button>
                        `}
                    </div>
                </td>
            </tr>
        `).join('');
    }

    filterUsers() {
        const searchTerm = document.getElementById('filterSearch').value.toLowerCase();
        const clinicFilter = document.getElementById('filterClinic').value;
        const roleFilter = document.getElementById('filterRole').value;
        const statusFilter = document.getElementById('filterStatus').value;

        const rows = this.usersTableBody.querySelectorAll('tr[data-user-id]');

        rows.forEach(row => {
            const user = this.users.find(u => u.id === row.dataset.userId);
            if (!user) return;

            const matchesSearch = !searchTerm || 
                user.first_name.toLowerCase().includes(searchTerm) ||
                user.last_name.toLowerCase().includes(searchTerm) ||
                user.email.toLowerCase().includes(searchTerm);

            const matchesClinic = !clinicFilter || user.clinic_id === clinicFilter;
            const matchesRole = !roleFilter || user.role === roleFilter;
            const matchesStatus = !statusFilter || 
                (statusFilter === 'active' && user.is_active) ||
                (statusFilter === 'inactive' && !user.is_active);

            row.style.display = matchesSearch && matchesClinic && matchesRole && matchesStatus ? '' : 'none';
        });
    }

    openModal(userId = null) {
        this.editingUserId = userId;
        
        if (userId) {
            // Edit mode
            this.modalTitle.textContent = 'Edit User';
            this.loadUserData(userId);
        } else {
            // Add mode
            this.modalTitle.textContent = 'Add User';
            this.userForm.reset();
            document.getElementById('userId').value = '';
        }

        this.modal.classList.add('active');
    }

    closeModal() {
        this.modal.classList.remove('active');
        this.userForm.reset();
        this.editingUserId = null;
    }

    async loadUserData(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        document.getElementById('userId').value = user.id;
        document.getElementById('userEmail').value = user.email;
        document.getElementById('userFirstName').value = user.first_name;
        document.getElementById('userLastName').value = user.last_name;
        document.getElementById('userRole').value = user.role;
        document.getElementById('userClinic').value = user.clinic_id || '';
        document.getElementById('userPhone').value = user.phone || '';
        document.getElementById('userNotes').value = user.notes || '';
    }

    async saveUser() {
        try {
            showLoading(this.editingUserId ? 'Updating user...' : 'Creating user...');

            const userId = document.getElementById('userId').value;
            const email = document.getElementById('userEmail').value.trim();
            const firstName = document.getElementById('userFirstName').value.trim();
            const lastName = document.getElementById('userLastName').value.trim();
            const role = document.getElementById('userRole').value;
            const clinicId = document.getElementById('userClinic').value;
            const phone = document.getElementById('userPhone').value.trim();
            const notes = document.getElementById('userNotes').value.trim();

            // Validate email format
            if (!this.isValidEmail(email)) {
                throw new Error('Please enter a valid email address');
            }

            // Validate clinic assignment
            if (!clinicId) {
                throw new Error('Please select a clinic');
            }

            const userData = {
                email: email.toLowerCase(),
                first_name: firstName,
                last_name: lastName,
                role: role,
                clinic_id: clinicId,
                phone: phone || null,
                notes: notes || null,
                updated_at: new Date().toISOString()
            };

            let result;

            if (userId) {
                // Update existing user
                result = await supabase
                    .from('profiles')
                    .update(userData)
                    .eq('id', userId);
            } else {
                // Create new user
                // Generate UUID for new user
                userData.id = crypto.randomUUID();
                userData.is_active = true;
                userData.created_at = new Date().toISOString();

                result = await supabase
                    .from('profiles')
                    .insert(userData);
            }

            if (result.error) throw result.error;

            hideLoading();
            showSuccess(userId ? 'User updated successfully' : 'User created successfully');
            
            this.closeModal();
            await this.loadUsers();

        } catch (error) {
            console.error('Save user error:', error);
            hideLoading();
            showError('Failed to save user: ' + error.message);
        }
    }

    async toggleUserStatus(userId, newStatus) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        const action = newStatus ? 'activate' : 'deactivate';
        const confirmed = confirm(`Are you sure you want to ${action} ${user.first_name} ${user.last_name}?`);
        
        if (!confirmed) return;

        try {
            showLoading(`${newStatus ? 'Activating' : 'Deactivating'} user...`);

            const { error } = await supabase
                .from('profiles')
                .update({ 
                    is_active: newStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('id', userId);

            if (error) throw error;

            hideLoading();
            showSuccess(`User ${newStatus ? 'activated' : 'deactivated'} successfully`);
            
            await this.loadUsers();

        } catch (error) {
            console.error('Toggle status error:', error);
            hideLoading();
            showError('Failed to update user status: ' + error.message);
        }
    }

    async editUser(userId) {
        this.openModal(userId);
    }

    // Helper methods
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDateTime(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// Create global instance
const usersManager = new UsersManager();
