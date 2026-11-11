import sqlite3
p='instance/campus_guard.db'
conn=sqlite3.connect(p)
c=conn.cursor()
c.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables=c.fetchall()
print('Tables in',p,':',tables)
for t in tables:
    name=t[0]
    print('\nSchema for',name)
    for row in c.execute("PRAGMA table_info('"+name+"')"):
        print(row)
conn.close()
