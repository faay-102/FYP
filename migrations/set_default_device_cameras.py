"""Set first two cameras to use local webcam/external device ids

This script updates instance/campus_guard.db so that the first camera uses
source_type='webcam' and device_id='0' and the second camera (if exists)
uses source_type='external' and device_id='1'. This helps map existing
placeholder cameras to local devices on a laptop.
"""
import sqlite3

DB='instance/campus_guard.db'
conn=sqlite3.connect(DB)
c=conn.cursor()

# Get cameras ordered by id
c.execute("SELECT id, name FROM cameras ORDER BY id ASC")
cams = c.fetchall()
print('Found cameras:', cams)

if len(cams) >= 1:
    cid = cams[0][0]
    try:
        c.execute("UPDATE cameras SET source_type=?, device_id=? WHERE id=?", ('webcam', '0', cid))
        print(f'Updated camera {cid} -> webcam device 0')
    except Exception as e:
        print('Error updating camera 1:', e)

if len(cams) >= 2:
    cid = cams[1][0]
    try:
        c.execute("UPDATE cameras SET source_type=?, device_id=? WHERE id=?", ('external', '1', cid))
        print(f'Updated camera {cid} -> external device 1')
    except Exception as e:
        print('Error updating camera 2:', e)

conn.commit()
conn.close()
print('Done')
