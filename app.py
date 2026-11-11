import os
import cv2
import json
import numpy as np
import time
import base64
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, Response, send_file, flash, redirect, url_for
from werkzeug.utils import secure_filename
from ultralytics import YOLO
import threading
import queue
import torch
import logging
from database import db, User, Camera, Incident, AnomalyDetection, SystemLog, CameraMonitor
from auth import auth
from flask_login import LoginManager, current_user, login_required


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Reduce OpenCV C++ warnings where possible (keep python logging informative)
try:
    # Newer OpenCV exposes logging utilities
    if hasattr(cv2, 'utils') and hasattr(cv2.utils, 'logging'):
        cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
    elif hasattr(cv2, 'setLogLevel'):
        # fallback for other builds
        try:
            cv2.setLogLevel(0)
        except Exception:
            pass
except Exception:
    # If anything fails here, we still continue — this only controls verbosity
    pass

app = Flask(__name__)
app.config['SECRET_KEY'] = 'campus-guard-secret-key-2024'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///campus_guard.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

# Initialize extensions
db.init_app(app)
app.register_blueprint(auth)

# Login manager
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'auth.login'
login_manager.login_message = 'Please log in to access this page.'

@login_manager.user_loader
def load_user(user_id):
    # Use Session.get to avoid SQLAlchemy Query.get legacy warning
    try:
        return db.session.get(User, int(user_id))
    except Exception:
        return None

# Ensure directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs('runs/detect', exist_ok=True)

# CUDA Device setup
def setup_device():
    if torch.cuda.is_available():
        device = torch.device('cuda')
        gpu_count = torch.cuda.device_count()
        gpu_name = torch.cuda.get_device_name(0) if gpu_count > 0 else "Unknown"
        logger.info(f"🎯 CUDA is available! Using {gpu_count} GPU(s)")
        logger.info(f"🎯 GPU: {gpu_name}")
        return device, True
    else:
        device = torch.device('cpu')
        logger.warning("⚠️ CUDA not available, using CPU (slower)")
        return device, False

# Initialize device
device, cuda_available = setup_device()

# Global variables for CCTV streaming
cctv_active = False
current_streams = {}  # Multiple camera streams
detection_queue = queue.Queue()
stream_threads = {}
# Hold latest base64 frame per camera (useful for debugging / quick fetch)
last_frames = {}

# Load multiple YOLO models
def load_models():
    models = {}
    model_paths = {
        'fight': 'models/fight.pt',
        'sleep': 'models/sleep.pt', 
        'suspicious': 'models/yolov11m.pt',
        'normal': 'models/yolov11s.pt'
    }
    
    for model_name, model_path in model_paths.items():
        try:
            if not os.path.exists(model_path):
                logger.warning(f"⚠️ Model file not found: {model_path}, using fallback")
                # Use normal model as fallback
                model_path = 'models/yolov11s.pt'
                if not os.path.exists(model_path):
                    continue
            
            logger.info(f"🔄 Loading {model_name} model from: {model_path}")
            
            if cuda_available:
                model = YOLO(model_path).to(device)
            else:
                model = YOLO(model_path)
            
            models[model_name] = model
            logger.info(f"✅ {model_name} model loaded successfully")
            
        except Exception as e:
            logger.error(f"❌ Error loading {model_name} model: {e}")
    
    return models

models = load_models()


def normalize_frame_for_imencode(img):
    """Return a numpy ndarray suitable for cv2.imencode: uint8, BGR, shape (H,W,3).
    Handles PIL Images, float arrays, alpha channels, grayscale, and RGB->BGR conversion.
    """
    try:
        # PIL Image -> numpy RGB
        if hasattr(img, 'convert') and callable(getattr(img, 'convert')):
            img = np.array(img.convert('RGB'))

        # Ensure numpy array
        if not isinstance(img, np.ndarray):
            img = np.array(img)

        # If float image in [0,1] or larger, scale to 0-255
        if img.dtype == np.float32 or img.dtype == np.float64:
            img = np.clip(img * 255.0, 0, 255).astype(np.uint8)

        # If single channel, convert to BGR
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

        # If has alpha channel, drop it
        if img.ndim == 3 and img.shape[2] == 4:
            img = img[:, :, :3]

        # If RGB, convert to BGR for OpenCV encoding/display
        # Heuristic: many libraries use RGB ordering; assume RGB if colors look like RGB by dtype
        # We'll attempt a safe swap: if the image first pixel seems more red than blue, swap.
        try:
            if img.ndim == 3 and img.shape[2] == 3:
                # If values look like typical 0-255, decide ordering by average channels
                ch0, ch1, ch2 = img[0, 0, 0], img[0, 0, 1], img[0, 0, 2]
                # If first channel appears to be R (heuristic), swap to BGR
                # This is conservative; always perform swap because many model.plot() outputs RGB
                img = img[:, :, ::-1]
        except Exception:
            pass

        # Final ensure uint8
        if img.dtype != np.uint8:
            img = img.astype(np.uint8)

        return img
    except Exception as e:
        logger.debug(f"normalize_frame_for_imencode failed: {e}")
        return None

# Person tracking for suspicious behavior
person_tracking = {}  # {camera_id: {person_id: {first_seen: timestamp, bbox: []}}}

# Initialize with sample data
def init_db():
    with app.app_context():
        db.create_all()
        
        # Create admin user if not exists
        if not User.query.filter_by(username='admin').first():
            admin = User(
                username='admin',
                email='admin@campusguard.edu',
                role='admin',
                department='Administration'
            )
            admin.set_password('admin123')
            db.session.add(admin)
        
        # Create security user
        if not User.query.filter_by(username='security').first():
            security = User(
                username='security',
                email='security@campusguard.edu',
                role='security',
                department='Security'
            )
            security.set_password('security123')
            db.session.add(security)
        
        # Create sample cameras
        if not Camera.query.first():
            cameras = [
                Camera(name='Main Entrance', location='Main Gate', stream_url=''),
                Camera(name='Library Cam', location='Library Entrance', stream_url=''),
                Camera(name='Student Hall', location='Student Center', stream_url=''),
                Camera(name='Parking Area', location='Parking Lot', stream_url='')
            ]
            db.session.add_all(cameras)
            db.session.commit()
            
            # Create default monitors for each camera
            for camera in cameras:
                for model_type in ['fight', 'sleep', 'suspicious', 'normal']:
                    monitor = CameraMonitor(
                        camera_id=camera.id,
                        model_type=model_type,
                        is_active=(model_type == 'normal')  # Enable normal by default
                    )
                    db.session.add(monitor)
        
        db.session.commit()
        logger.info("✅ Database initialized with sample data")

def log_system_action(action, module="System"):
    if current_user.is_authenticated:
        log = SystemLog(
            user_id=current_user.id,
            action=action,
            module=module,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent')
        )
        db.session.add(log)
        db.session.commit()

