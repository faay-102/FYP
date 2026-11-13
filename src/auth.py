from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, login_required, current_user
try:
    from .database import db, User, SystemLog
except ImportError:
    from database import db, User, SystemLog

auth = Blueprint('auth', __name__)

@auth.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        identifier = (request.form.get('username') or '').strip()
        password = request.form.get('password') or ''
        
        if not identifier or not password:
            flash('Please enter both username/email and password.', 'error')
            return render_template('login.html')

        user = User.query.filter(
            (User.username == identifier) | (User.email == identifier)
        ).first()
        
        if user and user.check_password(password):
            if not user.is_active:
                flash('Your account has been deactivated. Please contact security administration.', 'error')
                return render_template('login.html')

            login_user(user)
            
            # Log login action
            try:
                log = SystemLog(
                    user_id=user.id,
                    action=f"User {user.username} logged in",
                    module="Authentication",
                    ip_address=request.remote_addr,
                    user_agent=request.headers.get('User-Agent')
                )
                db.session.add(log)
                db.session.commit()
            except Exception:
                db.session.rollback()
            
            flash(f'Welcome back, {user.username}!', 'success')
            next_page = request.args.get('next')
            if next_page and next_page.startswith('/'):
                return redirect(next_page)
            return redirect(url_for('dashboard'))
        else:
            flash('Invalid username/email or password.', 'error')
    
    return render_template('login.html')

@auth.route('/logout')
@login_required
def logout():
    try:
        log = SystemLog(
            user_id=current_user.id,
            action=f"User {current_user.username} logged out",
            module="Authentication",
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent')
        )
        db.session.add(log)
        db.session.commit()
    except Exception:
        db.session.rollback()
    
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('auth.login'))

@auth.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        email = (request.form.get('email') or '').strip().lower()
        password = request.form.get('password') or ''
        role = request.form.get('role', 'student')
        department = (request.form.get('department') or '').strip()
        
        if not username or not email or not password:
            flash('Username, email, and password are required.', 'error')
            return render_template('register.html')
        
        if len(username) < 3:
            flash('Username must be at least 3 characters.', 'error')
            return render_template('register.html')

        if len(password) < 6:
            flash('Password must be at least 6 characters.', 'error')
            return render_template('register.html')

        if User.query.filter_by(username=username).first():
            flash('Username already exists. Please choose another.', 'error')
            return render_template('register.html')
        
        if User.query.filter_by(email=email).first():
            flash('Email already registered. Please log in or use another email.', 'error')
            return render_template('register.html')
        
        # Valid roles whitelist
        allowed_roles = ['student', 'faculty', 'security']
        if role not in allowed_roles:
            role = 'student'

        user = User(
            username=username,
            email=email,
            role=role,
            department=department
        )
        user.set_password(password)
        
        try:
            db.session.add(user)
            db.session.commit()

            # Log registration action
            log = SystemLog(
                user_id=user.id,
                action=f"New user registered: {username} ({role})",
                module="Authentication",
                ip_address=request.remote_addr,
                user_agent=request.headers.get('User-Agent')
            )
            db.session.add(log)
            db.session.commit()
        except Exception:
            db.session.rollback()
            flash('Registration failed due to a database error. Please try again.', 'error')
            return render_template('register.html')
        
        flash('Registration successful! Please log in with your credentials.', 'success')
        return redirect(url_for('auth.login'))
    
    return render_template('register.html')


