class IncidentsManager {
    constructor() {
        this.currentIncidentId = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadIncidents();
    }

    bindEvents() {
        // Report incident button
        document.getElementById('reportIncident').addEventListener('click', () => this.showReportModal());
        
        // Clear incidents button
        document.getElementById('clearIncidents').addEventListener('click', () => this.clearAllIncidents());
        
        // Filter controls
        document.getElementById('applyFilters').addEventListener('click', () => this.applyFilters());
        
        // Modal controls
        document.querySelectorAll('.close, .close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeModals());
        });
        
        // Form submission
        document.getElementById('submitIncident').addEventListener('click', () => this.submitIncident());
        document.getElementById('confirmUpdate').addEventListener('click', () => this.updateIncidentStatus());
        
        // Close modal when clicking outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModals();
            });
        });
        
        // Delegate event handling for action buttons
        document.getElementById('incidentsTableBody').addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-edit')) {
                this.showUpdateModal(e.target.dataset.id, e.target.dataset.status);
            } else if (e.target.classList.contains('btn-delete')) {
                this.deleteIncident(e.target.dataset.id);
            }
        });
    }

    showReportModal() {
        document.getElementById('reportModal').style.display = 'block';
        document.getElementById('incidentForm').reset();
    }

    showUpdateModal(incidentId, currentStatus) {
        this.currentIncidentId = incidentId;
        document.getElementById('statusUpdate').value = currentStatus;
        document.getElementById('updateModal').style.display = 'block';
    }

    closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        this.currentIncidentId = null;
    }

    async submitIncident() {
        const form = document.getElementById('incidentForm');
        const formData = new FormData(form);
        
        const incidentData = {
            title: document.getElementById('incidentTitle').value,
            description: document.getElementById('incidentDescription').value,
            type: document.getElementById('incidentType').value,
            severity: document.getElementById('incidentSeverity').value,
            location: document.getElementById('incidentLocation').value
        };

        if (!incidentData.title || !incidentData.type || !incidentData.severity) {
            alert('Please fill in all required fields.');
            return;
        }

        try {
            const response = await fetch('/api/incidents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(incidentData)
            });

            const data = await response.json();

            if (data.success) {
                this.closeModals();
                this.loadIncidents();
                this.showNotification('Incident reported successfully', 'success');
            } else {
                this.showNotification('Failed to report incident: ' + data.message, 'error');
            }
        } catch (error) {
            this.showNotification('Error reporting incident: ' + error.message, 'error');
        }
    }

    async updateIncidentStatus() {
        if (!this.currentIncidentId) return;

        const newStatus = document.getElementById('statusUpdate').value;

        try {
            const response = await fetch(`/api/incidents/${this.currentIncidentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: newStatus })
            });

            const data = await response.json();

            if (data.success) {
                this.closeModals();
                this.loadIncidents();
                this.showNotification('Incident status updated successfully', 'success');
            } else {
                this.showNotification('Failed to update incident status', 'error');
            }
        } catch (error) {
            this.showNotification('Error updating incident status: ' + error.message, 'error');
        }
    }

    async deleteIncident(incidentId) {
        if (!confirm('Are you sure you want to delete this incident?')) {
            return;
        }

        try {
            const response = await fetch(`/api/incidents/${incidentId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                this.loadIncidents();
                this.showNotification('Incident deleted successfully', 'success');
            } else {
                this.showNotification('Failed to delete incident', 'error');
            }
        } catch (error) {
            this.showNotification('Error deleting incident: ' + error.message, 'error');
        }
    }

    async loadIncidents() {
        try {
            const response = await fetch('/api/incidents', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            const incidents = await response.json();
            this.renderIncidents(incidents);
        } catch (error) {
            console.error('Error loading incidents:', error);
            this.showNotification('Error loading incidents', 'error');
        }
    }

    renderIncidents(incidents) {
        const tableBody = document.getElementById('incidentsTableBody');
        
        if (!Array.isArray(incidents) || incidents.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 2rem;">
                        No incidents found
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = incidents.map(incident => `
            <tr class="incident-row severity-${incident.severity}">
                <td>${incident.id}</td>
                <td>${incident.title}</td>
                <td>${incident.type}</td>
                <td>
                    <span class="severity-badge ${incident.severity}">
                        ${incident.severity.toUpperCase()}
                    </span>
                </td>
                <td>${incident.location || 'N/A'}</td>
                <td>
                    <span class="status-badge ${incident.status}">
                        ${incident.status.toUpperCase()}
                    </span>
                </td>
                <td>${incident.reported_by}</td>
                <td>${incident.created_at}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-edit" 
                                data-id="${incident.id}" 
                                data-status="${incident.status}">
                            Update
                        </button>
                        ${window.currentUserRole === 'admin' ? `
                        <button class="btn-action btn-delete" data-id="${incident.id}">
                            Delete
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    }

    applyFilters() {
        const statusFilter = document.getElementById('statusFilter').value;
        const severityFilter = document.getElementById('severityFilter').value;
        
        const rows = document.querySelectorAll('.incident-row');
        
        rows.forEach(row => {
            const status = row.querySelector('.status-badge').className.includes(statusFilter);
            const severity = row.className.includes(`severity-${severityFilter}`);
            
            if ((statusFilter === 'all' || status) && (severityFilter === 'all' || severity)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    async clearAllIncidents() {
        if (!confirm('Are you sure you want to clear all incidents? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch('/api/incidents/clear', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})  // Send empty JSON object
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success) {
                // Immediately clear the table
                const tableBody = document.getElementById('incidentsTableBody');
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="9" style="text-align: center; padding: 2rem;">
                            No incidents found
                        </td>
                    </tr>
                `;
                
                // Refresh the incidents list to ensure sync with server
                await this.loadIncidents();
                this.showNotification('All incidents cleared successfully', 'success');
            } else {
                this.showNotification('Failed to clear incidents: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Clear incidents error:', error);
            this.showNotification('Error clearing incidents: ' + error.message, 'error');
        }
    }

    showNotification(message, type) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `flash-message ${type}`;
        notification.textContent = message;
        
        // Add to flash messages container or create one
        let container = document.querySelector('.flash-messages');
        if (!container) {
            container = document.createElement('div');
            container.className = 'flash-messages';
            document.body.appendChild(container);
        }
        
        container.appendChild(notification);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Initialize incidents manager when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.incidentsManager = new IncidentsManager();
});