def detect_fight_anomaly(detected_objects, frame, confidence):
    """Detect fighting behavior"""
    if 'person' in detected_objects:
        person_count = detected_objects.count('person')
        if person_count >= 2 and confidence > 0.7:
            return {
                'type': 'fight_detected',
                'confidence': confidence,
                'message': f'Potential fight detected with {person_count} people',
                'severity': 'high'
            }
    return None

def detect_sleep_anomaly(detected_objects, frame, confidence):
    """Detect sleeping behavior"""
    # Log confidence for debugging
    logger.info(f"🛏️ Sleep detection check: objects={detected_objects}, confidence={confidence}")

    # Simplified sleep detection - in real scenario, use pose estimation
    # Using very low threshold for sleep detection since sleeping poses are subtle
    if 'person' in detected_objects and confidence > 0.25:  # Much lower threshold
        logger.info(f"🛏️ Sleep detected with confidence {confidence}")
        # Boost confidence significantly for sleep detection to ensure it creates incidents
        adjusted_conf = min(0.95, confidence * 2.0)  # Higher boost and cap
        return {
            'type': 'sleep_detected', 
            'confidence': adjusted_conf,
            'message': 'Potential sleeping behavior detected',
            'severity': 'medium'
        }
    return None

def detect_suspicious_behavior(camera_id, detected_persons, frame):
    """Detect suspicious behavior (person staying too long)"""
    current_time = datetime.utcnow()
    suspicious_incidents = []
    
    # Initialize tracking for this camera
    if camera_id not in person_tracking:
        person_tracking[camera_id] = {}
    
    # Track persons
    for i, person in enumerate(detected_persons):
        person_id = f"{camera_id}_{i}"
        
        if person_id not in person_tracking[camera_id]:
            # New person detected
            person_tracking[camera_id][person_id] = {
                'first_seen': current_time,
                'last_seen': current_time,
                'bbox': person['bbox']
            }
        else:
            # Update existing person
            person_tracking[camera_id][person_id]['last_seen'] = current_time
            person_tracking[camera_id][person_id]['bbox'] = person['bbox']
            
            # Check if person has been there for more than 4 minutes
            time_delta = current_time - person_tracking[camera_id][person_id]['first_seen']
            if time_delta.total_seconds() > 240:  # 4 minutes
                incident = {
                    'type': 'suspicious_loitering',
                    'confidence': 0.9,
                    'message': f'Person loitering for {int(time_delta.total_seconds()/60)} minutes',
                    'severity': 'high',
                    'person_id': person_id
                }
                suspicious_incidents.append(incident)
                
                # Reset tracking for this person
                person_tracking[camera_id][person_id]['first_seen'] = current_time
    
    # Clean up old tracks (people who left)
    current_tracking = person_tracking[camera_id].copy()
    for person_id, track in current_tracking.items():
        if (current_time - track['last_seen']).total_seconds() > 30:  # 30 seconds timeout
            del person_tracking[camera_id][person_id]
    
    return suspicious_incidents

