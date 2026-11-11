from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime
import hashlib

db = SQLAlchemy()

class User(UserMixin, db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='student')
    department = db.Column(db.String(100))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    incidents = db.relationship('Incident', backref='reported_by', lazy=True)
    
    def set_password(self, password):
        self.password_hash = hashlib.sha256(password.encode('utf-8')).hexdigest()
    
    def check_password(self, password):
        return self.password_hash == hashlib.sha256(password.encode('utf-8')).hexdigest()

class Camera(db.Model):
    __tablename__ = 'cameras'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    location = db.Column(db.String(200), nullable=False)
    source_type = db.Column(db.String(20), nullable=False, default='ip')  # webcam, external, ip
    device_id = db.Column(db.String(50))  # For webcam/external camera device ID
    stream_url = db.Column(db.String(500))  # For IP camera URL
    status = db.Column(db.String(20), default='active')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    incident_delay = db.Column(db.Integer, default=5)  # Seconds to wait before creating incident
    last_incident = db.Column(db.DateTime)  # Timestamp of last created incident
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    detections = db.relationship('AnomalyDetection', backref='camera', lazy=True)
    incidents = db.relationship('Incident', backref='camera', lazy=True)

class Incident(db.Model):
    __tablename__ = 'incidents'
    
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    incident_type = db.Column(db.String(50), nullable=False)
    severity = db.Column(db.String(20), default='medium')
    location = db.Column(db.String(200))
    camera_id = db.Column(db.Integer, db.ForeignKey('cameras.id'))
    reported_by_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    confidence_score = db.Column(db.Float)
    video_evidence_path = db.Column(db.String(500))
    frame_evidence = db.Column(db.Text)  # Base64 encoded frame
    status = db.Column(db.String(20), default='reported')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    resolved_at = db.Column(db.DateTime)

class AnomalyDetection(db.Model):
    __tablename__ = 'anomaly_detections'
    
    id = db.Column(db.Integer, primary_key=True)
    camera_id = db.Column(db.Integer, db.ForeignKey('cameras.id'))
    detection_type = db.Column(db.String(50), nullable=False)
    confidence = db.Column(db.Float)
    frame_data = db.Column(db.Text)
    students_detected = db.Column(db.Integer, default=0)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class SystemLog(db.Model):
    __tablename__ = 'system_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    action = db.Column(db.String(200), nullable=False)
    module = db.Column(db.String(50))
    ip_address = db.Column(db.String(45))
    user_agent = db.Column(db.String(500))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class CameraMonitor(db.Model):
    __tablename__ = 'camera_monitors'
    
    id = db.Column(db.Integer, primary_key=True)
    camera_id = db.Column(db.Integer, db.ForeignKey('cameras.id'))
    model_type = db.Column(db.String(50), nullable=False)  # fight, sleep, suspicious, normal
    is_active = db.Column(db.Boolean, default=False)
    confidence_threshold = db.Column(db.Float, default=0.75)
    last_detection = db.Column(db.DateTime)  # Timestamp of last detection
    detection_count = db.Column(db.Integer, default=0)  # Count of detections
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    camera = db.relationship('Camera', backref='monitors')