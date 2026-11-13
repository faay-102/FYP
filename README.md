# CampusGuard AI
**An Autonomous, Real-Time Video Surveillance & Security Framework for Educational Campuses**  

---

CampusGuard AI is an automated, real-time video surveillance system engineered to transform campus CCTV networks into proactive, intelligent safety monitoring centers. Powered by the state-of-the-art **YOLOv11** deep learning architecture, the platform continuously analyzes live video streams and media files to detect physical fights, student drowsiness or medical collapse, unauthorized loitering in restricted perimeters, and prohibited mobile device usage.

The platform combines multi-camera stream processing, an intuitive **1-Click AI Benchmark Dropzone**, automated incident evidence capture with photographic snapshots, real-time audio synthesizer alarms, and a dedicated **Mobile Guard Patrol Command (`/guard`)** interface for on-duty responders.

---

## Key Capabilities

- **Single-Click Live Surveillance:** Instantly stream video from laptop webcams, external USB cameras, or IP network feeds (RTSP/HTTP) with real-time YOLOv11 bounding boxes.
- **1-Click Instant AI Benchmark:** Drag & drop any photo or video directly on the dashboard to test all AI models (*Fight*, *Sleep*, *Loitering*, *Person Detection*) and trigger immediate alarms.
- **Automated Incident Logging:** Generates incident records with Base64 visual evidence snapshots and anti-spam cooldown timers to prevent duplicate alerts.
- **Mobile Guard Patrol Command (`/guard`):** Full-width, mobile-optimized dispatch interface featuring real-time incident polling, two-tone synthesizer emergency sirens, and status updating (*Responding*, *Resolved*).
- **Security Incident Archives (`/incidents`):** Filter historical security records by severity (*Low*, *Medium*, *High*, *Critical*) or status, with clickable full-resolution photographic evidence modals.
- **Modern CyberGuard Theme:** Professional dark teal and forest green SaaS aesthetic with crisp typography and high-contrast telemetry indicators.

---

## AI Detection Models & Dataset Specifications

CampusGuard AI utilizes a multi-model YOLOv11 neural network pipeline fine-tuned on specialized public, academic, and domain-specific datasets. Click any dataset name below to open its official repository or benchmark page:

