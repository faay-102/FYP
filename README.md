# CampusGuard AI
**An AI-Driven Real-Time Surveillance Framework for Proactive Campus Security**  

---

CampusGuard AI is an automated, real-time video surveillance framework designed to enhance campus safety by augmenting traditional CCTV networks with proactive computer vision intelligence. Utilizing the YOLOv11 deep learning architecture, the system continuously analyzes video streams to identify potential physical altercations, unauthorized loitering, prolonged inactivity or collapse, and mobile phone usage in examination halls.

The framework features multi-camera concurrent stream processing, configurable per-camera detection models, an incident lifecycle tracker with visual evidence capture, role-based access control (RBAC), and a dedicated mobile patrol portal for on-ground security personnel.

---

## Key Features

- **Multi-Source Video Ingestion:** Concurrently captures feeds from integrated laptop webcams, external USB cameras, and network IP cameras via RTSP/HTTP protocols.
- **Concurrent Stream Pipeline:** Multi-threaded frame ingestion with queue-based buffer management (`CAP_PROP_BUFFERSIZE = 1`) to eliminate streaming lag.
- **Automated Incident Logging:** Generates incident records with Base64-encoded visual evidence and file paths upon threshold breach, incorporating a cooldown timer to prevent duplicate alert spam.
- **Mobile Guard Patrol Interface (`/guard`):** Mobile-optimized portal enabling on-ground officers to receive live incident dispatch alerts, audio alarm notifications, and update response statuses in real time.
- **Offline Media Testing Sandbox (`/test`):** Benchmark detection models on uploaded static images (`.jpg`, `.png`) or pre-recorded video clips (`.mp4`, `.avi`, `.mov`) with frame-striding anomaly scans.
- **Role-Based Access Control & Auditing:** Granular permission tiers (Admin, Security, Student) coupled with system audit logging of critical administrative actions.

---

## AI Detection Models

CampusGuard AI employs specialized YOLOv11 models and computer vision heuristics. **Note:** AI-generated alerts serve as decision-support indicators and do not constitute definitive proof of misconduct; all flagged incidents require manual verification by authorized security staff.

| Model / Threat Type | Primary Detection Objective | Operational Heuristic | Target Deployment |
| :--- | :--- | :--- | :--- |
| **Fight Detection** | Physical altercations & violence | High-confidence spatial clustering and overlap of 2+ individuals | Cafeterias, corridors, parking lots |
| **Sleep / Inactivity** | Prolonged inactivity & collapse | Recumbent posture detection with calibrated sensitivity scaling | Classrooms, libraries, lecture halls |
| **Suspicious Loitering** | Lingering in restricted zones | Spatio-temporal dwell tracking (flags presence exceeding 4 minutes) | Server rooms, perimeter fences, vaults |
| **Phone Detection** | Prohibited mobile device usage | Object classification matching mobile device classes (`cell phone`) | Examination halls, secure test centers |
| **Normal Surveillance** | Crowd density & person tracking | Standard multi-class object detection and person counting | General campus grounds and walkways |

---

## System Architecture

```
+-----------------------------------------------------------------------------------+
|                               VIDEO INGESTION LAYER                               |
|   Integrated Webcams      External USB Cameras      IP Cameras (RTSP/HTTP Feeds)  |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                             STREAM PROCESSING ENGINE                              |
|   - Multi-Threaded Daemon Ingestion (1280x720 @ 30 FPS, OpenCV Backends)          |
|   - Reconnection & Keep-Alive Logic | Frame Normalization & uint8 Conversion      |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                                AI INFERENCE ENGINE                                |
|   Ultralytics YOLOv11 Pipeline (CUDA GPU Accelerated / CPU Fallback)              |
|   [Fight Detection]  [Sleep Detection]  [Loitering Tracker]  [Phone Detection]    |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        ANOMALY ARBITRATION & DISPATCH                             |
|   - Sensitivity Threshold Verification | Cooldown & Anti-Spam Timer Validation    |
+-------------------+-------------------------------------------+-------------------+
                    |                                           |
                    v                                           v
+---------------------------------------+   +---------------------------------------+
|           DATA PERSISTENCE            |   |          LIVE STREAM BUFFER           |
|   SQLite Database (SQLAlchemy ORM)    |   |   Thread-Safe FIFO Queue              |
|   - Users, Cameras, Monitor Mappings  |   |   - Synchronized JSON Telemetry       |
|   - Incidents & Evidence Snapshots    |   |   - Base64 JPEG Stream Frames         |
+---------------------------------------+   +-------------------+-------------------+
                                                                |
                                                                v
+-----------------------------------------------------------------------------------+
|                                PRESENTATION LAYER                                 |
|   Flask Web Server (Jinja2 Templates, Responsive UI, AJAX Asynchronous Polling)   |
|   - Security Dashboard   - Guard Patrol Portal   - Incident Review & Admin Panel  |
+-----------------------------------------------------------------------------------+
```

---

## Technology Stack

