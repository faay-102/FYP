class DashboardManager {
    constructor() {
        this.isMonitoring = false;
        this.detectionInterval = null;
        this.currentCameraId = null;
        this.selectedFile = null;
        this.init();
    }

    async init() {
        this.bindEvents();
        this.bindCameraToggle();
        this.bindQuickTest();
        this.setupNotifications();
        
        // Auto-poll recent incidents periodically
        try {
            this.updateRecentIncidents();
            setInterval(() => this.updateRecentIncidents(), 8000);
        } catch (err) {
            console.debug('Incidents polling init:', err);
        }
    }

    bindEvents() {
        // Modal controls
        document.querySelectorAll('.close, .close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeModals());
        });

        const addCameraBtn = document.getElementById('addCameraBtn');
        if (addCameraBtn) {
            addCameraBtn.addEventListener('click', () => {
                document.getElementById('addCameraModal').style.display = 'block';
            });
        }

        const sourceSelect = document.getElementById('cameraSource');
        if (sourceSelect) {
            sourceSelect.addEventListener('change', (e) => {
                const isIp = e.target.value === 'ip';
                const urlGroup = document.getElementById('streamUrlGroup');
                if (urlGroup) urlGroup.style.display = isIp ? 'block' : 'none';
            });
        }

        const saveCameraBtn = document.getElementById('saveCamera');
        if (saveCameraBtn) {
            saveCameraBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleAddCamera();
            });
        }
    }

    bindCameraToggle() {
        const toggleBtn = document.getElementById('cameraToggleBtn');
        const cameraSelect = document.getElementById('hubCameraSelect');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', async () => {
                if (this.isMonitoring) {
                    await this.stopCamera();
                } else {
                    let camId = cameraSelect ? cameraSelect.value : null;
                    if (!camId && cameraSelect && cameraSelect.options.length > 0) {
                        camId = cameraSelect.options[0].value;
                    }
                    await this.startCamera(camId || 1);
                }
            });
        }

        if (cameraSelect) {
            cameraSelect.addEventListener('change', async () => {
                if (this.isMonitoring) {
                    await this.stopCamera();
                    await this.startCamera(cameraSelect.value);
                }
            });
        }
    }

    async startCamera(cameraId) {
        try {
            this.showNotification('Connecting to camera...', 'info');
            const resp = await fetch('/api/start_monitoring', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ camera_id: parseInt(cameraId) })
            });
            const res = await resp.json();

            if (res.success) {
                this.isMonitoring = true;
                this.currentCameraId = cameraId;
                
                // Update UI elements
                const placeholder = document.getElementById('hubPlaceholder');
                const liveImg = document.getElementById('hubLiveFeedImg');
                const badge = document.getElementById('hubLiveBadge');
                const toggleBtn = document.getElementById('cameraToggleBtn');
                const toggleText = document.getElementById('cameraToggleText');

                if (placeholder) placeholder.style.display = 'none';
                if (liveImg) liveImg.style.display = 'block';
                if (badge) badge.style.display = 'flex';
                
                if (toggleBtn) {
                    toggleBtn.className = 'btn btn-danger btn-small';
                    toggleBtn.style.padding = '0.5rem 1.25rem';
                }
                if (toggleText) toggleText.textContent = 'Stop Camera';

                this.showNotification('Camera connected! Real-time AI monitoring active.', 'success');
                this.startDetectionUpdates();
            } else {
                this.showNotification(res.message || 'Could not start camera feed.', 'error');
            }
        } catch (err) {
            this.showNotification('Camera connection error: ' + err.message, 'error');
        }
    }

    async stopCamera() {
        if (!this.currentCameraId) return;
        try {
            await fetch('/api/stop_monitoring', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ camera_id: parseInt(this.currentCameraId) })
            });
        } catch (e) {
            console.debug('Stop camera error:', e);
        }

        this.isMonitoring = false;
        this.stopDetectionUpdates();

        const placeholder = document.getElementById('hubPlaceholder');
        const liveImg = document.getElementById('hubLiveFeedImg');
        const badge = document.getElementById('hubLiveBadge');
        const toggleBtn = document.getElementById('cameraToggleBtn');
        const toggleText = document.getElementById('cameraToggleText');

        if (placeholder) placeholder.style.display = 'block';
        if (liveImg) {
            liveImg.style.display = 'none';
            liveImg.src = '';
        }
        if (badge) badge.style.display = 'none';
        
        if (toggleBtn) {
            toggleBtn.className = 'btn btn-primary btn-small';
            toggleBtn.style.padding = '0.5rem 1.25rem';
        }
        if (toggleText) toggleText.textContent = 'Start Camera';

        this.showNotification('Camera stopped.', 'info');
    }

    startDetectionUpdates() {
        this.stopDetectionUpdates();
        this.detectionInterval = setInterval(() => this.fetchDetectionData(), 500);
        this.fetchDetectionData();
    }

    stopDetectionUpdates() {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
    }

    async fetchDetectionData() {
        if (!this.isMonitoring) return;
        try {
            const resp = await fetch('/api/detection_data');
            if (!resp.ok) return;
            const data = await resp.json();

            if (data.frame_base64) {
                const liveImg = document.getElementById('hubLiveFeedImg');
                if (liveImg) {
                    liveImg.src = 'data:image/jpeg;base64,' + data.frame_base64;
                    liveImg.style.display = 'block';
                }

                // Update real-time counters
                const detCount = document.getElementById('hubDetections');
                const fpsCount = document.getElementById('hubFPS');
                const anomCount = document.getElementById('hubAnomalies');

                if (detCount) detCount.textContent = (data.detection_data ? data.detection_data.length : data.total_objects) || 0;
                if (fpsCount) fpsCount.textContent = Math.round(data.fps || 0);
                if (anomCount) anomCount.textContent = (data.anomalies && data.anomalies.length) ? data.anomalies.length : 0;

                // Sound alarm if anomaly detected
                if (data.anomalies && data.anomalies.length > 0) {
                    this.playAlertSound();
                }
            }
        } catch (err) {
            console.debug('Fetch detection poll:', err);
        }
    }

    bindQuickTest() {
        const dropzone = document.getElementById('quickDropzone');
        const fileInput = document.getElementById('quickFileInput');
        const analyzeBtn = document.getElementById('quickAnalyzeBtn');
        const dropText = document.getElementById('quickDropText');

        if (!dropzone || !fileInput || !analyzeBtn) return;

        dropzone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.selectedFile = e.target.files[0];
                dropText.textContent = `Selected: ${this.selectedFile.name}`;
                dropzone.style.borderColor = '#00bfae';
                dropzone.style.background = '#e6fffa';
                analyzeBtn.disabled = false;
            }
        });

        // Drag and drop support
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#00e5ce';
            dropzone.style.background = '#ccfbf1';
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = '#008779';
            dropzone.style.background = '#f0fdfa';
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.selectedFile = e.dataTransfer.files[0];
                dropText.textContent = `Selected: ${this.selectedFile.name}`;
                dropzone.style.borderColor = '#00bfae';
                dropzone.style.background = '#e6fffa';
                analyzeBtn.disabled = false;
            }
        });

        analyzeBtn.addEventListener('click', async () => {
            if (!this.selectedFile) return;

            analyzeBtn.disabled = true;
            analyzeBtn.innerHTML = '<span>⏳ Analyzing Neural Inference...</span>';

            const formData = new FormData();
            formData.append('file', this.selectedFile);
            formData.append('models', JSON.stringify(['normal', 'fight', 'sleep', 'suspicious']));

            try {
                const resp = await fetch('/api/upload_test', {
                    method: 'POST',
                    body: formData
                });
                const result = await resp.json();

                if (result.success) {
                    const card = document.getElementById('quickResultCard');
                    const img = document.getElementById('quickResultImg');
                    const badge = document.getElementById('quickIncidentBadge');
                    const details = document.getElementById('quickResultDetails');

                    card.style.display = 'block';
                    img.src = '/' + result.result_file;

                    if (result.incident_created) {
                        badge.textContent = '🚨 INCIDENT DETECTED';
                        badge.style.background = '#fef2f2';
                        badge.style.color = '#dc2626';
                        badge.style.border = '1px solid #fecaca';

                        this.playAlertSound();
                        this.showNotification('Security anomaly confirmed! Incident logged.', 'error');
                    } else {
                        badge.textContent = '✓ NORMAL / NO ANOMALY';
                        badge.style.background = '#ecfdf5';
                        badge.style.color = '#059669';
                        badge.style.border = '1px solid #a7f3d0';

                        this.showNotification('AI Analysis complete. No security breaches.', 'success');
                    }

                    details.innerHTML = `Detections: <strong>${result.total_detections}</strong> • Persons: <strong>${result.students_detected}</strong> • Inference Time: <strong>${result.processing_time}s</strong> (${result.fps} FPS)`;
                    
                    // Refresh incidents list
                    this.updateRecentIncidents();
                } else {
                    this.showNotification(result.message || 'Analysis failed', 'error');
                }
            } catch (err) {
                this.showNotification('Error running analysis: ' + err.message, 'error');
            } finally {
                analyzeBtn.disabled = false;
                analyzeBtn.innerHTML = '<span>⚡ Run AI Detection & Sound Alarm</span>';
            }
        });
    }

    async updateRecentIncidents() {
        try {
            const resp = await fetch('/api/recent_incidents');
            if (!resp.ok) return;
            const incidents = await resp.json();

            const list = document.getElementById('dashboardIncidentsList');
            if (!list || !incidents || !incidents.length) return;

            list.innerHTML = incidents.map(inc => `
                <div class="incident-card severity-${inc.severity}" style="padding:1rem; border-radius:10px;">
                    <div class="incident-header">
                        <span class="incident-title" style="font-weight:750;">${inc.title}</span>
                        <span class="incident-severity ${inc.severity}">${(inc.severity || 'INFO').toUpperCase()}</span>
                    </div>
                    <div class="incident-details" style="font-size:0.82rem;">
                        <span class="incident-location">📍 ${inc.location || 'Campus Zone'}</span>
                        <span class="incident-time">${inc.created_at}</span>
                        <span>• Confidence: <strong>${Math.round((inc.confidence_score || 0.85) * 100)}%</strong></span>
                    </div>
                    ${inc.evidence_file ? `
                    <div class="incident-evidence" style="margin-top:0.5rem;">
                        <img src="/${inc.evidence_file}" alt="Evidence" class="evidence-image" onclick="showEvidence(this)" style="max-height:90px; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1;">
                    </div>` : ''}
                </div>
            `).join('');

            const todayEl = document.getElementById('todayIncidentsCount');
            if (todayEl) todayEl.textContent = incidents.length;
        } catch (e) {
            console.debug('Recent incidents fetch:', e);
        }
    }

    async handleAddCamera() {
        const form = document.getElementById('cameraForm');
        const formData = new FormData(form);

        const cameraData = {
            name: formData.get('name'),
            location: formData.get('location'),
            source_type: formData.get('source_type') || 'webcam',
            device_id: 0,
            stream_url: formData.get('stream_url') || '',
            models: ['normal', 'fight', 'sleep', 'suspicious'],
            incident_delay: 5,
            confidence_threshold: 0.75
        };

        if (!cameraData.name || !cameraData.location) {
            this.showNotification('Please fill in required fields', 'error');
            return;
        }

        try {
            const resp = await fetch('/api/cameras', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cameraData)
            });
            const res = await resp.json();

            if (res.success) {
                this.showNotification('Camera added successfully', 'success');
                this.closeModals();
                location.reload();
            } else {
                this.showNotification(res.message || 'Failed to add camera', 'error');
            }
        } catch (err) {
            this.showNotification('Error saving camera: ' + err.message, 'error');
        }
    }

    playAlertSound() {
        try {
            const audio = new Audio('/static/audio/alert.mp3');
            audio.play().catch(() => {});
        } catch (e) {}
    }

    closeModals() {
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    }

    setupNotifications() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    showNotification(message, type = 'info') {
        const container = document.querySelector('.flash-messages') || this.createFlashContainer();
        const notification = document.createElement('div');
        notification.className = `flash-message ${type}`;
        notification.textContent = message;
        container.appendChild(notification);
        setTimeout(() => notification.remove(), 4500);
    }

    createFlashContainer() {
        const container = document.createElement('div');
        container.className = 'flash-messages';
        document.body.appendChild(container);
        return container;
    }
}

// Global modal preview helper
window.showEvidence = function(img) {
    const modal = document.getElementById('evidenceModal');
    const modalImg = document.getElementById('evidenceImage');
    if (modal && modalImg) {
        modalImg.src = img.src;
        modal.style.display = 'block';
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardManager = new DashboardManager();
});
