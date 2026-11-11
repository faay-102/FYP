class AdminManager {
    constructor() {
        this.currentUserId = null;
        this.currentCameraId = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadSystemLogs();
        this.loadAnalytics();
    }

    bindEvents() {
        // Tab navigation
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
        
        // User management
        document.getElementById('addUser').addEventListener('click', () => this.showUserModal());
        document.getElementById('saveUser').addEventListener('click', () => this.saveUser());
        
        // Camera management
        document.getElementById('addCamera').addEventListener('click', () => this.showCameraModal());
        document.getElementById('saveCamera').addEventListener('click', () => this.saveCamera());
        
        // System logs
        document.getElementById('refreshLogs').addEventListener('click', () => this.loadSystemLogs());
        
        // Modal controls
        document.querySelectorAll('.close, .close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeModals());
        });
        
        // Close modal when clicking outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModals();
            });
        });
        
        // Delegate event handling for action buttons
        this.delegateEventHandling();
    }

    delegateEventHandling() {
        // User actions
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-edit-user')) {
                this.editUser(e.target.dataset.id);
            } else if (e.target.classList.contains('btn-delete-user')) {
                this.deleteUser(e.target.dataset.id);
            } else if (e.target.classList.contains('btn-edit-camera')) {
                this.editCamera(e.target.dataset.id);
            } else if (e.target.classList.contains('btn-delete-camera')) {
                this.deleteCamera(e.target.dataset.id);
            }
        });
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabName);
        });
        
        // Update tab content
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === `${tabName}-tab`);
        });
    }

    showUserModal(userId = null) {
        this.currentUserId = userId;
        const modal = document.getElementById('userModal');
        const title = document.getElementById('userModalTitle');
        
        if (userId) {
            title.textContent = 'Edit User';
            this.populateUserForm(userId);
        } else {
            title.textContent = 'Add User';
            document.getElementById('userForm').reset();
        }
        
        modal.style.display = 'block';
    }

    async populateUserForm(userId) {
        try {
            // In a real application, you would fetch user data from the server
            // For now, we'll get it from the table row
            const row = document.querySelector(`[data-id="${userId}"]`).closest('tr');
            const cells = row.querySelectorAll('td');
            
            document.getElementById('userUsername').value = cells[1].textContent;
            document.getElementById('userEmail').value = cells[2].textContent;
            document.getElementById('userRole').value = cells[3].querySelector('.role-badge').className.split(' ')[1];
            document.getElementById('userDepartment').value = cells[4].textContent !== 'N/A' ? cells[4].textContent : '';
            document.getElementById('userActive').checked = cells[5].querySelector('.status-badge').className.includes('active');
            
        } catch (error) {
            console.error('Error populating user form:', error);
            this.showNotification('Error loading user data', 'error');
        }
    }

    async saveUser() {
        const userData = {
            username: document.getElementById('userUsername').value,
            email: document.getElementById('userEmail').value,
            password: document.getElementById('userPassword').value,
            role: document.getElementById('userRole').value,
            department: document.getElementById('userDepartment').value,
            is_active: document.getElementById('userActive').checked
        };

        if (!userData.username || !userData.email || (!this.currentUserId && !userData.password)) {
            alert('Please fill in all required fields.');
            return;
        }

        try {
            // In a real application, you would send this to the server
            // For now, we'll simulate the action
            this.showNotification(
                this.currentUserId ? 'User updated successfully' : 'User created successfully', 
                'success'
            );
            this.closeModals();
            
            // Reload the page to see changes (in real app, update DOM dynamically)
            setTimeout(() => location.reload(), 1000);
            
        } catch (error) {
            this.showNotification('Error saving user: ' + error.message, 'error');
        }
    }

    async deleteUser(userId) {
        if (!confirm('Are you sure you want to delete this user?')) {
            return;
        }

        try {
            // In a real application, you would send DELETE request to server
            this.showNotification('User deleted successfully', 'success');
            
            // Reload the page to see changes
            setTimeout(() => location.reload(), 1000);
            
        } catch (error) {
            this.showNotification('Error deleting user: ' + error.message, 'error');
        }
    }

    showCameraModal(cameraId = null) {
        this.currentCameraId = cameraId;
        const modal = document.getElementById('cameraModal');
        const title = document.getElementById('cameraModalTitle');
        
        if (cameraId) {
            title.textContent = 'Edit Camera';
            this.populateCameraForm(cameraId);
        } else {
            title.textContent = 'Add Camera';
            document.getElementById('cameraForm').reset();
        }
        
        modal.style.display = 'block';
    }

    async populateCameraForm(cameraId) {
        try {
            // In a real application, you would fetch camera data from the server
            const card = document.querySelector(`[data-id="${cameraId}"]`).closest('.camera-card');
            const header = card.querySelector('.camera-header h4');
            const details = card.querySelector('.camera-details');
            
            document.getElementById('cameraLocation').value = header.textContent;
            
            const streamUrlText = details.querySelector('p:first-child').textContent;
            const streamUrl = streamUrlText.replace('Stream URL: ', '').trim();
            document.getElementById('cameraStreamUrl').value = streamUrl !== 'Not configured' ? streamUrl : '';
            
            const status = card.querySelector('.camera-status').className.split(' ')[1];
            document.getElementById('cameraStatus').value = status;
            
        } catch (error) {
            console.error('Error populating camera form:', error);
            this.showNotification('Error loading camera data', 'error');
        }
    }

    async saveCamera() {
        const cameraData = {
            location: document.getElementById('cameraLocation').value,
            stream_url: document.getElementById('cameraStreamUrl').value,
            status: document.getElementById('cameraStatus').value
        };

        if (!cameraData.location) {
            alert('Please fill in all required fields.');
            return;
        }

        try {
            // In a real application, you would send this to the server
            this.showNotification(
                this.currentCameraId ? 'Camera updated successfully' : 'Camera created successfully', 
                'success'
            );
            this.closeModals();
            
            // Reload the page to see changes
            setTimeout(() => location.reload(), 1000);
            
        } catch (error) {
            this.showNotification('Error saving camera: ' + error.message, 'error');
        }
    }

    async deleteCamera(cameraId) {
        if (!confirm('Are you sure you want to delete this camera?')) {
            return;
        }

        try {
            // In a real application, you would send DELETE request to server
            this.showNotification('Camera deleted successfully', 'success');
            
            // Reload the page to see changes
            setTimeout(() => location.reload(), 1000);
            
        } catch (error) {
            this.showNotification('Error deleting camera: ' + error.message, 'error');
        }
    }

    async loadSystemLogs() {
        try {
            // In a real application, you would fetch logs from the server
            const logsContainer = document.getElementById('systemLogs');
            logsContainer.innerHTML = `
                <div class="log-entry">[2024-01-15 10:30:15] User admin logged in</div>
                <div class="log-entry">[2024-01-15 10:25:43] CCTV monitoring started on camera Main Gate</div>
                <div class="log-entry">[2024-01-15 10:15:22] Incident reported: Unauthorized access at Library</div>
                <div class="log-entry">[2024-01-15 09:45:10] User security logged out</div>
                <div class="log-entry">[2024-01-15 09:30:05] Model tested with image: test_image.jpg</div>
            `;
            
        } catch (error) {
            console.error('Error loading system logs:', error);
            this.showNotification('Error loading system logs', 'error');
        }
    }

    async loadAnalytics() {
        try {
            // In a real application, you would fetch analytics data from the server
            const incidentStats = document.getElementById('incidentStats');
            const userActivity = document.getElementById('userActivity');
            
            incidentStats.innerHTML = `
                <div style="text-align: center; padding: 2rem;">
                    <h4>Incident Distribution</h4>
                    <p>Unauthorized Access: 45%</p>
                    <p>Crowd Gathering: 25%</p>
                    <p>Loitering: 20%</p>
                    <p>Other: 10%</p>
                </div>
            `;
            
            userActivity.innerHTML = `
                <div style="text-align: center; padding: 2rem;">
                    <h4>User Activity (Last 7 days)</h4>
                    <p>Active Users: 156</p>
                    <p>Logins: 342</p>
                    <p>Incidents Reported: 23</p>
                    <p>Tests Performed: 67</p>
                </div>
            `;
            
        } catch (error) {
            console.error('Error loading analytics:', error);
        }
    }

    closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        this.currentUserId = null;
        this.currentCameraId = null;
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

// Initialize admin manager when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.adminManager = new AdminManager();
});