| Category | Component | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Language** | Python | 3.8+ | Application runtime and computer vision pipeline |
| **Web Framework** | Flask | 2.3.3 | Backend routing, WSGI server, and REST API controllers |
| **ORM & Database** | Flask-SQLAlchemy / SQLite | 3.0.5 / 3.x | Object-relational mapping and structured data storage |
| **Authentication** | Flask-Login / bcrypt | 0.6.3 / 4.0.1 | Session management and secure password hashing |
| **Deep Learning** | Ultralytics YOLOv11 | 8.0.186 | Real-time object detection and anomaly inference |
| **ML Runtime** | PyTorch & Torchvision | 2.0.1 / 0.15.2 | Tensor computation with CUDA GPU acceleration |
| **Image Processing**| OpenCV (cv2) | 4.8.1.78 | Video decoding, frame transformations, and device capture |
| **Frontend** | HTML5 / CSS3 / JavaScript | ES6+ | Real-time monitoring UI, AJAX polling, and Web Audio API |

---

## Hardware & System Requirements

| Specification | Minimum (Evaluation / CPU) | Recommended (Production / GPU) |
| :--- | :--- | :--- |
| **Processor** | Intel Core i5 (8th Gen) / AMD Ryzen 5 | Intel Core i7 (10th Gen+) / AMD Ryzen 7 |
| **Memory (RAM)** | 8 GB DDR4 | 16 GB DDR4/DDR5 |
| **Graphics (GPU)**| Integrated Intel UHD / Iris Xe (CPU mode) | NVIDIA RTX 3060 or higher (8 GB+ VRAM, CUDA 11.8+) |
| **Storage** | 5 GB available disk space | 256 GB+ NVMe SSD |
| **Operating System**| Windows 10/11 (64-bit) or Ubuntu 20.04/22.04 | Windows 11 (64-bit) or Ubuntu 22.04 LTS |
| **Video Input** | Integrated 720p HD webcam | Multi-channel RTSP IP cameras or USB HD cameras |

---

## Installation & Setup

### 1. Clone Repository & Setup Environment
```bash
git clone https://github.com/faay-102/FYP.git
cd FYP

# Create and activate virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt

# Optional: Install CUDA-accelerated PyTorch for NVIDIA GPUs
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 3. Verify Model Weights
Ensure detection weights are located in the `models/` directory:
`models/fight.pt`, `models/sleep.pt`, `models/yolov11m.pt`, and `models/yolov11s.pt` (fallback).

### 4. Run Application
```bash
python app.py
```
Access the application at `http://localhost:5000`. The database initializes automatically on first launch.

---

## Default Access Credentials

The database automatically initializes default accounts for initial setup:

| Role | Username | Password | Intended Scope |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `admin123` | Full administrative control, camera configuration, audit logs |
| **Security Officer** | `security` | `security123` | Real-time monitoring, incident review, guard patrol portal |

> **Security Notice:** The default credentials above are strictly intended for local development and demonstration purposes. Change all default passwords immediately before any staging or production deployment.

---

## Application Usage

- **Live Surveillance (`/dashboard`):** Monitor live camera streams concurrently. View active threat counts, live FPS metrics, and toggle cameras on or off.
- **Mobile Guard Patrol (`/guard`):** Access the mobile-first responder interface. On-duty officers receive audio alarm sirens upon new incidents, view evidence snapshots, and mark dispatches as *Responding* or *Resolved*.
- **Incident Investigation (`/incidents`):** Filter security records by status (`Reported`, `Investigating`, `Resolved`) or severity (`Low` to `Critical`). Inspect captured Base64 evidence snapshots and log investigation notes.
- **Media Testing Sandbox (`/test`):** Upload pre-recorded video or image files, select specific AI models, adjust sensitivity sliders, and execute automated anomaly scans.
- **Camera Administration (`/admin`):** Add cameras by hardware device index or RTSP URL, assign active models and confidence thresholds per camera, and inspect audit logs.

---

## REST API Documentation

### Camera Management
| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/api/available_cameras` | `GET` | Required | Probes and lists connected local video capture devices |
| `/api/cameras` | `GET` / `POST` | Required / Admin | Lists all cameras or registers a new camera configuration |
| `/api/cameras/<id>` | `PUT` / `DELETE`| Admin | Updates camera properties or deletes camera and associated monitors |
| `/api/sanitize_cameras` | `POST` | Admin | Cleans invalid device indices from camera records |

### Stream Control & Telemetry
| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/api/start_monitoring` | `POST` | Required | Spawns background worker thread to ingest and process a camera feed |
| `/api/stop_monitoring` | `POST` | Required | Terminates stream ingestion thread and releases camera hardware |
| `/api/camera_monitors/<id>`| `GET` / `PUT` | Required | Reads or updates active AI models and thresholds for a camera |
| `/api/detection_data` | `GET` | Required | Polls the latest processed Base64 video frame and telemetry data |
| `/api/latest_frame/<id>` | `GET` | Required | Retrieves the latest cached Base64 frame for a specific camera |
| `/api/snapshot/<id>` | `GET` | Required | Returns binary JPEG image of the current frame |

### Incidents & Guard Dispatch
| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/api/incidents` | `GET` | Required | Returns all logged security incidents ordered by timestamp |
| `/api/incidents/clear` | `POST` | Admin | Clears incident history optionally filtered by type |
| `/api/guard/alerts` | `GET` | Required | Polls active unresolved incidents for mobile guard patrol interface |
| `/api/guard/respond/<id>`| `POST` | Required | Updates incident status (`investigating`, `resolved`) |
| `/api/upload_test` | `POST` | Required | Executes multi-model detection on uploaded test media files |
| `/api/stats` | `GET` | Required | Returns runtime telemetry (models loaded, active threads, GPU status) |

---

