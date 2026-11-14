class DashboardManager {
    constructor() {
        this.isMonitoring = false;
        this.detectionInterval = null;
        this.currentCameraId = null;
        this.selectedFile = null;
        this.localStream = null;
        this.webcamFrameInterval = null;
        this.isProcessingWebcamFrame = false;
        this.currentMode = 'live';
        this.init();
    }

    async init() {
        this.bindEvents();
        this.bindModeTabs();
        this.bindCameraToggle();
        this.bindQuickTest();
        this.setupNotifications();

        const badge = document.getElementById('hubLiveBadge');
        if (badge) badge.style.display = 'none';
        
        // Auto-poll recent incidents periodically
        try {
            this.updateRecentIncidents();
            setInterval(() => this.updateRecentIncidents(), 8000);
        } catch (err) {
            console.debug('Incidents polling init:', err);
        }
    }

    bindModeTabs() {
        const tabLive = document.getElementById('tabLiveMode');
        const tabUpload = document.getElementById('tabUploadMode');
        const liveWrap = document.getElementById('liveViewportWrap');
        const uploadWrap = document.getElementById('uploadViewportWrap');
        const cameraBtn = document.getElementById('cameraToggleBtn');
        const analyzeBtn = document.getElementById('quickAnalyzeBtn');
        const liveControls = document.getElementById('liveControlsGroup');
        const uploadControls = document.getElementById('uploadControlsGroup');
        const dossierCard = document.getElementById('quickResultCard');

        if (tabLive && tabUpload) {
            tabLive.addEventListener('click', () => {
                this.currentMode = 'live';
                tabLive.classList.add('active');
                tabUpload.classList.remove('active');
                if (liveWrap) liveWrap.style.display = 'flex';
                if (uploadWrap) uploadWrap.style.display = 'none';
                if (cameraBtn) cameraBtn.style.display = 'inline-flex';
                if (analyzeBtn) analyzeBtn.style.display = 'none';
                if (liveControls) liveControls.style.display = 'flex';
                if (uploadControls) uploadControls.style.display = 'none';
                if (dossierCard) dossierCard.style.display = this.isMonitoring ? 'block' : 'none';
            });

            tabUpload.addEventListener('click', () => {
                this.currentMode = 'upload';
                tabUpload.classList.add('active');
                tabLive.classList.remove('active');
                if (liveWrap) liveWrap.style.display = 'none';
                if (uploadWrap) uploadWrap.style.display = 'block';
                if (cameraBtn) cameraBtn.style.display = 'none';
                if (analyzeBtn) analyzeBtn.style.display = 'inline-flex';
                if (liveControls) liveControls.style.display = 'none';
                if (uploadControls) uploadControls.style.display = 'flex';
                const resultContainer = document.getElementById('uploadResultImgContainer');
                if (dossierCard) {
                    dossierCard.style.display = (resultContainer && resultContainer.style.display !== 'none' && this.selectedFile) ? 'block' : 'none';
                }
            });
        }

        const changeFileBtn = document.getElementById('uploadChangeFileBtn');
        if (changeFileBtn) {
            changeFileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectedFile = null;
                const dropzone = document.getElementById('quickDropzone');
                const resultContainer = document.getElementById('uploadResultImgContainer');
                const fileInput = document.getElementById('quickFileInput');
                const dropText = document.getElementById('quickDropText');
                const fileDisplay = document.getElementById('uploadFileNameDisplay');
                const analyzeBtn = document.getElementById('quickAnalyzeBtn');

                if (dropzone) dropzone.style.display = 'flex';
                if (resultContainer) resultContainer.style.display = 'none';
                if (dossierCard) dossierCard.style.display = 'none';
                if (dropText) dropText.textContent = 'Click or Drag Demo Media Here';
                if (fileDisplay) fileDisplay.textContent = 'None (Click canvas to select)';
                if (analyzeBtn) analyzeBtn.disabled = true;
                if (fileInput) {
                    fileInput.value = '';
                    fileInput.click();
                }
            });
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
                    let camId = cameraSelect ? cameraSelect.value : 'browser';
                    await this.startCamera(camId);
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
        // Mode A: Direct Browser Webcam (Instant, 60fps, Zero device index hassle)
        if (cameraId === 'browser') {
            await this.startBrowserWebcam();
            return;
        }

        // Mode B: Server-side Hardware Camera (OpenCV DirectShow/USB)
        try {
            this.showNotification('Connecting to hardware camera...', 'info');
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
                const browserVideo = document.getElementById('hubBrowserVideo');
                const badge = document.getElementById('hubLiveBadge');
                const badgeText = document.getElementById('hubLiveBadgeText');
                const toggleBtn = document.getElementById('cameraToggleBtn');
                const toggleText = document.getElementById('cameraToggleText');

                if (placeholder) placeholder.style.display = 'none';
                if (browserVideo) {
                    browserVideo.style.display = 'none';
                    if (this.localStream) {
                        this.localStream.getTracks().forEach(t => t.stop());
                        this.localStream = null;
                    }
                }
                if (liveImg) liveImg.style.display = 'block';
                if (badge) badge.style.display = 'flex';
                if (badgeText) badgeText.textContent = 'LIVE • CCTV / HARDWARE STREAM';
                
                if (toggleBtn) {
                    toggleBtn.className = 'btn btn-danger btn-small';
                    toggleBtn.style.padding = '0.5rem 1.25rem';
                }
                if (toggleText) toggleText.textContent = 'Stop Camera';

                this.showNotification('Hardware camera active! AI neural inspection running.', 'success');
                this.startDetectionUpdates();
            } else {
                this.showNotification(res.message || 'Could not start hardware camera. Switching to Browser Webcam fallback...', 'error');
                // Automatic graceful fallback to browser webcam
                const cameraSelect = document.getElementById('hubCameraSelect');
                if (cameraSelect) cameraSelect.value = 'browser';
                await this.startBrowserWebcam();
            }
        } catch (err) {
            this.showNotification('Hardware connection error: ' + err.message + '. Trying Browser Webcam...', 'error');
            const cameraSelect = document.getElementById('hubCameraSelect');
            if (cameraSelect) cameraSelect.value = 'browser';
            await this.startBrowserWebcam();
        }
    }

    async startBrowserWebcam() {
        try {
            this.showNotification('Requesting webcam access...', 'info');
            
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Webcam API is not supported in this browser. Please use Chrome/Edge.');
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
                audio: false
            });

            this.localStream = stream;
            this.isMonitoring = true;
            this.currentCameraId = 'browser';

            const placeholder = document.getElementById('hubPlaceholder');
            const liveImg = document.getElementById('hubLiveFeedImg');
            const browserVideo = document.getElementById('hubBrowserVideo');
            const badge = document.getElementById('hubLiveBadge');
            const badgeText = document.getElementById('hubLiveBadgeText');
            const toggleBtn = document.getElementById('cameraToggleBtn');
            const toggleText = document.getElementById('cameraToggleText');

            if (placeholder) placeholder.style.display = 'none';
            if (liveImg) liveImg.style.display = 'none';
            
            if (browserVideo) {
                browserVideo.srcObject = stream;
                browserVideo.style.display = 'block';
                await browserVideo.play().catch(() => {});
            }

            if (badge) badge.style.display = 'flex';
            if (badgeText) badgeText.textContent = 'LIVE • BROWSER WEBCAM (FACE FEED)';

            if (toggleBtn) {
                toggleBtn.className = 'btn btn-danger btn-small';
                toggleBtn.style.padding = '0.5rem 1.25rem';
            }
            if (toggleText) toggleText.textContent = 'Stop Camera';

            this.showNotification('Webcam opened! AI Surveillance & face detection active.', 'success');
            
            // Start real-time AI frame processing from browser video
            this.startBrowserWebcamProcessing();

        } catch (err) {
            console.error('Browser webcam error:', err);
            const isPermDenied = err.name === 'NotAllowedError' || (err.message && (err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied')));
            
            const placeholder = document.getElementById('hubPlaceholder');
            if (placeholder && isPermDenied) {
                placeholder.innerHTML = `
                    <div style="font-size: 2.2rem; margin-bottom: 0.35rem;">🔒</div>
                    <p style="font-weight: 700; color: #f87171; font-size: 1.05rem; margin-bottom: 0.35rem;">Webcam Permission Blocked</p>
                    <p style="font-size: 0.8rem; color: #cbd5e1; max-width: 440px; margin: 0 auto 0.85rem; line-height: 1.45;">
                        Your browser or Windows has blocked camera access.<br>
                        Click the <strong>padlock / sliders icon (🔒 / 🎛️)</strong> on the far left of your address bar (next to <code>localhost:5000</code>), set <strong>Camera</strong> to <strong>Allow</strong>, and refresh.
                    </p>
                    <div style="display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap;">
                        <button type="button" class="btn btn-primary btn-small" onclick="window.dashboardManager.startCamera('browser')" style="padding: 0.45rem 0.95rem; font-size: 0.78rem;">
                            🔄 Retry Browser Camera
                        </button>
                        <button type="button" class="btn btn-secondary btn-small" onclick="window.dashboardManager.switchToHardwareCamera()" style="padding: 0.45rem 0.95rem; font-size: 0.78rem; background: #1e293b; color: #38bdf8; border: 1px solid #334155;">
                            📹 Try Hardware Camera (OpenCV)
                        </button>
                    </div>
                `;
                placeholder.style.display = 'block';
            }

            this.showNotification('Camera access blocked: Click the lock icon in your address bar and set Camera to Allow.', 'error');
            await this.stopCamera(false);
        }
    }

    switchToHardwareCamera() {
        const select = document.getElementById('hubCameraSelect');
        if (select) {
            // Find first hardware camera (ID > 0)
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value !== 'browser') {
                    select.selectedIndex = i;
                    this.startCamera(select.options[i].value);
                    return;
                }
            }
        }
        this.startCamera(1);
    }

    startBrowserWebcamProcessing() {
        if (this.webcamFrameInterval) clearInterval(this.webcamFrameInterval);

        const canvas = document.getElementById('hubWebcamCanvas') || document.createElement('canvas');
        canvas.id = 'hubWebcamCanvas';
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        const video = document.getElementById('hubBrowserVideo');
        const liveImg = document.getElementById('hubLiveFeedImg');

        let lastTime = performance.now();
        let frameCounter = 0;

        this.webcamFrameInterval = setInterval(async () => {
            if (!this.isMonitoring || this.currentCameraId !== 'browser' || !video || video.paused || video.ended) return;
            if (this.isProcessingWebcamFrame) return;

            try {
                this.isProcessingWebcamFrame = true;
                ctx.drawImage(video, 0, 0, 640, 480);
                const b64Data = canvas.toDataURL('image/jpeg', 0.65);

                const startTime = performance.now();
                const resp = await fetch('/api/process_webcam_frame', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: b64Data })
                });

                if (resp.ok) {
                    const data = await resp.json();
                    const now = performance.now();
                    const fps = Math.round(1000 / (now - lastTime));
                    lastTime = now;
                    frameCounter++;

                    // If annotated AI frame is returned with bounding boxes, display it smoothly
                    if (data.frame_base64 && liveImg) {
                        const placeholder = document.getElementById('hubPlaceholder');
                        if (placeholder) placeholder.style.display = 'none';
                        liveImg.src = 'data:image/jpeg;base64,' + data.frame_base64;
                        liveImg.style.display = 'block';
                        video.style.display = 'none'; // Show AI annotated frame
                    }

                    // Update real-time counters
                    const detCount = document.getElementById('hubDetections');
                    const fpsCount = document.getElementById('hubFPS');
                    const anomCount = document.getElementById('hubAnomalies');

                    if (detCount) detCount.textContent = (data.detection_data ? data.detection_data.length : data.total_objects) || 0;
                    if (fpsCount) fpsCount.textContent = fps;
                    if (anomCount) anomCount.textContent = (data.anomalies && data.anomalies.length) ? data.anomalies.length : 0;

                    // Update live AI forensic report dossier
                    this.updateLiveDossier(data, fps);

                    // Sound alarm if anomaly detected
                    if (data.anomalies && data.anomalies.length > 0) {
                        this.playAlertSound();
                    }
                }
            } catch (e) {
                console.debug('Browser frame process error:', e);
            } finally {
                this.isProcessingWebcamFrame = false;
            }
        }, 220); // ~4.5 AI inferences/sec
    }

    async stopCamera(resetPlaceholder = true) {
        // Stop browser local webcam if active
        if (this.localStream) {
            try {
                this.localStream.getTracks().forEach(track => track.stop());
            } catch (e) {}
            this.localStream = null;
        }

        if (this.webcamFrameInterval) {
            clearInterval(this.webcamFrameInterval);
            this.webcamFrameInterval = null;
        }

        const browserVideo = document.getElementById('hubBrowserVideo');
        if (browserVideo) {
            browserVideo.pause();
            browserVideo.srcObject = null;
            browserVideo.style.display = 'none';
        }

        // Stop server-side stream if it was running
        if (this.currentCameraId && this.currentCameraId !== 'browser') {
            try {
                await fetch('/api/stop_monitoring', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ camera_id: parseInt(this.currentCameraId) })
                });
            } catch (e) {
                console.debug('Stop camera error:', e);
            }
        }

        this.isMonitoring = false;
        this.stopDetectionUpdates();

        const placeholder = document.getElementById('hubPlaceholder');
        const liveImg = document.getElementById('hubLiveFeedImg');
        const badge = document.getElementById('hubLiveBadge');
        const toggleBtn = document.getElementById('cameraToggleBtn');
        const toggleText = document.getElementById('cameraToggleText');

        if (placeholder) {
            if (resetPlaceholder) {
                placeholder.innerHTML = `
                    <div style="font-size: 2.5rem; margin-bottom: 0.35rem; opacity: 0.8;">📹</div>
                    <p style="font-weight: 700; color: #f1f5f9; font-size: 1.05rem; margin-bottom: 0.25rem;">Camera is Offline</p>
                    <p style="font-size: 0.82rem; color: #94a3b8; margin: 0;">Click "Start Camera" above to see your face and live surveillance</p>
                `;
            }
            placeholder.style.display = 'block';
        }

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

        // Reset stats
        const detCount = document.getElementById('hubDetections');
        const fpsCount = document.getElementById('hubFPS');
        const anomCount = document.getElementById('hubAnomalies');
        if (detCount) detCount.textContent = '0';
        if (fpsCount) fpsCount.textContent = '0';
        if (anomCount) anomCount.textContent = '0';

        const dossierCard = document.getElementById('quickResultCard');
        if (dossierCard && this.currentMode === 'live') {
            dossierCard.style.display = 'none';
        }

        this.showNotification('Camera stopped.', 'info');
    }

    updateLiveDossier(data, fps = 24) {
        if (this.currentMode !== 'live') return;
        const card = document.getElementById('quickResultCard');
        if (!card) return;

        // Show dossier card below live viewport
        card.style.display = 'block';

        const badge = document.getElementById('quickIncidentBadge');
        const statusIcon = document.getElementById('quickStatusIcon');
        const titleEl = document.getElementById('quickResultTitle');
        const subtitleEl = document.getElementById('quickEngineSubtitle');
        const anomalyTypeEl = document.getElementById('quickAnomalyType');
        const confValEl = document.getElementById('quickConfidenceVal');
        const confBarEl = document.getElementById('quickConfidenceBar');
        const personsEl = document.getElementById('quickPersonsCount');
        const latencyEl = document.getElementById('quickLatencyVal');

        if (titleEl) titleEl.textContent = 'Live Surveillance AI Report';
        if (subtitleEl) subtitleEl.textContent = 'Real-Time YOLOv11 Neural Core • Active Inspection';

        const personsCount = data.students_detected !== undefined ? data.students_detected : 
            (data.detection_data ? data.detection_data.filter(d => d.class === 'person').length : 0);
        if (personsEl) personsEl.textContent = `${personsCount} Person${personsCount === 1 ? '' : 's'}`;
        if (latencyEl) latencyEl.textContent = `${fps} FPS • Real-time`;

        const hasAnomaly = data.anomalies && data.anomalies.length > 0;

        if (hasAnomaly) {
            const anom = data.anomalies[0];
            const rawType = anom.type || 'Altercation';
            let threatLabel = 'Physical Altercation (Fight)';
            if (rawType.includes('sleep') || rawType.includes('collapse')) threatLabel = 'Medical Alert (Sleep / Collapse)';
            else if (rawType.includes('phone')) threatLabel = 'Unauthorized Phone Detected';
            else if (rawType.includes('loiter')) threatLabel = 'Unauthorized Loitering';
            else threatLabel = rawType.replace(/_/g, ' ').toUpperCase();

            const conf = Math.round((anom.confidence || 0.88) * 100);

            if (anomalyTypeEl) anomalyTypeEl.textContent = threatLabel;
            if (confValEl) confValEl.textContent = `${conf}%`;
            if (confBarEl) {
                confBarEl.style.width = `${conf}%`;
                confBarEl.style.background = '#dc2626';
            }

            if (badge) {
                badge.textContent = '🚨 THREAT CONFIRMED';
                badge.style.background = '#fef2f2';
                badge.style.color = '#dc2626';
                badge.style.border = '1px solid #fecaca';
            }
            if (statusIcon) statusIcon.textContent = '🚨';
            card.style.borderColor = '#f87171';
            card.style.boxShadow = '0 10px 28px -4px rgba(220, 38, 38, 0.25)';

            // Instantly refresh the Security Alert Stream on right side!
            this.updateRecentIncidents();
        } else {
            // Normal live surveillance state
            let maxConf = 0;
            if (data.detection_data && data.detection_data.length > 0) {
                maxConf = Math.max(...data.detection_data.map(d => d.confidence || 0));
            } else if (personsCount > 0) {
                maxConf = 0.82;
            }
            const conf = maxConf > 0 ? Math.round(maxConf * 100) : 98;

            let statusLabel = 'Zone Secure • No Threats';
            if (personsCount > 0) {
                statusLabel = `Active Monitoring (${personsCount} Person${personsCount === 1 ? '' : 's'} Verified)`;
            }

            if (anomalyTypeEl) anomalyTypeEl.textContent = statusLabel;
            if (confValEl) confValEl.textContent = `${conf}%`;
            if (confBarEl) {
                confBarEl.style.width = `${conf}%`;
                confBarEl.style.background = '#059669';
            }

            if (badge) {
                badge.textContent = '✓ ACTIVE SURVEILLANCE';
                badge.style.background = '#ecfdf5';
                badge.style.color = '#059669';
                badge.style.border = '1px solid #a7f3d0';
            }
            if (statusIcon) statusIcon.textContent = '🛡️';
            card.style.borderColor = '#cbd5e1';
            card.style.boxShadow = '0 4px 16px -2px rgba(0, 77, 64, 0.05)';
        }
    }

    startDetectionUpdates() {
        this.stopDetectionUpdates();
        this.detectionInterval = setInterval(() => this.fetchDetectionData(), 200);
        this.fetchDetectionData();
    }

    stopDetectionUpdates() {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
    }

    async fetchDetectionData() {
        if (!this.isMonitoring || this.currentCameraId === 'browser') return;
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

                // Update live AI forensic report dossier
                this.updateLiveDossier(data, Math.round(data.fps || 24));

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

        const handleFileSelect = (file) => {
            if (!file) return;
            this.selectedFile = file;
            if (dropText) dropText.textContent = `Selected: ${file.name}`;
            const fileDisplay = document.getElementById('uploadFileNameDisplay');
            if (fileDisplay) fileDisplay.textContent = file.name;
            dropzone.style.borderColor = '#00bfae';
            dropzone.style.background = 'rgba(0, 229, 206, 0.08)';
            analyzeBtn.disabled = false;

            // Instant local image preview right inside the 16:9 canvas
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = document.getElementById('quickResultImg');
                    const dropzoneEl = document.getElementById('quickDropzone');
                    const resultContainer = document.getElementById('uploadResultImgContainer');
                    const threatTag = document.getElementById('quickThreatTypeTag');
                    if (dropzoneEl) dropzoneEl.style.display = 'none';
                    if (resultContainer) resultContainer.style.display = 'flex';
                    if (img) {
                        img.src = ev.target.result;
                        img.style.display = 'block';
                    }
                    if (threatTag) {
                        threatTag.style.display = 'block';
                        threatTag.textContent = 'READY FOR AI INFERENCE';
                        threatTag.style.background = 'rgba(0, 125, 112, 0.9)';
                    }
                };
                reader.readAsDataURL(file);
            }
        };

        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleFileSelect(e.target.files[0]);
            }
        });

        // Drag and drop support
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#00e5ce';
            dropzone.style.background = 'rgba(0, 229, 206, 0.12)';
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = 'rgba(0, 229, 206, 0.45)';
            dropzone.style.background = 'rgba(0, 229, 206, 0.03)';
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFileSelect(e.dataTransfer.files[0]);
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
                    const dropzoneEl = document.getElementById('quickDropzone');
                    const resultContainer = document.getElementById('uploadResultImgContainer');
                    const badge = document.getElementById('quickIncidentBadge');
                    const statusIcon = document.getElementById('quickStatusIcon');
                    const threatTag = document.getElementById('quickThreatTypeTag');
                    const titleEl = document.getElementById('quickResultTitle');
                    const subtitleEl = document.getElementById('quickEngineSubtitle');
                    const anomalyTypeEl = document.getElementById('quickAnomalyType');
                    const confValEl = document.getElementById('quickConfidenceVal');
                    const confBarEl = document.getElementById('quickConfidenceBar');
                    const personsEl = document.getElementById('quickPersonsCount');
                    const latencyEl = document.getElementById('quickLatencyVal');

                    if (titleEl) titleEl.textContent = 'AI Forensic Detection Report';
                    if (subtitleEl) subtitleEl.textContent = 'YOLOv11 Neural Core • Verified Test Media';

                    // Render analyzed image with annotated boxes right inside the shared viewport
                    if (dropzoneEl) dropzoneEl.style.display = 'none';
                    if (resultContainer) resultContainer.style.display = 'flex';
                    if (img) {
                        if (result.image_base64) {
                            img.src = 'data:image/jpeg;base64,' + result.image_base64;
                        } else if (result.result_url) {
                            img.src = result.result_url;
                        } else if (result.result_file) {
                            img.src = '/' + result.result_file.replace(/^[/\\]+/, '');
                        }
                        img.style.display = 'block';
                    }
                    if (card) card.style.display = 'block';

                    // Update telemetry counters
                    const detCount = document.getElementById('hubDetections');
                    const fpsCount = document.getElementById('hubFPS');
                    const anomCount = document.getElementById('hubAnomalies');
                    if (detCount) detCount.textContent = result.total_detections || result.students_detected || 0;
                    if (fpsCount) fpsCount.textContent = Math.round(result.fps || 24);
                    if (anomCount) anomCount.textContent = result.incident_created ? 1 : 0;

                    // Calculate max confidence from detections or anomaly
                    let maxConf = 0.88;
                    if (result.anomaly && result.anomaly.confidence) {
                        maxConf = result.anomaly.confidence;
                    } else if (result.detections && result.detections.length > 0) {
                        maxConf = Math.max(...result.detections.map(d => d.confidence || 0));
                    }
                    const confPercent = Math.round(maxConf * 100);

                    // Determine threat classification
                    let threatLabel = 'Normal Activity';
                    if (result.incident_created || result.anomaly) {
                        const rawType = (result.anomaly && result.anomaly.type) || 'Potential Altercation';
                        if (rawType.toLowerCase().includes('fight') || rawType.toLowerCase().includes('altercation')) {
                            threatLabel = 'Physical Altercation (Fight)';
                        } else if (rawType.toLowerCase().includes('sleep') || rawType.toLowerCase().includes('collapse')) {
                            threatLabel = 'Medical Collapse / Unresponsive';
                        } else if (rawType.toLowerCase().includes('phone')) {
                            threatLabel = 'Unauthorized Phone Detected';
                        } else if (rawType.toLowerCase().includes('loiter')) {
                            threatLabel = 'Unauthorized Loitering';
                        } else {
                            threatLabel = rawType.replace(/_/g, ' ').toUpperCase();
                        }
                    } else if (result.students_detected > 0) {
                        threatLabel = `Campus Personnel (${result.students_detected} Detected)`;
                    }

                    if (anomalyTypeEl) anomalyTypeEl.textContent = threatLabel;
                    if (confValEl) confValEl.textContent = `${confPercent}%`;
                    if (confBarEl) {
                        confBarEl.style.width = `${confPercent}%`;
                        confBarEl.style.background = result.incident_created ? '#dc2626' : '#059669';
                    }
                    if (personsEl) personsEl.textContent = `${result.students_detected} Persons`;
                    if (latencyEl) latencyEl.textContent = `${result.processing_time}s (${result.fps || 22} FPS)`;

                    if (result.incident_created) {
                        if (badge) {
                            badge.textContent = '🚨 HIGH THREAT';
                            badge.style.background = '#fef2f2';
                            badge.style.color = '#dc2626';
                            badge.style.border = '1px solid #fecaca';
                        }
                        if (statusIcon) statusIcon.textContent = '🚨';
                        if (threatTag) {
                            threatTag.style.display = 'block';
                            threatTag.textContent = threatLabel.toUpperCase();
                            threatTag.style.background = 'rgba(220, 38, 38, 0.9)';
                        }
                        card.style.borderColor = '#f87171';
                        card.style.boxShadow = '0 10px 30px -5px rgba(220, 38, 38, 0.25)';

                        this.playAlertSound();
                        this.showNotification(`🚨 Security Alert: ${threatLabel} confirmed!`, 'error');
                    } else {
                        if (badge) {
                            badge.textContent = '✓ SYSTEM SECURE';
                            badge.style.background = '#ecfdf5';
                            badge.style.color = '#059669';
                            badge.style.border = '1px solid #a7f3d0';
                        }
                        if (statusIcon) statusIcon.textContent = '🛡️';
                        if (threatTag) {
                            threatTag.style.display = 'block';
                            threatTag.textContent = 'NO ANOMALIES DETECTED';
                            threatTag.style.background = 'rgba(5, 150, 105, 0.9)';
                        }
                        card.style.borderColor = '#6ee7b7';
                        card.style.boxShadow = '0 10px 30px -5px rgba(5, 150, 105, 0.15)';

                        this.showNotification('AI Analysis complete: No security breaches.', 'success');
                    }

                    // Refresh incidents list immediately so alert stream shows thumbnail
                    this.updateRecentIncidents();
                } else {
                    this.showNotification(result.message || 'Analysis failed', 'error');
                }
            } catch (err) {
                this.showNotification('Error running analysis: ' + err.message, 'error');
            } finally {
                analyzeBtn.disabled = false;
                analyzeBtn.innerHTML = '<span>⚡ Run AI Detection</span>';
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
                <div class="incident-card severity-${inc.severity}" style="padding: 1rem; border-radius: 10px; margin-bottom: 0.75rem; border-left: 4px solid ${inc.severity === 'critical' ? '#7c3aed' : inc.severity === 'high' ? '#dc2626' : '#d97706'}; background: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                    <div class="incident-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span class="incident-title" style="font-weight: 750; font-size: 0.95rem; color: #0f172a;">${inc.title}</span>
                        <span class="incident-severity ${inc.severity}" style="font-size: 0.7rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 999px;">${(inc.severity || 'HIGH').toUpperCase()}</span>
                    </div>
                    <div class="incident-details" style="font-size: 0.8rem; color: #64748b; margin-bottom: 8px;">
                        <span>📍 <strong>${inc.location || 'Campus Zone'}</strong></span>
                        <span style="margin: 0 6px;">•</span>
                        <span>🕒 ${inc.created_at}</span>
                        <span style="margin: 0 6px;">•</span>
                        <span>Confidence: <strong style="color: #007d70;">${Math.round((inc.confidence_score || 0.85) * 100)}%</strong></span>
                    </div>
                    ${(inc.has_frame_evidence || inc.evidence_url || inc.frame_evidence || inc.evidence_file) ? `
                    <div style="display: flex; align-items: center; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px;">
                        <div style="display: flex; align-items: center; gap: 8px; cursor: pointer;" onclick="showEvidence('${inc.evidence_url || `/api/incidents/evidence/${inc.id}`}', '${(inc.title || '').replace(/'/g, "\\'")}', '📍 ${(inc.location || 'Campus Zone').replace(/'/g, "\\'")} • ${inc.created_at}')">
                            <div style="width: 55px; height: 38px; border-radius: 6px; overflow: hidden; background: #0b151e; display: flex; align-items: center; justify-content: center; border: 1px solid #cbd5e1; flex-shrink: 0;">
                                <img src="${inc.evidence_url || `/api/incidents/evidence/${inc.id}`}" alt="Evidence" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                                <span style="display: none; font-size: 1.15rem;">${(inc.type || '').includes('phone') ? '📱' : ((inc.type || '').includes('fight') ? '🥊' : ((inc.type || '').includes('sleep') ? '💤' : '🚨'))}</span>
                            </div>
                            <span style="font-size: 0.76rem; color: #007d70; font-weight: 600;">🔍 View Photographic Evidence</span>
                        </div>
                        <a href="/guard_portal" class="btn btn-danger btn-small" style="font-size: 0.72rem; padding: 0.25rem 0.65rem;">🚨 Dispatch</a>
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
window.showEvidence = function(target, title, meta) {
    const modal = document.getElementById('evidenceModal');
    const modalImg = document.getElementById('evidenceImage');
    const fallbackBox = document.getElementById('evidenceFallbackDossier');
    const titleEl = document.getElementById('modalIncidentTitle');
    const metaEl = document.getElementById('modalMetaStats');
    const fallbackTitle = document.getElementById('fallbackTitle');
    const fallbackEmoji = document.getElementById('fallbackEmoji');

    if (modal && modalImg) {
        let src = (typeof target === 'string') ? target : (target ? target.src : '');
        if (src && !src.startsWith('data:') && !src.startsWith('http')) {
            if (src.startsWith('runs/') || src.startsWith('/runs/')) {
                src = '/' + src.replace(/^\/+/, '');
            } else if (!src.startsWith('/')) {
                src = '/' + src;
            }
        }

        if (title && titleEl) titleEl.textContent = title;
        if (title && fallbackTitle) fallbackTitle.textContent = title;
        if (meta && metaEl) metaEl.innerHTML = meta;

        const isPhone = (title || '').toLowerCase().includes('phone');
        const isFight = (title || '').toLowerCase().includes('fight');
        const isSleep = (title || '').toLowerCase().includes('sleep');
        if (fallbackEmoji) {
            fallbackEmoji.textContent = isPhone ? '📱' : (isFight ? '🥊' : (isSleep ? '💤' : '🚨'));
        }

        // Reset visibility state
        modalImg.style.display = 'block';
        if (fallbackBox) fallbackBox.style.display = 'none';

        modalImg.onload = function() {
            modalImg.style.display = 'block';
            if (fallbackBox) fallbackBox.style.display = 'none';
        };

        modalImg.onerror = function() {
            modalImg.style.display = 'none';
            if (fallbackBox) fallbackBox.style.display = 'block';
        };

        modalImg.src = src;
        modal.style.display = 'block';
    }
};

window.showEvidenceFromCurrent = function() {
    const manager = window.dashboardManager;
    if (manager && manager.currentMode === 'live') {
        const liveImg = document.getElementById('hubLiveFeedImg');
        const browserVideo = document.getElementById('hubBrowserVideo');
        if (liveImg && liveImg.style.display !== 'none' && liveImg.src) {
            window.showEvidence(liveImg.src, 'Live Surveillance Capture', '📍 Live Camera Feed • Verified Active Stream');
        } else if (browserVideo && browserVideo.srcObject) {
            const canvas = document.createElement('canvas');
            canvas.width = browserVideo.videoWidth || 640;
            canvas.height = browserVideo.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(browserVideo, 0, 0, canvas.width, canvas.height);
            window.showEvidence(canvas.toDataURL('image/jpeg'), 'Live Surveillance Snapshot', '📍 Direct Webcam Viewport Capture');
        } else {
            window.showEvidence(document.getElementById('quickResultImg'), 'AI Forensic Evidence', '📍 Monitored Media Snapshot');
        }
    } else {
        window.showEvidence(document.getElementById('quickResultImg'), 'AI Forensic Evidence', '📍 Uploaded Test Media Evidence');
    }
};

window.clearIncidentHistory = async function() {
    if (!confirm('Are you sure you want to clear the incident history?')) return;
    try {
        const resp = await fetch('/api/incidents/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const res = await resp.json();
        if (res.success) {
            const list = document.getElementById('dashboardIncidentsList');
            if (list) {
                list.innerHTML = `
                    <div class="empty-state" style="padding: 2.5rem 1rem; text-align: center; color: #64748b;">
                        <div class="empty-icon" style="font-size: 1.75rem;">✓</div>
                        <p style="font-size: 0.9rem;">No incidents recorded today. System is secure.</p>
                    </div>
                `;
            }
            const countEl = document.getElementById('todayIncidentsCount');
            if (countEl) countEl.textContent = '0';
            if (window.dashboardManager) {
                window.dashboardManager.showNotification('Incident history cleared successfully', 'info');
            }
        }
    } catch (e) {
        console.debug('Clear incidents error:', e);
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardManager = new DashboardManager();
});