| Model / Threat Head | Model Architecture | Datasets Used for Training (Clickable Links) | Primary Detection Objective & Classes | Operational Heuristic | Target Zone |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Fight Detection** (`fight.pt`) | YOLOv11s (Custom Weights) | • [RWF-2000 (GitHub)](https://github.com/mchengny/RWF2000-Video-Database-for-Violence-Detection)<br>• [Hockey Fight (Kaggle)](https://www.kaggle.com/datasets/yasserh/hockey-fight-vidoes)<br>• [UCF-Crime (CRCV)](https://www.crcv.ucf.edu/research/projects/real-world-anomaly-detection-in-surveillance-videos/) | Physical altercations, brawls, aggressive grappling (`fight`, `violence`) | Spatial clustering & bounding box intersection of 2+ individuals with high confidence | Cafeterias, sports grounds, parking areas |
| **Sleep / Inactivity** (`sleep.pt`) | YOLOv11s (Custom Weights) | • [SCB-Dataset (GitHub)](https://github.com/Whiffe/SCB-dataset)<br>• [Roboflow Posture Hub](https://universe.roboflow.com/search?q=classroom+sleep) | Sleeping postures, recumbent collapse, head resting on desk (`sleeping`, `inactivity`) | Torso angle, horizontal head orientation, and sustained inactivity | Classrooms, exam halls, libraries |
| **Suspicious Loitering** (`yolov11m.pt`) | YOLOv11m (Medium Weights) | • [MS COCO 2017](https://cocodataset.org/) (`person` class) | Unauthorized lingering, perimeter intrusion, nighttime pacing | Spatio-temporal Euclidean centroid tracker (flags dwell time $\ge$ 4 minutes) | Server rooms, boundary fences, vaults |
| **Phone Detection** (`yolov11s.pt`) | YOLOv11s (Small Weights) | • [MS COCO 2017](https://cocodataset.org/) (`cell phone` class) | Prohibited mobile device usage during examinations | High-confidence object classification matching mobile device classes | Examination halls, testing centers |
| **Normal Surveillance** (`yolov11s.pt`) | YOLOv11s (Small Weights) | • [MS COCO 2017](https://cocodataset.org/) & [Ultralytics Hub](https://docs.ultralytics.com/datasets/detect/coco/) | Baseline crowd estimation, person tracking, backpack/bag detection | Multi-class object detection and real-time student counting | Corridors, campus walkways, main gates |

---

### Training & Fine-Tuning Pipeline

- **Architecture Base:** Ultralytics YOLOv11 (PyTorch tensor backend with CSPDarknet backbone, C3k2 modules, and decoupled detection heads).
- **Input Resolution:** $640 \times 640$ pixels with multi-scale training ($320$ to $800$ px).
- **Data Augmentation:** Mosaic augmentation ($p=1.0$), Mixup ($p=0.15$), HSV color-space jittering, random horizontal flips, and perspective transformations.
- **Loss Functions:** Complete Intersection over Union (CIoU) bounding box loss, Distribution Focal Loss (DFL), and Binary Cross-Entropy (BCE) classification loss.
- **Optimization:** AdamW optimizer ($\beta_1=0.9, \beta_2=0.999$, weight decay $0.0005$, initial learning rate $0.01$ with cosine annealing learning rate scheduler over 100 epochs).
- **Inference Latency:** $\sim 8.2\text{ ms}$ on NVIDIA RTX 3060 (CUDA) / $\sim 45\text{ ms}$ on Intel Core i7 (CPU mode).

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
|   - Buffer Management (CAP_PROP_BUFFERSIZE = 1) to eliminate video lag            |
|   - Frame Normalization & uint8 RGB/BGR Conversion                                |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                           AI NEURAL INFERENCE ENGINE                              |
|   Ultralytics YOLOv11 Pipeline (CUDA GPU Accelerated / CPU Fallback)              |
|   [Fight Detection]  [Sleep Detection]  [Loitering Tracker]  [Phone Detection]    |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        ANOMALY ARBITRATION & DISPATCH                             |
|   - Confidence Threshold Verification                                             |
|   - Anti-Spam Incident Cooldown Timer (5-minute suppression window)               |
+-------------------+-------------------------------------------+-------------------+
                    |                                           |
                    v                                           v
+---------------------------------------+   +---------------------------------------+
|           DATA PERSISTENCE            |   |          LIVE TELEMETRY BUFFER        |
|   SQLite Database (SQLAlchemy ORM)    |   |   Thread-Safe FIFO Queue              |
|   - Users, Cameras, Monitor Mappings  |   |   - Real-time JSON Telemetry          |
|   - Incident Evidence & Snapshots     |   |   - Base64 JPEG Stream Frames         |
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

| Category | Component | Purpose |
| :--- | :--- | :--- |
| **Language** | Python 3.8+ | Core application runtime and computer vision pipeline |
| **Web Framework** | Flask 2.3+ | WSGI application server, REST APIs, and template rendering |
| **ORM & Database** | Flask-SQLAlchemy / SQLite | Relational database modeling and structured incident storage |
| **Authentication** | Flask-Login & bcrypt | Session management, password hashing, and role verification |
| **Deep Learning** | Ultralytics YOLOv11 | Real-time object detection and anomaly inference |
| **ML Computation**| PyTorch & Torchvision | Tensor computation with automatic CUDA GPU acceleration |
| **Computer Vision**| OpenCV (`cv2`) | Video stream ingestion, frame transformation, and buffer decoding |
| **Frontend** | HTML5 / Modern CSS / Vanilla JS | Responsive UI, AJAX polling, and Web Audio API synthesizer |

---

## Hardware & System Requirements

| Specification | Evaluation / CPU Mode | Recommended Production / GPU Mode |
| :--- | :--- | :--- |
| **Processor** | Intel Core i5 (8th Gen+) / AMD Ryzen 5 | Intel Core i7 (10th Gen+) / AMD Ryzen 7 |
| **RAM** | 8 GB DDR4 | 16 GB DDR4/DDR5 |
| **Graphics (GPU)**| Integrated Graphics (CPU inference) | NVIDIA RTX 3060 or higher (8 GB+ VRAM, CUDA 11.8+) |
| **Storage** | 5 GB available disk space | 256 GB+ NVMe SSD |
| **Operating System**| Windows 10/11 (64-bit) or Ubuntu 20.04/22.04 | Windows 11 (64-bit) or Ubuntu 22.04 LTS |
| **Video Input** | Built-in 720p HD webcam | Multi-channel RTSP IP cameras or USB HD cameras |

---

## Installation & Setup

### 1. Clone Repository & Setup Virtual Environment
```bash
git clone https://github.com/faay-102/FYP.git
cd FYP

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt

# Optional: CUDA Acceleration for NVIDIA GPUs
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 3. Verify Model Weights
Ensure detection weights are present in the `models/` directory:
- `models/fight.pt`
- `models/sleep.pt`
- `models/yolov11m.pt`
- `models/yolov11s.pt` (fallback)

### 4. Run the Application
```bash
python src/app.py
```
Open `http://127.0.0.1:5000` in your web browser. The database initializes automatically on startup.

---

## Default Access Credentials

| Role | Username | Password | Purpose |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `admin123` | Full administrative control, camera configuration, audit logs |
| **Security Officer** | `security` | `security123` | Real-time monitoring, incident review, guard patrol portal |

---

## Application Usage Guide

### 1. Live Camera Surveillance (`/dashboard`)
- Click **`Start Camera`** to turn on live webcam/video monitoring.
- The system renders real-time YOLOv11 bounding boxes and displays live FPS and object counters.

### 2. Instant AI Test & Alarm Trigger (`/dashboard`)
- Drag & drop any photo or video into the **Instant AI Test** card.
- Click **`⚡ Run AI Detection & Sound Alarm`**.
- The platform runs inference, displays the detection boxes, logs the incident with photographic evidence, and sounds the emergency alarm.

### 3. Mobile Guard Patrol Command (`/guard`)
- Full-width mobile responder dashboard for on-duty security officers.
- Automatically polls for active incidents and plays a two-tone synthesizer emergency siren when threats occur.
- Officers can inspect evidence snapshots and acknowledge dispatches.

### 4. Incident Archives (`/incidents`)
- Browse all recorded security incidents.
- Filter by status (*Reported*, *Investigating*, *Resolved*) or severity.
- Click any evidence thumbnail to preview the full-resolution photographic evidence modal.