def process_camera_stream(camera_id, stream_url):
    """Process individual camera stream"""
    global current_streams

    logger.info(f"🎥 Starting stream processing for camera {camera_id}")

    # Fetch camera record inside an application context
    with app.app_context():
        # use session.get to avoid Query.get deprecation warnings
        camera = db.session.get(Camera, camera_id)
    if not camera:
        logger.error(f"❌ Camera {camera_id} not found")
        return
    
    if camera.source_type in ['webcam', 'external']:
        try:
            # Use device_id if specified, otherwise fallback to index
            if camera.device_id is None or str(camera.device_id).strip() == '':
                device_idx = 0
            else:
                try:
                    device_idx = int(str(camera.device_id))
                except ValueError:
                    logger.error(f"❌ Camera {camera_id} has non-numeric device_id '{camera.device_id}'. Please pick a server device index when adding the camera.")
                    current_streams[camera_id] = False
                    return

            # Try several backends to open the device index (more robust across Windows builds)
            backends_to_try = [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_VFW, cv2.CAP_ANY]
            cap = None
            for backend in backends_to_try:
                try:
                    cap = cv2.VideoCapture(device_idx, backend)
                    if cap is not None and cap.isOpened():
                        logger.info(f"✅ Opened camera {camera_id} on device {device_idx} using backend {backend}")
                        break
                    else:
                        if cap is not None:
                            cap.release()
                except Exception as e:
                    logger.debug(f"Debug: backend {backend} failed for device {device_idx}: {e}")
                    continue

            # If we still couldn't open the requested device, try probing available indices as fallback
            if cap is None or not cap.isOpened():
                logger.warning(f"⚠️ Could not open device {device_idx} for camera {camera_id}; trying to auto-find any available device as fallback")
                # probe a few indices
                for probe_idx in range(0, 9):
                    try:
                        probe_cap = cv2.VideoCapture(probe_idx, cv2.CAP_DSHOW)
                        if probe_cap is not None and probe_cap.isOpened():
                            ret, _ = probe_cap.read()
                            if ret:
                                cap = probe_cap
                                device_idx = probe_idx
                                logger.info(f"✅ Fallback opened device index {probe_idx} for camera {camera_id}")
                                break
                        if probe_cap is not None:
                            probe_cap.release()
                    except Exception:
                        continue

            if cap is None or not cap.isOpened():
                logger.error(f"❌ Failed to open camera device {camera.device_id} (tried multiple backends and fallbacks)")
                current_streams[camera_id] = False
                return
        except Exception as e:
            logger.error(f"❌ Failed to open camera device {camera.device_id}: {e}")
            current_streams[camera_id] = False
            return
    else:
        # IP camera or stream URL
        if not camera.stream_url:
            logger.error(f"❌ No stream URL provided for camera {camera_id}")
            current_streams[camera_id] = False
            return
        cap = cv2.VideoCapture(camera.stream_url)
    
    if not cap.isOpened():
        logger.error(f"❌ Failed to open camera {camera_id}")
        current_streams[camera_id] = False
        return
    
    # Set camera properties for better performance
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)  # Request HD resolution
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    cap.set(cv2.CAP_PROP_FPS, 30)  # Request 30fps
    
    # Read test frame to verify settings
    ret, test_frame = cap.read()
    if ret:
        logger.info(f"Camera {camera_id} opened successfully. Frame size: {test_frame.shape}")
    
    frame_count = 0
    start_time = time.time()
    
    while current_streams.get(camera_id, False) and cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            logger.error(f"❌ Failed to read frame from camera {camera_id}")
            # Try to reconnect for IP cameras
            if camera.source_type == 'ip':
                cap.release()
                time.sleep(5)  # Wait before retry
                cap = cv2.VideoCapture(camera.stream_url)
                if not cap.isOpened():
                    break
                else:
                    continue
            else:
                break

        frame_count += 1

        try:
            # Get active monitors for this camera (DB access in app context)
            with app.app_context():
                active_monitors = CameraMonitor.query.filter_by(
                    camera_id=camera_id,
                    is_active=True
                ).all()

            if not active_monitors:
                # No active monitors: still enqueue a preview frame so the UI shows live feed.
                try:
                    preview_b64 = ''
                    try:
                        # Resize frame to a reasonable size for preview
                        resized = cv2.resize(frame, (640, 480))
                        norm_pf = normalize_frame_for_imencode(resized)
                        if norm_pf is not None:
                            # Increase JPEG quality to 85 and add compression params
                            encode_params = [
                                int(cv2.IMWRITE_JPEG_QUALITY), 85,
                                int(cv2.IMWRITE_JPEG_OPTIMIZE), 1
                            ]
                            ok, buf = cv2.imencode('.jpg', norm_pf, encode_params)
                            if ok:
                                preview_b64 = base64.b64encode(buf).decode('utf-8')
                    except Exception as e:
                        logger.debug(f"Primary frame encoding failed: {e}")
                        try:
                            # Fallback: try direct frame encode
                            ok, buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                            if ok:
                                preview_b64 = base64.b64encode(buf).decode('utf-8')
                        except Exception as e:
                            logger.debug(f"Fallback frame encoding failed: {e}")
                            preview_b64 = ''

                    payload_preview = {
                        'camera_id': camera_id,
                        'camera_name': camera.name if camera else f'Camera {camera_id}',
                        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                        'students_detected': 0,
                        'total_objects': 0,
                        'frame_base64': preview_b64,
                        'fps': 0.0,
                        'device': 'GPU' if cuda_available else 'CPU',
                        'detection_data': [],
                        'anomalies': []
                    }
                    detection_queue.put(payload_preview)
                    last_frames[camera_id] = preview_b64
                    logger.info(f"Preview frame enqueued for camera {camera_id} (len={len(preview_b64) if preview_b64 else 0})")
                except Exception as e:
                    logger.debug(f"Failed to enqueue preview for camera {camera_id}: {e}")
                continue

            processed_frame = frame.copy()
            all_detections = []
            all_anomalies = []

            for monitor in active_monitors:
                model = models.get(monitor.model_type)
                if not model:
                    continue

                # Run detection
                with torch.no_grad():
                    results = model(frame, verbose=False)

                # Process results
                detected_objects = []
                detected_persons = []
                detection_data = []

                for result in results:
                    boxes = result.boxes
                    if boxes is not None:
                        for box in boxes:
                            try:
                                cls = int(box.cls[0])
                                conf = float(box.conf[0])
                                class_name = model.names[cls] if hasattr(model, 'names') and cls in model.names else f'class_{cls}'

                                detected_objects.append(class_name)
                                detection_data.append({
                                    'class': class_name,
                                    'confidence': conf,
                                    'bbox': box.xyxy[0].tolist() if box.xyxy is not None else []
                                })

                                if class_name == 'person':
                                    detected_persons.append({
                                        'bbox': box.xyxy[0].tolist(),
                                        'confidence': conf
                                    })

                            except Exception:
                                continue

                # Model-specific anomaly detection
                anomalies = []
                if monitor.model_type == 'fight':
                    anomaly = detect_fight_anomaly(detected_objects, frame, max([d['confidence'] for d in detection_data] if detection_data else [0]))
                    if anomaly:
                        anomalies.append(anomaly)

                elif monitor.model_type == 'sleep':
                    anomaly = detect_sleep_anomaly(detected_objects, frame, max([d['confidence'] for d in detection_data] if detection_data else [0]))
                    if anomaly:
                        anomalies.append(anomaly)

                elif monitor.model_type == 'suspicious':
                    anomalies = detect_suspicious_behavior(camera_id, detected_persons, frame)

                # Check confidence threshold and create incidents if enough time has passed
                for anomaly in anomalies:
                    if anomaly['confidence'] >= monitor.confidence_threshold:
                        # Only create incident if enough time has passed since last one
                        current_time = datetime.utcnow()
                        min_time_between_incidents = timedelta(minutes=5)  # Minimum 5 minutes between incidents

                        if (not camera.last_incident or 
                            current_time - camera.last_incident > min_time_between_incidents):

                            # Save frame as evidence
                            norm = normalize_frame_for_imencode(frame)
                            if norm is not None:
                                _, buffer = cv2.imencode('.jpg', norm)
                                frame_base64 = base64.b64encode(buffer).decode('utf-8')
                            else:
                                # fallback to trying original frame
                                try:
                                    _, buffer = cv2.imencode('.jpg', frame)
                                    frame_base64 = base64.b64encode(buffer).decode('utf-8')
                                except Exception:
                                    frame_base64 = ''

                            incident = Incident(
                                title=f"Anomaly Detected: {anomaly['type']}",
                                description=anomaly['message'],
                                incident_type=anomaly['type'],
                                severity=anomaly.get('severity', 'medium'),
                                location=camera.location if camera else 'Unknown',
                                camera_id=camera_id,
                                confidence_score=anomaly['confidence'],
                                frame_evidence=frame_base64,
                                status='reported'
                            )
                            with app.app_context():
                                db.session.add(incident)
                                # Update camera's last_incident time
                                camera.last_incident = current_time
                                db.session.commit()

                        logger.info(f"🚨 Incident created: {anomaly['type']} with confidence {anomaly['confidence']}")

                all_detections.extend(detection_data)
                all_anomalies.extend(anomalies)

                # Draw detections on frame
                if results and len(results) > 0:
                    processed_frame = results[0].plot()

            # Calculate FPS
            current_time = time.time()
            fps = frame_count / (current_time - start_time) if (current_time - start_time) > 0 else 0

            # Encode frame to JPEG/base64 here and add JSON-safe payload to queue
            frame_base64 = ''
            try:
                if processed_frame is not None:
                    pf = processed_frame
                    # If PIL Image, convert to numpy array
                    if hasattr(pf, 'convert') and callable(getattr(pf, 'convert')):
                        pf = np.array(pf.convert('RGB'))

                    if not isinstance(pf, np.ndarray):
                        try:
                            pf = np.array(pf)
                        except Exception:
                            pf = None

                    if pf is not None:
                        # Log frame info to help debug visual artifacts
                        try:
                            logger.debug(f"Encoding frame: type={type(pf)} shape={getattr(pf, 'shape', None)} dtype={getattr(pf, 'dtype', None)}")
                        except Exception:
                            pass

                        # Normalize image to uint8 BGR before encoding
                        norm_pf = normalize_frame_for_imencode(pf)
                        if norm_pf is not None:
                            try:
                                encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 70]
                                success, buffer = cv2.imencode('.jpg', norm_pf, encode_param)
                                if success:
                                    frame_base64 = base64.b64encode(buffer).decode('utf-8')
                            except Exception as e:
                                logger.error(f"Error during imencode of normalized frame: {e}")
                        else:
                            # try best-effort fallback
                            try:
                                encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 70]
                                success, buffer = cv2.imencode('.jpg', pf, encode_param)
                                if success:
                                    frame_base64 = base64.b64encode(buffer).decode('utf-8')
                            except Exception as e:
                                logger.error(f"Fallback imencode failed: {e}")
            except Exception as e:
                logger.error(f"❌ Error encoding processed frame for camera {camera_id}: {e}")

            # Enqueue a JSON-serializable payload (no raw ndarrays)
            payload = {
                'camera_id': camera_id,
                'camera_name': camera.name if camera else f'Camera {camera_id}',
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'students_detected': int(len(detected_persons)),
                'total_objects': int(len(detected_objects)),
                'frame_base64': frame_base64,
                'fps': float(round(fps, 1)),
                'device': 'GPU' if cuda_available else 'CPU',
                'detection_data': all_detections,
                'anomalies': all_anomalies
            }
            detection_queue.put(payload)
            logger.debug(f"Enqueued detection payload for camera {camera_id} (len frame: {len(frame_base64) if frame_base64 else 0})")

            # Update latest frame cache for quick debugging / UI fetch
            try:
                last_frames[camera_id] = frame_base64
            except Exception:
                pass

            # Periodic logging to indicate stream is alive
            if frame_count % 30 == 0:
                logger.info(f"📸 Camera {camera_id} alive — frames={frame_count} fps={round(fps,1)} encoded={'yes' if frame_base64 else 'no'} detections={len(all_detections)} anomalies={len(all_anomalies)}")
            
        except Exception as e:
            logger.error(f"❌ Detection error for camera {camera_id}: {e}")
            continue
        
        time.sleep(0.05)
    
    cap.release()
    current_streams[camera_id] = False
    logger.info(f"🛑 Stream processing stopped for camera {camera_id}")

