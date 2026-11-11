"""Add camera device support migration

This script updates the database schema to support webcam and external camera devices.
"""
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
import sqlite3
import os

def upgrade():
    # Connect to the database
    conn = sqlite3.connect('campus_guard.db')
    cursor = conn.cursor()

    # Add new columns to cameras table
    try:
        cursor.execute('''
            ALTER TABLE cameras 
            ADD COLUMN source_type VARCHAR(20) DEFAULT 'ip'
        ''')
    except sqlite3.OperationalError:
        print("source_type column already exists")

    try:
        cursor.execute('''
            ALTER TABLE cameras 
            ADD COLUMN device_id VARCHAR(50)
        ''')
    except sqlite3.OperationalError:
        print("device_id column already exists")

    try:
        cursor.execute('''
            ALTER TABLE cameras 
            ADD COLUMN incident_delay INTEGER DEFAULT 5
        ''')
    except sqlite3.OperationalError:
        print("incident_delay column already exists")

    try:
        cursor.execute('''
            ALTER TABLE cameras 
            ADD COLUMN last_incident DATETIME
        ''')
    except sqlite3.OperationalError:
        print("last_incident column already exists")

    try:
        cursor.execute('''
            ALTER TABLE cameras 
            ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ''')
    except sqlite3.OperationalError:
        print("updated_at column already exists")

    # Add new columns to camera_monitors table
    try:
        cursor.execute('''
            ALTER TABLE camera_monitors 
            ADD COLUMN last_detection DATETIME
        ''')
    except sqlite3.OperationalError:
        print("last_detection column already exists")

    try:
        cursor.execute('''
            ALTER TABLE camera_monitors 
            ADD COLUMN detection_count INTEGER DEFAULT 0
        ''')
    except sqlite3.OperationalError:
        print("detection_count column already exists")

    try:
        cursor.execute('''
            ALTER TABLE camera_monitors 
            ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ''')
    except sqlite3.OperationalError:
        print("updated_at column already exists")

    # Update existing cameras to have source_type
    cursor.execute('''
        UPDATE cameras 
        SET source_type = 'ip' 
        WHERE source_type IS NULL
    ''')

    # Commit changes and close connection
    conn.commit()
    conn.close()

if __name__ == '__main__':
    print("Applying camera device support migration...")
    upgrade()
    print("Migration completed successfully!")