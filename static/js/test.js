class TestManager {
    constructor() {
        this.activeModels = new Set(['normal']);
        this.uploadActiveModels = new Set(['fight', 'sleep', 'suspicious', 'normal']);
        this.confidenceThresholds = {
            fight: 0.85,
            sleep: 0.80,
            suspicious: 0.90,
            normal: 0.75
        };
        this.isTesting = false;
        this.currentCameraId = null;
        this.testInterval = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.updateActiveModelsDisplay();
        this.setupUploadModelControls();
    }

    bindEvents() {
        // Model toggles
        document.querySelectorAll('input[type="checkbox"][data-model]').forEach(toggle => {
            toggle.addEventListener('change', (e) => this.toggleModel(e.target));
        });

        // Confidence sliders
        document.querySelectorAll('.confidence-slider').forEach(slider => {
            slider.addEventListener('input', (e) => this.updateConfidence(e.target));
        });

        // Camera selection
        document.getElementById('cameraSelect').addEventListener('change', (e) => {
            this.currentCameraId = e.target.value;
        });

        // Camera test controls
        document.getElementById('startCameraTest').addEventListener('click', () => this.startCameraTest());
        document.getElementById('stopCameraTest').addEventListener('click', () => this.stopCameraTest());

        // File upload (keep existing functionality)
        this.setupFileUpload();
    }

    setupUploadModelControls() {
        // Upload model checkboxes
        document.querySelectorAll('.upload-model-option input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => this.toggleUploadModel(e.target));
        });

        // Select all / deselect all buttons
        document.getElementById('selectAllModels').addEventListener('click', () => this.selectAllUploadModels());
        document.getElementById('deselectAllModels').addEventListener('click', () => this.deselectAllUploadModels());

        // Initialize upload model display
        this.updateUploadModelsDisplay();
    }

    toggleUploadModel(checkbox) {
        const model = checkbox.dataset.model;
        
        if (checkbox.checked) {
            this.uploadActiveModels.add(model);
        } else {
            this.uploadActiveModels.delete(model);
        }
        
        this.updateUploadModelsDisplay();
    }

    selectAllUploadModels() {
        document.querySelectorAll('.upload-model-option input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = true;
            this.uploadActiveModels.add(checkbox.dataset.model);
        });
        this.updateUploadModelsDisplay();
    }

    deselectAllUploadModels() {
        document.querySelectorAll('.upload-model-option input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
            this.uploadActiveModels.delete(checkbox.dataset.model);
        });
        this.updateUploadModelsDisplay();
    }

    updateUploadModelsDisplay() {
        const selectedCount = this.uploadActiveModels.size;
        const processBtn = document.getElementById('processBtn');
        
        if (selectedCount > 0) {
            processBtn.textContent = `Process Detection with ${selectedCount} Model${selectedCount > 1 ? 's' : ''}`;
        } else {
            processBtn.textContent = 'Process Detection with Selected Models';
        }
    }

    toggleModel(checkbox) {
        const model = checkbox.dataset.model;
        
        if (checkbox.checked) {
            this.activeModels.add(model);
        } else {
            this.activeModels.delete(model);
        }
        
        this.updateActiveModelsDisplay();
        
        // Update camera monitors if testing
        if (this.isTesting && this.currentCameraId) {
            this.updateCameraMonitors();
        }
    }

    updateConfidence(slider) {
        const model = slider.id.replace('ConfidenceSlider', '');
        const value = parseInt(slider.value);
        
        this.confidenceThresholds[model] = value / 100;
        document.getElementById(`${model}Confidence`).textContent = `${value}%`;
        
        // Update camera monitors if testing
        if (this.isTesting && this.currentCameraId) {
            this.updateCameraMonitors();
        }
    }

    updateActiveModelsDisplay() {
        const activeModelsElement = document.getElementById('activeModels');
        if (this.activeModels.size > 0) {
            activeModelsElement.textContent = Array.from(this.activeModels).join(', ');
        } else {
            activeModelsElement.textContent = 'None';
        }
    }

    async startCameraTest() {
        if (!this.currentCameraId) {
            alert('Please select a camera first.');
            return;
        }

        if (this.activeModels.size === 0) {
            alert('Please enable at least one model.');
            return;
        }

        try {
            // Update camera monitors first
            await this.updateCameraMonitors();

            // Start monitoring
            const response = await fetch('/api/start_monitoring', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    camera_id: parseInt(this.currentCameraId)
                })
            });

            const data = await response.json();

            if (data.success) {
                this.isTesting = true;
                this.updateTestUI(true);
                this.startTestUpdates();
                this.showNotification('Camera test started successfully', 'success');
            } else {
                this.showNotification('Failed to start test: ' + data.message, 'error');
            }
        } catch (error) {
            this.showNotification('Error starting test: ' + error.message, 'error');
        }
    }

    async stopCameraTest() {
        try {
            const response = await fetch('/api/stop_monitoring', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    camera_id: parseInt(this.currentCameraId)
                })
            });

            const data = await response.json();

            if (data.success) {
                this.isTesting = false;
                this.updateTestUI(false);
                this.stopTestUpdates();
                this.showNotification('Camera test stopped', 'info');
            } else {
                this.showNotification('Failed to stop test', 'error');
            }
        } catch (error) {
            this.showNotification('Error stopping test: ' + error.message, 'error');
        }
    }

    async updateCameraMonitors() {
        if (!this.currentCameraId) return;

        const updates = Array.from(this.activeModels).map(model => ({
            model_type: model,
            is_active: true,
            confidence_threshold: this.confidenceThresholds[model]
        }));

        // Also deactivate models not in active set
        const allModels = ['fight', 'sleep', 'suspicious', 'normal'];
        allModels.forEach(model => {
            if (!this.activeModels.has(model)) {
                updates.push({
                    model_type: model,
                    is_active: false,
                    confidence_threshold: this.confidenceThresholds[model]
                });
            }
        });

        for (const update of updates) {
            try {
                await fetch(`/api/camera_monitors/${this.currentCameraId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(update)
                });
            } catch (error) {
                console.error(`Failed to update ${update.model_type} monitor:`, error);
            }
        }
    }

    updateTestUI(isActive) {
        const startBtn = document.getElementById('startCameraTest');
        const stopBtn = document.getElementById('stopCameraTest');
        const testSection = document.getElementById('liveTestSection');
        const feedPlaceholder = document.getElementById('testFeedPlaceholder');
        const liveFeed = document.getElementById('testLiveFeed');

        if (isActive) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            testSection.style.display = 'block';
            feedPlaceholder.style.display = 'none';
            liveFeed.style.display = 'block';
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
            feedPlaceholder.style.display = 'flex';
            liveFeed.style.display = 'none';
        }
    }

    startTestUpdates() {
        this.testInterval = setInterval(() => {
            this.fetchTestData();
        }, 1000);
    }

    stopTestUpdates() {
        if (this.testInterval) {
            clearInterval(this.testInterval);
            this.testInterval = null;
        }
    }

    async fetchTestData() {
        try {
            const response = await fetch('/api/detection_data');
            const data = await response.json();

            if (data.camera_id == this.currentCameraId) {
                this.updateTestFeed(data);
                this.updateTestStats(data);
                this.checkTestAnomalies(data);
            }
        } catch (error) {
            console.error('Error fetching test data:', error);
        }
    }

    updateTestFeed(data) {
        const liveFeed = document.getElementById('testLiveFeed');
        
        if (data.frame_base64) {
            liveFeed.src = 'data:image/jpeg;base64,' + data.frame_base64;
        }
    }

    updateTestStats(data) {
        document.getElementById('testDetections').textContent = data.total_objects || 0;
        document.getElementById('testFPS').textContent = data.fps || 0;
    }

    checkTestAnomalies(data) {
        const anomalyAlerts = document.getElementById('testAnomalyAlerts');
        const anomalyList = document.getElementById('testAnomalyList');
        
        if (data.anomalies && data.anomalies.length > 0) {
            anomalyAlerts.style.display = 'block';
            anomalyList.innerHTML = '';
            
            data.anomalies.forEach(anomaly => {
                const alertItem = document.createElement('div');
                alertItem.className = 'anomaly-alert';
                alertItem.innerHTML = `
                    <strong>${anomaly.type.toUpperCase()}</strong>: ${anomaly.message}
                    <span class="confidence">(${Math.round(anomaly.confidence * 100)}%)</span>
                `;
                anomalyList.appendChild(alertItem);
            });
        } else {
            anomalyAlerts.style.display = 'none';
        }
    }

    setupFileUpload() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        
        // Click to upload
        uploadArea.addEventListener('click', function() {
            fileInput.click();
        });
        
        // Drag and drop
        uploadArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', function() {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                window.handleFileSelection(files[0]);
            }
        });
        
        // File input change
        fileInput.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                window.handleFileSelection(e.target.files[0]);
            }
        });
    }

    showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `flash-message ${type}`;
        notification.textContent = message;
        
        let container = document.querySelector('.flash-messages');
        if (!container) {
            container = document.createElement('div');
            container.className = 'flash-messages';
            document.body.appendChild(container);
        }
        
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Global functions for file handling
let currentFile = null;

function handleFileSelection(file) {
    const validImageTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    const validVideoTypes = ['video/mp4', 'video/avi', 'video/mov'];
    
    if (!validImageTypes.includes(file.type) && !validVideoTypes.includes(file.type)) {
        alert('Please select a valid image (JPG, PNG) or video (MP4, AVI, MOV) file.');
        return;
    }
    
    if (file.size > 50 * 1024 * 1024) {
        alert('File size must be less than 50MB.');
        return;
    }
    
    currentFile = file;
    
    // Update upload area
    const uploadArea = document.getElementById('uploadArea');
    const uploadPlaceholder = uploadArea.querySelector('.upload-placeholder');
    uploadPlaceholder.innerHTML = `
        <div class="upload-icon">✅</div>
        <p>File selected: ${file.name}</p>
        <small>Size: ${(file.size / 1024 / 1024).toFixed(2)} MB</small>
    `;
    
    // Enable process button
    document.getElementById('processBtn').disabled = false;
    
    // Preview original file
    previewOriginalFile(file);
}

function previewOriginalFile(file) {
    const originalImage = document.getElementById('originalImage');
    const originalVideo = document.getElementById('originalVideo');
    
    if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        originalImage.src = url;
        originalImage.style.display = 'block';
        originalVideo.style.display = 'none';
    } else if (file.type.startsWith('video/')) {
        const url = URL.createObjectURL(file);
        originalVideo.src = url;
        originalVideo.style.display = 'block';
        originalImage.style.display = 'none';
    }
}

async function processUpload() {
    if (!currentFile) {
        alert('Please select a file first.');
        return;
    }

    if (window.testManager.uploadActiveModels.size === 0) {
        alert('Please select at least one model to test.');
        return;
    }

    const processBtn = document.getElementById('processBtn');
    const originalText = processBtn.textContent;
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';

    showLoadingIndicator();

    const formData = new FormData();
    formData.append('file', currentFile);
    
    // Add selected models to form data
    formData.append('models', JSON.stringify(Array.from(window.testManager.uploadActiveModels)));

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000);

        const response = await fetch('/api/upload_test', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();

        if (data.success) {
            displayResults(data);
            // If an incident was created on the server, try to refresh the recent incidents
            // in the dashboard or incidents area so the new item appears without a reload.
            try {
                if (data.incident_created) {
                    // Prefer the global dashboard manager if available
                    if (window.dashboardManager && typeof window.dashboardManager.updateRecentIncidents === 'function') {
                        window.dashboardManager.updateRecentIncidents();
                    } else {
                        // Fallback: fetch recent incidents and update any .incidents-list on the current page
                        const incidentsList = document.querySelector('.incidents-list');
                        if (incidentsList) {
                            fetch('/api/recent_incidents')
                                .then(r => r.json())
                                .then(incidents => {
                                    if (!incidents || incidents.length === 0) return;
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
                                }).catch(err => console.error('Failed to refresh incidents:', err));
                        }
                    }
                }
            } catch (err) {
                console.error('Error attempting to refresh recent incidents:', err);
            }
        } else {
            alert('Processing failed: ' + data.message);
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            alert('Processing timed out. Please try a shorter video or check your file size.');
        } else {
            alert('Error processing file: ' + error.message);
        }
    } finally {
        processBtn.disabled = false;
        processBtn.textContent = originalText;
        hideLoadingIndicator();
    }
}

function showLoadingIndicator() {
    let loadingDiv = document.getElementById('loadingIndicator');
    if (!loadingDiv) {
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'loadingIndicator';
        loadingDiv.innerHTML = `
            <div class="loading-content">
                <div style="font-size: 2rem; margin-bottom: 1rem;">⏳</div>
                <h3>Processing ${currentFile.type.startsWith('video/') ? 'Video' : 'Image'}...</h3>
                <p>This may take a while for larger files</p>
                <div class="spinner"></div>
            </div>
        `;
        document.body.appendChild(loadingDiv);
    }
    loadingDiv.style.display = 'flex';
}

function hideLoadingIndicator() {
    const loadingDiv = document.getElementById('loadingIndicator');
    if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
}

function displayResults(data) {
    document.getElementById('resultsSection').style.display = 'block';
    
    const resultImage = document.getElementById('resultImage');
    const resultVideo = document.getElementById('resultVideo');
    
    if (data.file_type === 'video') {
        resultVideo.src = '/get_result_file/' + data.result_file;
        resultVideo.style.display = 'block';
        resultImage.style.display = 'none';
    } else {
        resultImage.src = '/get_result_file/' + data.result_file;
        resultImage.style.display = 'block';
        resultVideo.style.display = 'none';
    }
    
    // Update statistics
    document.getElementById('totalDetections').textContent = data.total_detections;
    
    const studentsDetected = data.detections.filter(d => d.class === 'person').length;
    document.getElementById('studentsDetected').textContent = studentsDetected;
    
    const avgConfidence = data.detections.length > 0 
        ? (data.detections.reduce((sum, d) => sum + d.confidence, 0) / data.detections.length * 100).toFixed(1)
        : 0;
    document.getElementById('avgConfidence').textContent = avgConfidence + '%';
    
    document.getElementById('processingDevice').textContent = data.device_used || 'CPU';
    document.getElementById('processingTime').textContent = data.processing_time + 's';
    
    // Show which models were used
    if (data.models_used) {
        const modelsUsedElement = document.createElement('div');
        modelsUsedElement.className = 'models-used-info';
        modelsUsedElement.innerHTML = `<strong>Models Used:</strong> ${data.models_used.join(', ')}`;
        document.querySelector('.detection-stats').appendChild(modelsUsedElement);
    }
    
    const tableBody = document.getElementById('detectionsTable');
    tableBody.innerHTML = data.detections.map(detection => `
        <tr>
            <td>${detection.class}</td>
            <td>${(detection.confidence * 100).toFixed(1)}%</td>
            <td>[${detection.bbox ? detection.bbox.map(coord => coord.toFixed(1)).join(', ') : 'N/A'}]</td>
        </tr>
    `).join('');
    
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

function showEvidence(img) {
    const modal = document.getElementById('evidenceModal');
    const evidenceImage = document.getElementById('evidenceImage');
    
    evidenceImage.src = img.src;
    modal.style.display = 'block';
}

// Close modals when clicking outside or on close button
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this || e.target.classList.contains('close')) {
                this.style.display = 'none';
            }
        });
    });
});

// Initialize test manager
document.addEventListener('DOMContentLoaded', function() {
    window.testManager = new TestManager();
});