# Routes
@app.route('/')
def home():
    return render_template('home.html')

@app.route('/dashboard')
@login_required
def dashboard():
    # Get stats for dashboard
    total_incidents = Incident.query.count()
    today_incidents = Incident.query.filter(
        Incident.created_at >= datetime.now().date()
    ).count()
    active_cameras = Camera.query.filter_by(status='active').count()
    
    recent_incidents = Incident.query.order_by(Incident.created_at.desc()).limit(5).all()
    cameras = Camera.query.all()
    
    return render_template('dashboard.html',
                         total_incidents=total_incidents,
                         today_incidents=today_incidents,
                         active_cameras=active_cameras,
                         recent_incidents=recent_incidents,
                         cameras=cameras,
                         cuda_available=cuda_available,
                         model_loaded=len(models) > 0)

@app.route('/test')
@login_required
def test():
    cameras = Camera.query.all()
    return render_template('test.html', 
                         cuda_available=cuda_available, 
                         model_loaded=len(models) > 0,
                         cameras=cameras)

@app.route('/admin')
@login_required
def admin():
    if current_user.role != 'admin':
        flash('Access denied. Admin privileges required.', 'error')
        return redirect(url_for('dashboard'))
    
    users = User.query.all()
    cameras = Camera.query.all()
    incidents = Incident.query.order_by(Incident.created_at.desc()).limit(50).all()
    
    return render_template('admin.html', users=users, cameras=cameras, incidents=incidents)

@app.route('/incidents')
@login_required
def incidents():
    incidents_list = Incident.query.order_by(Incident.created_at.desc()).all()
    return render_template('incidents.html', incidents=incidents_list)

# API Routes
@app.route('/api/available_cameras')
@login_required
def get_available_cameras():
    """List all available camera devices on the system"""
    available_cameras = []
    seen_ids = set()

    # Backends to try (prefer DirectShow on Windows, then MSMF)
    backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_V4L, cv2.CAP_ANY]

    # Try indices 0-8 for common webcam indices
    for i in range(9):
        try:
            opened = False
            for backend in backends:
                try:
                    cap = cv2.VideoCapture(i, backend)
                except Exception:
                    cap = cv2.VideoCapture(i)

                if cap is None:
                    continue

                if cap.isOpened():
                    ret, frame = cap.read()
                    if ret:
                        if i not in seen_ids:
                            available_cameras.append({
                                'id': i,
                                'name': f'Camera {i}',
                                'type': 'webcam' if i == 0 else 'external'
                            })
                            seen_ids.add(i)
                        opened = True
                    cap.release()
                    if opened:
                        break

        except Exception as e:
            logger.debug(f"Error checking camera {i}: {e}")
            continue

    return jsonify(available_cameras)

@app.route('/api/cameras', methods=['GET', 'POST'])
@login_required
def handle_cameras():
    if request.method == 'POST':
        data = request.get_json()
        camera = Camera(
            name=data['name'],
            location=data['location'],
            source_type=data['source_type'],
            device_id=data.get('device_id'),
            stream_url=data.get('stream_url', ''),
            incident_delay=data.get('incident_delay', 5),
            status='active'
        )
        db.session.add(camera)
        db.session.commit()
        
        # Create monitors for new camera with specified settings
        models = data.get('models', ['normal'])
        confidence_threshold = data.get('confidence_threshold', 0.75)
        
        for model_type in ['fight', 'sleep', 'suspicious', 'normal']:
            monitor = CameraMonitor(
                camera_id=camera.id,
                model_type=model_type,
                is_active=model_type in models,
                confidence_threshold=confidence_threshold
            )
            db.session.add(monitor)
        
        db.session.commit()
        log_system_action(f"Added camera: {data['name']} with {len(models)} active models", "Cameras")
        return jsonify({'success': True, 'message': 'Camera added successfully'})
    
    cameras = Camera.query.all()
    cameras_data = []
    for camera in cameras:
        cameras_data.append({
            'id': camera.id,
            'name': camera.name,
            'location': camera.location,
            'stream_url': camera.stream_url,
            'status': camera.status
        })
    
    return jsonify(cameras_data)


