import sqlite3
p='instance/campus_guard.db'
print('Upgrading',p)
conn=sqlite3.connect(p)
c=conn.cursor()
commands=[
    "ALTER TABLE cameras ADD COLUMN source_type VARCHAR(20) DEFAULT 'ip'",
    "ALTER TABLE cameras ADD COLUMN device_id VARCHAR(50)",
    "ALTER TABLE cameras ADD COLUMN incident_delay INTEGER DEFAULT 5",
    "ALTER TABLE cameras ADD COLUMN last_incident DATETIME",
    "ALTER TABLE cameras ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE camera_monitors ADD COLUMN last_detection DATETIME",
    "ALTER TABLE camera_monitors ADD COLUMN detection_count INTEGER DEFAULT 0",
    "ALTER TABLE camera_monitors ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
]
for cmd in commands:
    try:
        c.execute(cmd)
        print('OK:',cmd)
    except Exception as e:
        print('SKIP/ERR:',cmd, '->', e)
conn.commit()
conn.close()
print('Done')
