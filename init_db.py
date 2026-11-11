from app import app, db, User, Camera

def init_sample_data():
    with app.app_context():
        # Create tables
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
            print("✅ Admin user created: admin / admin123")
        
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
            print("✅ Security user created: security / security123")
        
        # Create sample cameras
        if not Camera.query.first():
            cameras = [
                Camera(location='Main Gate', stream_url='', status='active'),
                Camera(location='Library Entrance', stream_url='', status='active'),
                Camera(location='Student Center', stream_url='', status='active'),
                Camera(location='Parking Lot', stream_url='', status='active'),
                Camera(location='Sports Complex', stream_url='', status='maintenance')
            ]
            db.session.add_all(cameras)
            print("✅ Sample cameras created")
        
        db.session.commit()
        print("✅ Database initialized successfully!")

if __name__ == '__main__':
    init_sample_data()