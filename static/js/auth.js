// Authentication related JavaScript functionality

document.addEventListener('DOMContentLoaded', function() {
    // Form validation for login and register forms
    const forms = document.querySelectorAll('form');
    
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const inputs = this.querySelectorAll('input[required]');
            let valid = true;
            
            inputs.forEach(input => {
                if (!input.value.trim()) {
                    valid = false;
                    input.style.borderColor = '#e74c3c';
                } else {
                    input.style.borderColor = '#e9ecef';
                }
            });
            
            if (!valid) {
                e.preventDefault();
                showNotification('Please fill in all required fields', 'error');
            }
        });
    });
    
    // Password strength indicator for registration
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.addEventListener('input', function() {
            const strength = checkPasswordStrength(this.value);
            updatePasswordStrengthIndicator(strength);
        });
    }
});

function checkPasswordStrength(password) {
    let strength = 0;
    
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/)) strength++;
    if (password.match(/[A-Z]/)) strength++;
    if (password.match(/[0-9]/)) strength++;
    if (password.match(/[^a-zA-Z0-9]/)) strength++;
    
    return strength;
}

function updatePasswordStrengthIndicator(strength) {
    const indicator = document.getElementById('passwordStrength') || createPasswordStrengthIndicator();
    
    let message = '';
    let color = '#e74c3c';
    
    switch (strength) {
        case 0:
        case 1:
            message = 'Very Weak';
            color = '#e74c3c';
            break;
        case 2:
            message = 'Weak';
            color = '#e67e22';
            break;
        case 3:
            message = 'Medium';
            color = '#f39c12';
            break;
        case 4:
            message = 'Strong';
            color = '#27ae60';
            break;
        case 5:
            message = 'Very Strong';
            color = '#2ecc71';
            break;
    }
    
    indicator.textContent = `Password Strength: ${message}`;
    indicator.style.color = color;
}

function createPasswordStrengthIndicator() {
    const passwordGroup = document.querySelector('#password').closest('.form-group');
    const indicator = document.createElement('div');
    indicator.id = 'passwordStrength';
    indicator.style.fontSize = '0.8rem';
    indicator.style.marginTop = '0.5rem';
    passwordGroup.appendChild(indicator);
    return indicator;
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `flash-message ${type}`;
    notification.textContent = message;
    
    // Add to flash messages container or create one
    let container = document.querySelector('.flash-messages');
    if (!container) {
        container = document.createElement('div');
        container.className = 'flash-messages';
        document.body.appendChild(container);
    }
    
    container.appendChild(notification);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Auto-hide flash messages after delay
document.addEventListener('DOMContentLoaded', function() {
    const flashMessages = document.querySelectorAll('.flash-message');
    flashMessages.forEach(message => {
        setTimeout(() => {
            message.style.opacity = '0';
            setTimeout(() => message.remove(), 300);
        }, 5000);
    });
});