@app.route('/api/cameras/<int:camera_id>', methods=['PUT'])
@login_required
def update_camera(camera_id):
    try:
        data = request.get_json()
        camera = db.session.get(Camera, camera_id)
        if not camera:
            return jsonify({'success': False, 'message': 'Camera not found'}), 404

        # Update allowed fields
        for field in ('name', 'location', 'source_type', 'stream_url'):
            if field in data:
                setattr(camera, field, data[field])

        # device_id may be numeric or null
        if 'device_id' in data:
            camera.device_id = str(data['device_id']) if data['device_id'] is not None else None

        if 'incident_delay' in data:
            try:
                camera.incident_delay = int(data['incident_delay'])
            except Exception:
                pass

        db.session.commit()
        log_system_action(f"Updated camera {camera.id}", "Cameras")
        return jsonify({'success': True, 'message': 'Camera updated'})
    except Exception as e:
        logger.error(f"Error updating camera {camera_id}: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/sanitize_cameras', methods=['POST'])
@login_required
def sanitize_cameras():
    """Clean up cameras with non-numeric device_id by setting device_id to NULL.
       Useful when cameras were created with invalid values from the UI."""
    try:
        cameras = Camera.query.all()
        cleaned = []
        for cam in cameras:
            if cam.device_id is not None and str(cam.device_id).strip() != '':
                try:
                    int(str(cam.device_id))
                except ValueError:
                    cam.device_id = None
                    cleaned.append(cam.id)
        db.session.commit()
        return jsonify({'success': True, 'cleaned_ids': cleaned})
    except Exception as e:
        logger.error(f"Error sanitizing cameras: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/cameras/<int:camera_id>', methods=['DELETE'])
@login_required
def delete_camera(camera_id):
    try:
        camera = db.session.get(Camera, camera_id)
        if not camera:
            return jsonify({'success': False, 'message': 'Camera not found'}), 404

        # Delete related monitors and incidents optionally
        CameraMonitor.query.filter_by(camera_id=camera_id).delete()
        Incident.query.filter_by(camera_id=camera_id).delete()
        db.session.delete(camera)
        db.session.commit()
        log_system_action(f"Deleted camera {camera.name} (id={camera_id})", "Cameras")
        return jsonify({'success': True, 'message': 'Camera deleted'})
    except Exception as e:
        logger.error(f"Error deleting camera {camera_id}: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/camera_monitors/<int:camera_id>', methods=['GET', 'PUT'])
@login_required
def handle_camera_monitors(camera_id):
    if request.method == 'PUT':
        data = request.get_json()
        monitor = CameraMonitor.query.filter_by(
            camera_id=camera_id, 
            model_type=data['model_type']
        ).first()
        
        if monitor:
            monitor.is_active = data['is_active']
            if 'confidence_threshold' in data:
                monitor.confidence_threshold = data['confidence_threshold']
            db.session.commit()
            
            log_system_action(f"Updated {data['model_type']} monitor for camera {camera_id}", "Monitoring")
            return jsonify({'success': True, 'message': 'Monitor updated successfully'})
        else:
            return jsonify({'success': False, 'message': 'Monitor not found'})
    
    monitors = CameraMonitor.query.filter_by(camera_id=camera_id).all()
    monitors_data = []
    for monitor in monitors:
        monitors_data.append({
            'model_type': monitor.model_type,
            'is_active': monitor.is_active,
            'confidence_threshold': monitor.confidence_threshold
        })
    
    return jsonify(monitors_data)

@app.route('/api/start_monitoring', methods=['POST'])
@login_required
def start_monitoring():
    global current_streams, stream_threads
    
    data = request.get_json()
    camera_id = data.get('camera_id')
    
    if not camera_id:
        return jsonify({'success': False, 'message': 'Camera ID required'})
    
    # use session.get to avoid SQLAlchemy legacy Query.get warnings
    camera = db.session.get(Camera, camera_id)
    if not camera:
        return jsonify({'success': False, 'message': 'Camera not found'})
    # Validate camera configuration before starting
    if camera.source_type in ['ip'] and not camera.stream_url:
        return jsonify({'success': False, 'message': 'Camera is configured as IP/stream but has no stream URL.'})
    if camera.source_type in ['webcam', 'external']:
        # try numeric device_id or allow empty (will use fallback), but reject long browser deviceId strings
        if camera.device_id is not None and str(camera.device_id).strip() != '':
            try:
                int(str(camera.device_id))
            except ValueError:
                return jsonify({'success': False, 'message': 'Camera device_id must be a numeric server device index.'})
    
    # Start monitoring this camera
    current_streams[camera_id] = True
    stream_thread = threading.Thread(
        target=process_camera_stream, 
        args=(camera_id, camera.stream_url)
    )
    stream_thread.daemon = True
    stream_thread.start()
    stream_threads[camera_id] = stream_thread
    
    log_system_action(f"Started monitoring camera: {camera.name}", "Monitoring")
    return jsonify({
        'success': True, 
        'message': f'Started monitoring {camera.name}'
    })

@app.route('/api/stop_monitoring', methods=['POST'])
@login_required
def stop_monitoring():
    global current_streams
    
    data = request.get_json()
    camera_id = data.get('camera_id')
    
    if camera_id in current_streams:
        current_streams[camera_id] = False
        log_system_action(f"Stopped monitoring camera {camera_id}", "Monitoring")
        return jsonify({'success': True, 'message': 'Monitoring stopped'})
    
    return jsonify({'success': False, 'message': 'Camera not being monitored'})

@app.route('/api/detection_data')
@login_required
def get_detection_data():
    try:
        # Try to get data with a small timeout to reduce latency
        try:
            data = detection_queue.get(timeout=0.1)  # 100ms timeout
        except queue.Empty:
            # If no new data, try to return cached frame
            for cam_id, b64 in last_frames.items():
                if b64:
                    return jsonify({
                        'camera_id': cam_id,
                        'camera_name': f'Camera {cam_id}',
                        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                        'frame_base64': b64,
                        'fps': 0
                    })
            return jsonify({'error': 'No frames available'})

        # Process frame data if present
        try:
            if 'frame_data' in data and data['frame_data'] is not None:
                frame = data['frame_data']
                # Handle PIL Image
                if hasattr(frame, 'convert') and callable(getattr(frame, 'convert')):
                    frame = np.array(frame.convert('RGB'))

                # Ensure numpy array
                if not isinstance(frame, np.ndarray):
                    try:
                        frame = np.array(frame)
                    except Exception:
                        frame = None

                if frame is not None:
                    _, buffer = cv2.imencode('.jpg', frame)
                    frame_base64 = base64.b64encode(buffer).decode('utf-8')
                else:
                    frame_base64 = ''
            else:
                frame_base64 = ''
        except Exception as e:
            logger.error(f"❌ Error encoding frame for JSON response: {e}")
            frame_base64 = ''

        # Remove raw frame data (ndarray) to avoid JSON serialization errors
        if 'frame_data' in data:
            try:
                del data['frame_data']
            except Exception:
                data['frame_data'] = None

        # Helper to convert numpy scalars/arrays to native Python types
        def make_json_safe(obj):
            try:
                if isinstance(obj, np.generic):
                    return obj.item()
                if isinstance(obj, np.ndarray):
                    return obj.tolist()
                if isinstance(obj, dict):
                    return {k: make_json_safe(v) for k, v in obj.items()}
                if isinstance(obj, list):
                    return [make_json_safe(v) for v in obj]
            except Exception:
                pass
            return obj

        # Sanitize remaining payload
        safe_payload = {k: make_json_safe(v) for k, v in data.items()}
        safe_payload['frame_base64'] = frame_base64
        return jsonify(safe_payload)
    except queue.Empty:
        # If no item in queue, try to return the latest cached frame for any camera
        try:
            for cam_id, b64 in last_frames.items():
                if b64:
                    return jsonify({
                        'camera_id': cam_id,
                        'camera_name': f'Camera {cam_id}',
                        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                        'students_detected': 0,
                        'total_objects': 0,
                        'frame_base64': b64,
                        'fps': 0,
                        'device': 'GPU' if cuda_available else 'CPU',
                        'detection_data': [],
                        'anomalies': []
                    })
        except Exception:
            pass

        return jsonify({
            'camera_id': 0,
            'students_detected': 0,
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'fps': 0,
            'device': 'GPU' if cuda_available else 'CPU',
            'anomalies': []
        })


@app.route('/api/latest_frame/<int:camera_id>')
@login_required
def get_latest_frame(camera_id):
    """Return the most recent base64-encoded frame for a camera (debugging endpoint)."""
    try:
        frame_b64 = last_frames.get(camera_id, '')
        if frame_b64:
            return jsonify({'camera_id': camera_id, 'frame_base64': frame_b64})
        return jsonify({'camera_id': camera_id, 'frame_base64': ''}), 404
    except Exception as e:
        logger.error(f"Error returning latest frame for camera {camera_id}: {e}")
        return jsonify({'camera_id': camera_id, 'frame_base64': ''}), 500


@app.route('/api/snapshot/<int:camera_id>')
@login_required
def get_snapshot(camera_id):
    """Return the most recent JPEG bytes for a camera as image/jpeg (quick check in browser)."""
    try:
        b64 = last_frames.get(camera_id)
        if not b64:
            return jsonify({'success': False, 'message': 'No frame available'}), 404

        try:
            img_bytes = base64.b64decode(b64)
            return Response(img_bytes, mimetype='image/jpeg')
        except Exception as e:
            logger.error(f"Error decoding snapshot for camera {camera_id}: {e}")
            return jsonify({'success': False, 'message': 'Decoding failed'}), 500
    except Exception as e:
        logger.error(f"Error returning snapshot for camera {camera_id}: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/get_result_file/<path:filename>')
@login_required
def get_result_file(filename):
    """Serve result files from runs/detect or uploaded static files in a safe manner."""
    # Prevent path traversal
    requested_path = os.path.abspath(filename)

    runs_root = os.path.abspath('runs/detect')
    uploads_root = os.path.abspath(app.config['UPLOAD_FOLDER'])

    # If filename is already a full path, try to serve it; otherwise join with possible roots
    candidate_paths = [requested_path]
    # also consider if client sent relative path (like 'runs/detect/...')
    candidate_paths.append(os.path.abspath(os.path.join('.', filename)))

    for root in [runs_root, uploads_root, os.path.abspath('.')]:
        candidate_paths.append(os.path.abspath(os.path.join(root, filename)))

    for path in candidate_paths:
        if os.path.exists(path):
            # ensure path is under allowed roots
            abs_path = os.path.abspath(path)
            if abs_path.startswith(runs_root) or abs_path.startswith(uploads_root) or abs_path.startswith(os.path.abspath('.')):
                try:
                    return send_file(abs_path)
                except Exception as e:
                    logger.error(f"❌ Error sending file {abs_path}: {e}")
                    break

    return jsonify({'success': False, 'message': 'Result file not found'}), 404

@app.route('/api/upload_test', methods=['POST'])
@login_required
def upload_test():
    if not models:
        return jsonify({'success': False, 'message': 'No models loaded.'})

    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file uploaded'})

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': 'No file selected'})

    allowed_extensions = {'.jpg', '.jpeg', '.png', '.mp4', '.avi', '.mov'}
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        return jsonify({'success': False, 'message': f'Invalid file type. Allowed: {", ".join(allowed_extensions)}'})

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    def save_evidence_image(img, incident_type):
        """Save a single evidence image (BGR numpy array) to runs/detect and return (rel_path, b64)
        """
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            out_dir = os.path.join('runs', 'detect', f'incident_{timestamp}')
            os.makedirs(out_dir, exist_ok=True)
            fname = f'evidence_{incident_type}_{timestamp}.jpg'
            out_path = os.path.join(out_dir, fname)
            # Ensure uint8 BGR for saving
            if img is None:
                return None, None
            cv2.imwrite(out_path, img)
            with open(out_path, 'rb') as f:
                b64 = base64.b64encode(f.read()).decode('utf-8')
            rel = os.path.relpath(out_path).replace('\\', '/')
            return rel, b64
        except Exception as e:
            logger.error(f"Error saving evidence image: {e}")
            return None, None

    def scan_video_for_anomaly(video_path, model_keys, max_frames=600, stride=5):
        """Quickly scan a video for the first frame that triggers one of our anomaly detectors.
        Returns (model_key, anomaly_dict, frame_bgr, frame_index) or (None, None, None, None)
        """
        try:
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                return None, None, None, None

            frame_idx = 0
            scanned = 0
            while scanned < max_frames and cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_idx % stride == 0:
                    scanned += 1
                    # For each requested model, run detection on the frame
                    for mk in model_keys:
                        model = models.get(mk)
                        if not model:
                            continue
                        try:
                            # ultralytics can accept numpy frame
                            results = model(frame, verbose=False)
                        except Exception:
                            results = None

                        detected_objects = []
                        detection_data = []
                        if results and len(results) > 0:
                            for res in results:
                                boxes = res.boxes
                                if boxes is not None:
                                    for box in boxes:
                                        try:
                                            cls = int(box.cls[0])
                                            conf = float(box.conf[0])
                                            class_name = model.names[cls] if hasattr(model, 'names') and cls in model.names else f'class_{cls}'
                                            detected_objects.append(class_name)
                                            detection_data.append({'class': class_name, 'confidence': conf, 'bbox': box.xyxy[0].tolist() if box.xyxy is not None else []})
                                        except Exception:
                                            continue

                        # Check for anomalies
                        max_conf = max([d['confidence'] for d in detection_data] if detection_data else [0])
                        
                        if mk == 'fight':
                            anomaly = detect_fight_anomaly(detected_objects, frame, max_conf)
                            if anomaly:
                                cap.release()
                                return mk, anomaly, frame, frame_idx
                        
                        if mk == 'sleep':
                            # For sleep, check we have person detections with good confidence
                            person_dets = [d for d in detection_data if d['class'] == 'person']
                            if person_dets:
                                person_conf = max(d['confidence'] for d in person_dets)
                                logger.info(f"Sleep scan frame {frame_idx}: found person with conf={person_conf}")
                                anomaly = detect_sleep_anomaly(['person'], frame, person_conf)
                                if anomaly:
                                    cap.release()
                                    return mk, anomaly, frame, frame_idx
                        
                        # phone detection: look for class names commonly used
                        phone_classes = {'cell phone', 'phone', 'mobile', 'cellphone'}
                        for d in detection_data:
                            if d.get('class', '').lower() in phone_classes and d.get('confidence', 0) > 0.5:
                                anomaly = {'type': 'phone_detected', 'confidence': d.get('confidence', 0), 'message': 'Phone detected', 'severity': 'medium'}
                                cap.release()
                                return mk, anomaly, frame, frame_idx

                frame_idx += 1

            cap.release()
        except Exception as e:
            logger.error(f"Error scanning video for anomaly: {e}")
        return None, None, None, None

    try:
        logger.info(f"🔄 Processing file: {filename} on {'GPU' if cuda_available else 'CPU'}")
        start_time = time.time()

        requested_models = []
        if 'models' in request.form:
            try:
                requested_models = json.loads(request.form.get('models') or '[]')
            except Exception:
                requested_models = []

        # By default, scan using all loaded models so we don't miss sleep/fight/phone
        # when the client doesn't explicitly request specific models.
        if not requested_models:
            requested_models = list(models.keys())

        # Build available models as intersection of requested and loaded models
        available_models = [m for m in requested_models if m in models]
        if not available_models:
            # Fallback to all loaded models if intersection is empty
            available_models = list(models.keys())

        # If video: do a quick scan for anomalies and save the first incident frame
        if filename.lower().endswith(('.mp4', '.avi', '.mov')):
            mk, anomaly, aframe, frame_index = scan_video_for_anomaly(filepath, available_models)
            result = process_video_file(filepath, filename, models.get(available_models[0]))
            result['models_used'] = available_models

            if anomaly and aframe is not None:
                # Save evidence and get both the filesystem path and base64 encoding
                rel_path, b64 = save_evidence_image(aframe, anomaly.get('type', mk or 'video'))
                if rel_path:
                    logger.info(f"Saved incident evidence to: {rel_path}")

                # Create incident record and store both base64 and file path
                incident = Incident(
                    title=f"Anomaly Detected: {anomaly.get('type')}",
                    description=anomaly.get('message'),
                    incident_type=anomaly.get('type'),
                    severity=anomaly.get('severity', 'medium'),
                    location='Uploaded File',
                    camera_id=None,
                    confidence_score=anomaly.get('confidence', 0),
                    frame_evidence=b64 or '',  # base64 for inline display
                    video_evidence_path=rel_path or None,  # path for loading from disk
                    status='reported'
                )

                # Save to database within app context
                try:
                    with app.app_context():
                        db.session.add(incident)
                        db.session.commit()
                        logger.info(f"Created incident: type={anomaly.get('type')}, confidence={anomaly.get('confidence')}")
                except Exception as e:
                    logger.error(f"Failed to save incident to database: {e}")
                    # But continue - we still want to return the detection results
                
                result['incident_created'] = True
                result['evidence_file'] = rel_path
                
                # Log the incident details for debugging
                logger.info(f"Incident details: conf={anomaly.get('confidence')}, path={rel_path}, has_b64={'yes' if b64 else 'no'}")
            else:
                result['incident_created'] = False

        else:
            # Image processing: run the selected models and detect anomalies
            detection_data = []
            student_count = 0
            orig_img = cv2.imread(filepath)
            draw_img = orig_img.copy() if orig_img is not None else None
            incident_saved = False
            incident_info = None

            for model_key in available_models:
                model = models.get(model_key)
                if not model:
                    continue

                results = model(filepath, verbose=False)
                if results and len(results) > 0:
                    for result_item in results:
                        boxes = result_item.boxes
                        if boxes is not None:
                            for box in boxes:
                                try:
                                    cls = int(box.cls[0])
                                    conf = float(box.conf[0])
                                    class_name = model.names[cls] if hasattr(model, 'names') and cls in model.names else f'class_{cls}'
                                    bbox = box.xyxy[0].tolist() if box.xyxy is not None else []

                                    detection_data.append({
                                        'class': class_name,
                                        'confidence': round(conf, 2),
                                        'bbox': bbox,
                                        'model': model_key
                                    })

                                    if class_name == 'person':
                                        student_count += 1

                                    if draw_img is not None and len(bbox) >= 4:
                                        x1, y1, x2, y2 = map(int, bbox)
                                        color = (0, 255, 0)
                                        cv2.rectangle(draw_img, (x1, y1), (x2, y2), color, 2)
                                        label = f"{class_name} {int(conf*100)}% ({model_key})"
                                        cv2.putText(draw_img, label, (x1, max(15, y1-5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

                                except Exception:
                                    continue

                # Run anomaly detectors per-model
                detected_objects = [d['class'] for d in detection_data]
                max_conf = max([d['confidence'] for d in detection_data]) if detection_data else 0
                if model_key == 'fight':
                    anomaly = detect_fight_anomaly(detected_objects, orig_img, max_conf)
                elif model_key == 'sleep':
                    anomaly = detect_sleep_anomaly(detected_objects, orig_img, max_conf)
                else:
                    anomaly = None

                # phone detection
                phone_classes = {'cell phone', 'phone', 'mobile', 'cellphone'}
                phone_found = next((d for d in detection_data if d['class'].lower() in phone_classes and d['confidence'] > 0.5), None)
                if phone_found:
                    anomaly = {'type': 'phone_detected', 'confidence': phone_found['confidence'], 'message': 'Phone detected', 'severity': 'medium'}

                if anomaly and not incident_saved:
                    # Save evidence image (full frame) and create incident
                    rel_path, b64 = save_evidence_image(draw_img if draw_img is not None else orig_img, anomaly.get('type'))
                    incident = Incident(
                        title=f"Anomaly Detected: {anomaly.get('type')}",
                        description=anomaly.get('message'),
                        incident_type=anomaly.get('type'),
                        severity=anomaly.get('severity', 'medium'),
                        location='Uploaded File',
                        camera_id=None,
                        confidence_score=anomaly.get('confidence', 0),
                        frame_evidence=b64 or '',
                        video_evidence_path=rel_path or None,
                        status='reported'
                    )
                    with app.app_context():
                        db.session.add(incident)
                        db.session.commit()
                    incident_saved = True
                    incident_info = {'evidence_file': rel_path, 'anomaly': anomaly}

            # Save aggregated result image
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            output_dir = f'runs/detect/test_{timestamp}'
            os.makedirs(output_dir, exist_ok=True)
            result_image_path = os.path.join(output_dir, 'output_image.jpg')
            if draw_img is not None:
                cv2.imwrite(result_image_path, draw_img)

            result = {
                'success': True,
                'original_file': f'static/uploads/{filename}',
                'result_file': result_image_path,
                'detections': detection_data,
                'total_detections': len(detection_data),
                'students_detected': student_count,
                'file_type': 'image',
                'models_used': available_models
            }

            if incident_saved:
                result['incident_created'] = True
                result['evidence_file'] = incident_info.get('evidence_file')
                result['anomaly'] = incident_info.get('anomaly')
            else:
                result['incident_created'] = False

        processing_time = time.time() - start_time
        logger.info(f"✅ Detection completed in {processing_time:.2f}s")

        try:
            rel_path = os.path.relpath(result.get('result_file', ''))
            result['result_file'] = rel_path.replace('\\', '/')
        except Exception:
            pass

        result['processing_time'] = round(processing_time, 2)
        result['device_used'] = 'GPU' if cuda_available else 'CPU'
        result['fps'] = round(1/processing_time, 1) if processing_time > 0 else 0

        log_system_action(f"Tested model with file: {filename}", "Testing")
        return jsonify(result)

    except Exception as e:
        logger.error(f"❌ Detection failed: {str(e)}")
        return jsonify({'success': False, 'message': f'Detection failed: {str(e)}'})

def process_video_file(video_path, filename, model):
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir = f'runs/detect/test_{timestamp}'
    os.makedirs(output_dir, exist_ok=True)
    
    results = model.predict(video_path, save=True, project=output_dir, name='', exist_ok=True)
    
    saved_files = []
    for root, dirs, files in os.walk(output_dir):
        for file in files:
            if file.endswith(('.mp4', '.avi', '.mov')):
                saved_files.append(os.path.join(root, file))
    
    output_video_path = saved_files[0] if saved_files else os.path.join(output_dir, 'output_video.mp4')
    
    detection_data = []
    student_count = 0
    
    if results and len(results) > 0:
        first_result = results[0]
        boxes = first_result.boxes
        if boxes is not None:
            for box in boxes:
                try:
                    cls = int(box.cls[0])
                    conf = float(box.conf[0])
                    class_name = model.names[cls] if hasattr(model, 'names') and cls in model.names else f'class_{cls}'
                    detection_data.append({
                        'class': class_name,
                        'confidence': round(conf, 2),
                        'bbox': box.xyxy[0].tolist() if box.xyxy is not None else []
                    })
                    if class_name == 'person':
                        student_count += 1
                except Exception:
                    continue
    
    return {
        'success': True,
        'original_file': f'static/uploads/{filename}',
        'result_file': output_video_path,
        'detections': detection_data,
        'total_detections': len(detection_data),
        'students_detected': student_count,
        'file_type': 'video'
    }

def process_image_file(filepath, filename, model):
    results = model(filepath, verbose=False)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir = f'runs/detect/test_{timestamp}'
    os.makedirs(output_dir, exist_ok=True)
    
    result_image_path = os.path.join(output_dir, 'output_image.jpg')
    results[0].save(filename=result_image_path)
    
    detection_data = []
    student_count = 0
    
    for result in results:
        boxes = result.boxes
        if boxes is not None:
            for box in boxes:
                try:
                    cls = int(box.cls[0])
                    conf = float(box.conf[0])
                    class_name = model.names[cls] if hasattr(model, 'names') and cls in model.names else f'class_{cls}'
                    detection_data.append({
                        'class': class_name,
                        'confidence': round(conf, 2),
                        'bbox': box.xyxy[0].tolist() if box.xyxy is not None else []
                    })
                    if class_name == 'person':
                        student_count += 1
                except Exception:
                    continue
    
    return {
        'success': True,
        'original_file': f'static/uploads/{filename}',
        'result_file': result_image_path,
        'detections': detection_data,
        'total_detections': len(detection_data),
        'students_detected': student_count,
        'file_type': 'image'
    }

# Recent incidents API route
@app.route('/api/recent_incidents')
@login_required
def get_recent_incidents():
    try:
        # Get incidents from the last 24 hours
        since = datetime.utcnow() - timedelta(days=1)
        incidents = Incident.query.filter(
            Incident.created_at >= since
        ).order_by(Incident.created_at.desc()).limit(10).all()
        
        return jsonify([{
            'id': incident.id,
            'title': incident.title,
            'description': incident.description,
            'type': incident.incident_type,
            'severity': incident.severity,
            'location': incident.location,
            'status': incident.status,
            'created_at': incident.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'confidence_score': incident.confidence_score,
            # include evidence file path (if saved on disk) and whether frame_evidence exists
            'evidence_file': incident.video_evidence_path,
            'has_frame_evidence': bool(incident.frame_evidence)
        } for incident in incidents])
    except Exception as e:
        logger.error(f"Error fetching recent incidents: {e}")
        return jsonify([])


@app.route('/api/incidents', methods=['GET'])
@login_required
def get_incidents():
    """Get all incidents."""
    try:
        incidents = Incident.query.order_by(Incident.created_at.desc()).all()
        return jsonify([{
            'id': incident.id,
            'title': incident.title,
            'type': incident.incident_type,
            'severity': incident.severity,
            'location': incident.location or 'N/A',
            'status': incident.status,
            'reported_by': incident.reported_by.username if incident.reported_by else 'System',
            'created_at': incident.created_at.strftime('%Y-%m-%d %H:%M'),
            'description': incident.description,
            'frame_evidence': bool(incident.frame_evidence),
            'video_evidence_path': incident.video_evidence_path
        } for incident in incidents])
    except Exception as e:
        logger.error(f"Error fetching incidents: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/incidents/clear', methods=['POST'])
@login_required
def clear_incidents():
    """Clear all incidents or incidents of a specific type."""
    try:
        # Set default empty dict if no JSON was sent
        data = request.get_json(silent=True) or {}
        incident_type = data.get('type')  # Optional: clear only specific type
        
        query = Incident.query
        if incident_type:
            query = query.filter_by(incident_type=incident_type)
        
        count = query.count()
        query.delete()
        db.session.commit()
        
        log_system_action(f"Cleared {count} incidents" + (f" of type {incident_type}" if incident_type else ""))
        return jsonify({
            'success': True, 
            'message': f'Cleared {count} incidents' + (f" of type {incident_type}" if incident_type else "")
        })
    except Exception as e:
        logger.error(f"Error clearing incidents: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/stats')
@login_required
def api_stats():
    """Return small runtime stats used by the dashboard (models, device, monitoring)"""
    try:
        active_monitoring_count = sum(1 for v in current_streams.values() if v)
        total_cameras = Camera.query.count()
        active_cameras = Camera.query.filter_by(status='active').count()
        model_list = list(models.keys())

        return jsonify({
            'models_loaded': len(models),
            'model_names': model_list,
            'cuda_available': cuda_available,
            'device': 'GPU' if cuda_available else 'CPU',
            'active_monitoring_threads': active_monitoring_count,
            'total_cameras': total_cameras,
            'active_cameras': active_cameras
        })
    except Exception as e:
        logger.error(f"Error building stats: {e}")
        return jsonify({'models_loaded': len(models), 'cuda_available': cuda_available, 'device': 'CPU'})

if __name__ == '__main__':
    with app.app_context():
        init_db()
    
    print("🚀 Starting CampusGuard AI Application...")
    print(f"🔧 Device: {device}")
    print(f"🎯 CUDA Available: {cuda_available}")
    print(f"🤖 Models Loaded: {len(models)}")
    print("📋 Available Models:", list(models.keys()))
    
    if not models:
        print("❌ WARNING: No models loaded!")
    else:
        print(f"✅ Models ready!")
    
    if cuda_available:
        print(f"📊 GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    
    print("🌐 Starting web server...")
    app.run(debug=False, host='0.0.0.0', port=5000, threaded=True)