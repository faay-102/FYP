class DashboardManager {
    constructor() {
        this.isMonitoring = false;
        this.detectionInterval = null;
        this.currentStreamUrl = '';
        this.currentCameraId = null;
        this.availableDevices = [];
        this.anomalyTimers = new Map(); // Track anomaly duration for auto-incidents
        this.init();
    }

    async init() {
        await this.initializeWebcams();
        this.bindEvents();
        this.updateStats();
        this.setupNotifications();
        // Refresh recent incidents on startup and poll periodically so uploads from other pages
        // appear in the dashboard without a manual reload.
        try {
            this.updateRecentIncidents();
            setInterval(() => this.updateRecentIncidents(), 10000); // every 10s
        } catch (err) {
            console.debug('Could not start incidents polling:', err);
        }
    }

    async initializeWebcams() {
        try {
            // First, ask server for available camera indices (OpenCV probing)
            const resp = await fetch('/api/available_cameras');
            if (resp.ok) {
                const serverDevices = await resp.json();
                // serverDevices: [{id:0,name:'Camera 0'},{...}]
                this.availableDevices = serverDevices;
            } else {
                this.availableDevices = [];
            }

            // Try to get browser labels (permission) to improve names
            try {
                await navigator.mediaDevices.getUserMedia({ video: true });
                const devs = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devs.filter(d => d.kind === 'videoinput');
                // Map names from browser to serverDevices where possible by index
                this.availableDevices = this.availableDevices.map((sd, idx) => {
                    const bd = videoDevices[idx];
                    return {
                        id: sd.id,
                        name: bd && bd.label ? `${bd.label} (Device ${sd.id})` : sd.name
                    };
                });
            } catch (err) {
                console.log('Browser labels unavailable, using server device names');
            }

            // Populate webcam select (value is server-side numeric id)
            const webcamSelect = document.getElementById('webcamSelect');
            if (webcamSelect) {
                if (this.availableDevices.length > 0) {
                    webcamSelect.innerHTML = this.availableDevices.map(device =>
                        `<option value="${device.id}">${device.name}</option>`
                    ).join('');
                } else {
                    webcamSelect.innerHTML = '<option value="">No cameras detected on server</option>';
                }
            }
        } catch (error) {
            console.error('Error accessing webcam:', error);
            this.showNotification('Failed to access webcam. Please check permissions.', 'error');
        }
    }

    bindEvents() {
        // Camera source selection
        const sourceSelect = document.getElementById('cameraSource');
        if (sourceSelect) {
            sourceSelect.addEventListener('change', (e) => this.handleSourceChange(e.target.value));
        }

        // Confidence threshold slider
        const confidenceSlider = document.getElementById('confidenceThreshold');
        if (confidenceSlider) {
            confidenceSlider.addEventListener('input', (e) => {
                document.getElementById('confidenceValue').textContent = e.target.value + '%';
            });
        }

        // Attach start/stop camera buttons
        document.querySelectorAll('.start-camera').forEach(btn => {
            btn.addEventListener('click', (e) => this.startCamera(e.currentTarget.dataset.cameraId));
        });
        document.querySelectorAll('.stop-camera').forEach(btn => {
            btn.addEventListener('click', (e) => this.stopCamera(e.currentTarget.dataset.cameraId));
        });
        // Attach remove camera buttons
        document.querySelectorAll('.remove-camera').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const camId = e.currentTarget.dataset.cameraId;
                if (!confirm('Remove camera from system? This will delete its monitors and incidents.')) return;
                this.removeCamera(camId);
            });
        });

        // Model toggles for each camera
        document.querySelectorAll('.camera-monitor-card').forEach(card => {
            const cameraId = card.dataset.cameraId;
            card.querySelectorAll('input[type="checkbox"][data-model]').forEach(checkbox => {
                checkbox.addEventListener('change', (e) => this.toggleModel(cameraId, e.target));
            });
        });

        // Incident delay inputs
        document.querySelectorAll('input[name="incident_delay"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                if (value < 1) e.target.value = 1;
                if (value > 60) e.target.value = 60;
            });
        });

        // Modal controls
        document.querySelectorAll('.close, .close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeModals());
        });

        // Add Camera button opens modal
        const addCameraBtn = document.getElementById('addCameraBtn');
        if (addCameraBtn) addCameraBtn.addEventListener('click', () => {
            // populate webcamSelect with available devices if present
            const webcamSelect = document.getElementById('webcamSelect');
            if (webcamSelect && this.availableDevices.length > 0) {
                // availableDevices entries use {id, name}
                webcamSelect.innerHTML = this.availableDevices.map(d => `<option value="${d.id}">${d.name || 'Camera ' + d.id}</option>`).join('');
            }
            document.getElementById('addCameraModal').style.display = 'block';
        });

        // Save camera button
        const saveCameraBtn = document.getElementById('saveCamera');
        if (saveCameraBtn) saveCameraBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.handleAddCamera();
        });

        // Start/Stop all monitoring
        const startAllBtn = document.getElementById('startAllMonitoring');
        if (startAllBtn) startAllBtn.addEventListener('click', () => this.startAllCameras());
        const stopAllBtn = document.getElementById('stopAllMonitoring');
        if (stopAllBtn) stopAllBtn.addEventListener('click', () => this.stopAllCameras());
    }

    setupNotifications() {
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }
    }

    handleSourceChange(sourceType) {
        const webcamDevices = document.getElementById('webcamDevices');
        const streamUrlGroup = document.getElementById('streamUrlGroup');
        
        webcamDevices.style.display = ['webcam', 'external'].includes(sourceType) ? 'block' : 'none';
        streamUrlGroup.style.display = sourceType === 'ip' ? 'block' : 'none';
    }

    async handleAddCamera() {
        const form = document.getElementById('cameraForm');
        const formData = new FormData(form);
        
        const cameraData = {
            name: formData.get('name'),
            location: formData.get('location'),
            source_type: formData.get('source_type'),
            device_id: formData.get('device_id') ? parseInt(formData.get('device_id')) : null,
            stream_url: formData.get('stream_url'),
            models: Array.from(form.querySelectorAll('input[name="models"]:checked')).map(cb => cb.value),
            incident_delay: parseInt(formData.get('incident_delay')),
            confidence_threshold: parseInt(formData.get('confidence_threshold')) / 100
        };

        if (!cameraData.name || !cameraData.location) {
            this.showNotification('Please fill in all required fields', 'error');
            return;
        }

        if (cameraData.source_type === 'ip' && !cameraData.stream_url) {
            this.showNotification('Stream URL is required for IP cameras', 'error');
            return;
        }

        try {
            const response = await fetch('/api/cameras', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cameraData)
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification('Camera added successfully', 'success');
                this.closeModals();
                location.reload(); // Refresh to show new camera
            } else {
                this.showNotification(result.message || 'Failed to add camera', 'error');
            }
        } catch (error) {
            this.showNotification('Error adding camera: ' + error.message, 'error');
        }
    }

    async removeCamera(cameraId) {
        try {
            const response = await fetch(`/api/cameras/${cameraId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (result.success) {
                // Remove card from DOM
                const card = document.querySelector(`.camera-monitor-card[data-camera-id="${cameraId}"]`);
                if (card) card.remove();
                this.showNotification('Camera removed', 'info');
            } else {
                this.showNotification(result.message || 'Failed to remove camera', 'error');
            }
        } catch (err) {
            this.showNotification('Error removing camera: ' + err.message, 'error');
        }
    }

    async toggleModel(cameraId, checkbox) {
        const modelType = checkbox.dataset.model;
        const isActive = checkbox.checked;
        
        try {
            const response = await fetch(`/api/camera_monitors/${cameraId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_type: modelType,
                    is_active: isActive
                })
            });

            const result = await response.json();
            if (!result.success) {
                checkbox.checked = !isActive; // Revert on failure
                this.showNotification(result.message || 'Failed to update model', 'error');
            }
        } catch (error) {
            checkbox.checked = !isActive; // Revert on failure
            this.showNotification('Error updating model: ' + error.message, 'error');
        }
    }

    async startAllCameras() {
        const startButtons = document.querySelectorAll('.start-camera:not([disabled])');
        for (const btn of startButtons) {
            await this.startCamera(btn.dataset.cameraId);
        }
    }

    async stopAllCameras() {
        const stopButtons = document.querySelectorAll('.stop-camera:not([disabled])');
        for (const btn of stopButtons) {
            await this.stopCamera(btn.dataset.cameraId);
        }
    }

    async startCamera(cameraId) {
        try {
            const response = await fetch('/api/start_monitoring', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ camera_id: parseInt(cameraId) })
            });

            const result = await response.json();
            if (result.success) {
                this.updateCameraUI(cameraId, true);
                this.showNotification(`Started monitoring camera ${cameraId}`, 'success');
                // Ensure detection polling is running so the UI receives frames
                this.startDetectionUpdates();
            } else {
                this.showNotification(result.message || 'Failed to start camera', 'error');
            }
        } catch (error) {
            this.showNotification('Error starting camera: ' + error.message, 'error');
        }
    }

    async stopCamera(cameraId) {
        try {
            const response = await fetch('/api/stop_monitoring', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ camera_id: parseInt(cameraId) })
            });

            const result = await response.json();
            if (result.success) {
                this.updateCameraUI(cameraId, false);
                this.showNotification(`Stopped monitoring camera ${cameraId}`, 'info');
                // If no more active cameras, stop polling
                const activeStopButtons = document.querySelectorAll('.stop-camera:not([disabled])');
                if (!activeStopButtons || activeStopButtons.length === 0) {
                    this.stopDetectionUpdates();
                }
            } else {
                this.showNotification(result.message || 'Failed to stop camera', 'error');
            }
        } catch (error) {
            this.showNotification('Error stopping camera: ' + error.message, 'error');
        }
    }

    updateCameraUI(cameraId, isActive) {
        const card = document.querySelector(`.camera-monitor-card[data-camera-id="${cameraId}"]`);
        if (!card) return;

        const startBtn = card.querySelector('.start-camera');
        const stopBtn = card.querySelector('.stop-camera');
        const status = card.querySelector('.camera-status');
        const feedPlaceholder = card.querySelector('.feed-placeholder');
        const liveFeed = card.querySelector(`#liveFeed-${cameraId}`);

        // Always reset the feed image when changing state
        if (liveFeed) {
            liveFeed.src = '';
        }

        if (isActive) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            status.textContent = 'ACTIVE';
            status.className = 'camera-status status-active';
            if (feedPlaceholder) feedPlaceholder.style.display = 'none';
            if (liveFeed) liveFeed.style.display = 'block';
            
            // Start detection updates when camera becomes active
            this.startDetectionUpdates();
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
            status.textContent = 'OFFLINE';
            status.className = 'camera-status status-offline';
            if (feedPlaceholder) feedPlaceholder.style.display = 'flex';
            if (liveFeed) liveFeed.style.display = 'none';
            
            // Clear any active anomaly timers for this camera
            for (const [key, timer] of this.anomalyTimers.entries()) {
                if (key.startsWith(`${cameraId}:`)) {
                    clearTimeout(timer);
                    this.anomalyTimers.delete(key);
                }
            }

            // Only stop updates if no other cameras are active
            const activeStopButtons = document.querySelectorAll('.stop-camera:not([disabled])');
            if (!activeStopButtons || activeStopButtons.length === 0) {
                this.stopDetectionUpdates();
            }
        }
    }

    async checkAnomalies(data) {
        if (!data.anomalies || !data.anomalies.length) {
            // Clear anomaly timers for this camera if no anomalies
            for (const [key, timer] of this.anomalyTimers.entries()) {
                if (key.startsWith(`${data.camera_id}:`)) {
                    clearTimeout(timer);
                    this.anomalyTimers.delete(key);
                }
            }
            return;
        }

        const alertsContainer = document.getElementById('alertsContainer');
        const noAlerts = alertsContainer.querySelector('.no-alerts');
        if (noAlerts) noAlerts.remove();

        for (const anomaly of data.anomalies) {
            const anomalyKey = `${data.camera_id}:${anomaly.type}`;
            
            // If this anomaly doesn't have a timer yet, create one
            if (!this.anomalyTimers.has(anomalyKey)) {
                const timer = setTimeout(async () => {
                    await this.createIncident({
                        title: `Auto-detected: ${anomaly.type}`,
                        description: anomaly.message,
                        type: anomaly.type,
                        severity: anomaly.severity || 'medium',
                        location: data.camera_name,
                        camera_id: data.camera_id,
                        confidence_score: anomaly.confidence,
                        frame_evidence: data.frame_base64
                    });
                    
                    // Clear the timer
                    this.anomalyTimers.delete(anomalyKey);
                    
                    // Show browser notification
                    this.showBrowserNotification({
                        title: 'Incident Created',
                        body: `${anomaly.type} detected at ${data.camera_name}`,
                        icon: '/static/img/alert-icon.png'
                    });
                    
                    // Play alert sound
                    this.playAlertSound();
                }, 5000); // 5 seconds delay
                
                this.anomalyTimers.set(anomalyKey, timer);
            }

            // Create or update alert in UI
            this.updateAlertUI(data.camera_id, anomaly, data.camera_name);
        }
    }

    async createIncident(incidentData) {
        try {
            const response = await fetch('/api/incidents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(incidentData)
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification('New incident created', 'success');
                // Update incidents list if visible
                const incidentsList = document.querySelector('.incidents-list');
                if (incidentsList) {
                    // Fetch and update recent incidents
                    this.updateRecentIncidents();
                }
            } else {
                this.showNotification('Failed to create incident: ' + result.message, 'error');
            }
        } catch (error) {
            this.showNotification('Error creating incident: ' + error.message, 'error');
        }
    }

    updateAlertUI(cameraId, anomaly, cameraName) {
        const alertsContainer = document.getElementById('alertsContainer');
        const alertId = `alert-${cameraId}-${anomaly.type}`;
        let alertElement = document.getElementById(alertId);
        
        if (!alertElement) {
            alertElement = document.createElement('div');
            alertElement.id = alertId;
            alertElement.className = `alert-item severity-${anomaly.severity || 'medium'}`;
            alertsContainer.appendChild(alertElement);
        }

        alertElement.innerHTML = `
            <div class="alert-header">
                <span class="alert-type">${anomaly.type}</span>
                <span class="alert-confidence">${Math.round(anomaly.confidence * 100)}%</span>
            </div>
            <div class="alert-body">
                <p>${anomaly.message}</p>
                <small>${cameraName}</small>
            </div>
        `;

        // Remove after 30 seconds if not already removed
        setTimeout(() => alertElement.remove(), 30000);
    }

    async updateRecentIncidents() {
        try {
            const response = await fetch('/api/recent_incidents');
            const incidents = await response.json();
            
            const incidentsList = document.querySelector('.incidents-list');
            if (incidentsList && incidents.length > 0) {
                incidentsList.innerHTML = incidents.map(incident => `
                    <div class="incident-card severity-${incident.severity}">
                        <div class="incident-header">
                            <h4>${incident.title}</h4>
                            <span class="incident-time">${incident.created_at}</span>
                        </div>
                        <p>${incident.description}</p>
                        <div class="incident-footer">
                            <span class="incident-location">${incident.location}</span>
                            <span class="incident-status">${incident.status}</span>
                        </div>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Error updating incidents:', error);
        }
    }

    playAlertSound() {
        const audio = new Audio('/static/audio/alert.mp3');
        audio.play().catch(error => console.log('Error playing alert sound:', error));
    }

    

    formatTimestamp(date) {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(date));
    }
    

    showCCTVModal() {
        document.getElementById('cctvModal').style.display = 'block';
    }

    closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }

    async startMonitoring() {
        const streamUrl = document.getElementById('streamUrl').value;
        const cameraId = document.getElementById('cameraSelect').value;
        
        this.currentStreamUrl = streamUrl;
        this.currentCameraId = cameraId;
        if (!cameraId) {
            this.showNotification('Please select a camera to start monitoring', 'error');
            return;
        }

        // Use existing helper to start the camera (will call server route)
        await this.startCamera(cameraId);
        this.closeModals();
    }

    async stopMonitoring() {
        if (!this.currentCameraId) {
            this.showNotification('No camera selected to stop', 'error');
            return;
        }

        await this.stopCamera(this.currentCameraId);
    }

    updateMonitoringUI(isActive) {
        const statusDot = document.getElementById('monitoringStatus');
        const statusText = document.getElementById('monitoringText');
        const currentStatus = document.getElementById('currentStatus');
        const startBtn = document.getElementById('startMonitoring');
        const stopBtn = document.getElementById('stopMonitoring');
        const feedPlaceholder = document.getElementById('feedPlaceholder');
        const liveFeed = document.getElementById('liveFeed');

        if (isActive) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Monitoring Active';
            currentStatus.textContent = 'Active';
            currentStatus.className = 'status-good';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            feedPlaceholder.style.display = 'none';
            liveFeed.style.display = 'block';
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Monitoring Offline';
            currentStatus.textContent = 'Inactive';
            currentStatus.className = 'status-bad';
            startBtn.disabled = false;
            stopBtn.disabled = true;
            feedPlaceholder.style.display = 'flex';
            liveFeed.style.display = 'none';
        }
    }

    startDetectionUpdates() {
        // Clear any existing interval first
        this.stopDetectionUpdates();
        
        // Start new interval
        this.detectionInterval = setInterval(() => {
            this.fetchDetectionData();
        }, 500); // Update twice per second for smoother feed
        
        // Initial fetch
        this.fetchDetectionData();
    }

    stopDetectionUpdates() {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
    }

    async fetchDetectionData() {
        try {
            const response = await fetch('/api/detection_data');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            if (data.error) {
                console.debug('No new frames available:', data.error);
                return;
            }

            // Only update if we have valid frame data
            if (data.frame_base64) {
                this.updateLiveFeed(data);
                this.updateStatsDisplay(data);
                this.checkAnomalies(data);
            }
        } catch (error) {
            console.error('Error fetching detection data:', error);
        }
    }

    updateLiveFeed(data) {
        // Update the per-camera live feed image using camera_id
        if (!data || !data.camera_id) return;
        const cameraId = data.camera_id;
        const liveFeed = document.getElementById(`liveFeed-${cameraId}`);
        const placeholder = document.getElementById(`feedPlaceholder-${cameraId}`);
        if (!liveFeed) return;

        if (data.frame_base64) {
            // Create new image to test loading
            const testImg = new Image();
            testImg.onload = () => {
                liveFeed.src = testImg.src;
                liveFeed.style.display = 'block';
                if (placeholder) {
                    placeholder.style.display = 'none';
                }
            };
            testImg.onerror = (error) => {
                console.error('Error loading frame:', error);
                liveFeed.style.display = 'none';
                if (placeholder) {
                    placeholder.style.display = 'flex';
                }
            };
            testImg.src = 'data:image/jpeg;base64,' + data.frame_base64;
        } else {
            liveFeed.style.display = 'none';
            if (placeholder) {
                placeholder.style.display = 'flex';
            }
        }
    }

    updateStatsDisplay(data) {
        document.getElementById('studentsCount').textContent = data.students_detected || 0;
        document.getElementById('fpsCount').textContent = data.fps || 0;
        document.getElementById('deviceType').textContent = data.device || 'CPU';
    }

    checkAnomalies(data) {
        const anomalyAlerts = document.getElementById('anomalyAlerts');
        const anomalyList = document.getElementById('anomalyList');
        
        if (data.anomalies && data.anomalies.length > 0) {
            anomalyAlerts.style.display = 'block';
            anomalyList.innerHTML = '';
            
            data.anomalies.forEach(anomaly => {
                if (anomaly.confidence > 0.5) { // Only show high confidence anomalies
                    const alertItem = document.createElement('div');
                    alertItem.className = 'anomaly-alert';
                    alertItem.innerHTML = `
                        <strong>${anomaly.type.toUpperCase()}</strong>: ${anomaly.message}
                        <span class="confidence">(${Math.round(anomaly.confidence * 100)}%)</span>
                    `;
                    anomalyList.appendChild(alertItem);
                    
                    // Show browser notification for critical anomalies
                    if (anomaly.confidence > 0.8) {
                        this.showBrowserNotification(anomaly);
                    }
                }
            });
        } else {
            anomalyAlerts.style.display = 'none';
        }
    }

    

    showBrowserNotification(payload) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        let title = 'CampusGuard Alert';
        let body = '';
        let icon = '/static/favicon.ico';

        if (payload && payload.title) {
            title = payload.title;
            body = payload.body || '';
            icon = payload.icon || icon;
        } else if (payload && payload.type) {
            title = `${payload.type.toUpperCase()} Alert`;
            body = payload.message || '';
        }

        try {
            new Notification(title, { body, icon, silent: true });
        } catch (err) {
            console.warn('Notification failed:', err);
        }
    }

    async updateStats() {
        try {
            const response = await fetch('/api/stats');
            const data = await response.json();
            
            // Update any additional stats on the dashboard
            console.log('System stats updated:', data);
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    showNotification(message, type) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `flash-message ${type}`;
        notification.textContent = message;
        
        // Add to flash messages container
        const container = document.querySelector('.flash-messages') || this.createFlashContainer();
        container.appendChild(notification);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    createFlashContainer() {
        const container = document.createElement('div');
        container.className = 'flash-messages';
        document.body.appendChild(container);
        return container;
    }
}

// Request notification permission on page load
document.addEventListener('DOMContentLoaded', function() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
});

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.dashboardManager = new DashboardManager();
});