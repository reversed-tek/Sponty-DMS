// UI Helper Functions

// Show error message
export function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.classList.add('show');
    }
}

// Hide error message
export function hideError(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.remove('show');
    }
}

// Show notification
export function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    const contentArea = document.getElementById('contentArea');
    if (contentArea) {
        contentArea.insertBefore(notification, contentArea.firstChild);
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Show loading indicator
export function showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = '<div class="loading">Loading...</div>';
    }
}

// Hide loading indicator
export function hideLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        const loading = element.querySelector('.loading');
        if (loading) {
            loading.remove();
        }
    }
}

// Create modal dialog
export function createModal(title, content, buttons = []) {
    // Remove existing modal if any
    const existingModal = document.getElementById('modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: linear-gradient(to bottom, #ECE9D8 0%, #D4D0C8 100%);
        border: 2px solid #0054E3;
        min-width: 400px;
        max-width: 600px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
    `;
    
    const modalHeader = document.createElement('div');
    modalHeader.style.cssText = `
        background: linear-gradient(to bottom, #0054E3 0%, #003BA5 100%);
        color: white;
        padding: 4px 8px;
        font-size: 13px;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    modalHeader.innerHTML = `
        <span>${title}</span>
        <button onclick="closeModal()" style="background: transparent; border: none; color: white; cursor: pointer; font-size: 16px; padding: 0 4px;">×</button>
    `;
    
    const modalBody = document.createElement('div');
    modalBody.style.cssText = `
        padding: 16px;
        overflow-y: auto;
        flex: 1;
    `;
    modalBody.innerHTML = content;
    
    const modalFooter = document.createElement('div');
    modalFooter.style.cssText = `
        background: #F1EFE2;
        border-top: 1px solid #919B9C;
        padding: 8px;
        display: flex;
        gap: 6px;
        justify-content: flex-end;
    `;
    
    buttons.forEach(button => {
        const btn = document.createElement('button');
        btn.className = button.className || 'btn';
        btn.textContent = button.text;
        btn.onclick = button.onClick;
        modalFooter.appendChild(btn);
    });
    
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalContent.appendChild(modalFooter);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    return modal;
}

// Close modal
export function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) {
        modal.remove();
    }
}

// Make closeModal available globally
window.closeModal = closeModal;

// Confirm dialog
export function confirm(message, onConfirm) {
    const modal = createModal('Confirm', `<p>${message}</p>`, [
        {
            text: 'Cancel',
            className: 'btn',
            onClick: closeModal
        },
        {
            text: 'OK',
            className: 'btn btn-primary',
            onClick: () => {
                closeModal();
                onConfirm();
            }
        }
    ]);
    
    return modal;
}

// Format date
export function formatDate(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
    });
}

// Format time
export function formatTime(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

// Format currency
export function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '-';
    return '$' + parseFloat(amount).toFixed(2);
}
