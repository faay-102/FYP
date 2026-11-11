import sqlite3
p='instance/campus_guard.db'
print('Adding updated_at columns to',p)
conn=sqlite3.connect(p)
c=conn.cursor()
commands=[
    "ALTER TABLE cameras ADD COLUMN updated_at DATETIME",
    "ALTER TABLE camera_monitors ADD COLUMN updated_at DATETIME"
]
for cmd in commands:
    try:
        c.execute(cmd)
        print('OK:',cmd)
    except Exception as e:
        print('SKIP/ERR:',cmd,'->',e)
conn.commit()
conn.close()
print('Done')
