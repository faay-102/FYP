// Authentication related JavaScript functionality

document.addEventListener('DOMContentLoaded', function() {
    // Form validation for login and register forms
    const authForms = document.querySelectorAll('#loginForm, #registerForm, .payoneer-form');
    
    authForms.forEach(form => {
        const requiredInputs = form.querySelectorAll('input[required]');

        // Clear error style on input
        requiredInputs.forEach(input => {
            input.addEventListener('input', function() {
                if (this.value.trim()) {
                    this.style.borderColor = '';
                }
            });
        });

        form.addEventListener('submit', function(e) {
            let valid = true;
            
            requiredInputs.forEach(input => {
                if (!input.value.trim()) {
                    valid = false;
                    input.style.borderColor = '#ef4444';
                } else {
                    input.style.borderColor = '';
                }
            });
            
            if (!valid) {
                e.preventDefault();
                showNotification('Please fill in all required fields.', 'error');
            }
        });
    });
    
    // Password strength indicator ONLY for registration form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        const passwordInput = registerForm.querySelector('#password');
        if (passwordInput) {
            passwordInput.addEventListener('input', function() {
                if (!this.value) {
                    const indicator = document.getElementById('passwordStrength');
                    if (indicator) indicator.textContent = '';
                    return;
                }
                const strength = checkPasswordStrength(this.value);
                updatePasswordStrengthIndicator(strength);
            });
        }
    }

    // Auto-dismiss flash messages after delay
    const flashMessages = document.querySelectorAll('.flash-message');
    flashMessages.forEach(message => {
        setTimeout(() => {
            message.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            message.style.opacity = '0';
            message.style.transform = 'translateY(-8px)';
            setTimeout(() => message.remove(), 400);
        }, 5000);
    });
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
    if (!indicator) return;
    
    let message = '';
    let color = '#ef4444';
    
    switch (strength) {
        case 0:
        case 1:
            message = 'Weak (minimum 8 chars, mixed case & numbers recommended)';
            color = '#ef4444';
            break;
        case 2:
            message = 'Fair';
            color = '#f59e0b';
            break;
        case 3:
            message = 'Moderate';
            color = '#eab308';
            break;
        case 4:
            message = 'Strong';
            color = '#10b981';
            break;
        case 5:
            message = 'Very Strong';
            color = '#059669';
            break;
    }
    
    indicator.textContent = `Strength: ${message}`;
    indicator.style.color = color;
}

function createPasswordStrengthIndicator() {
    const passwordInput = document.querySelector('#registerForm #password') || document.querySelector('#password');
    if (!passwordInput) return null;

    const parentContainer = passwordInput.closest('.cyber-form-group') || passwordInput.closest('.cyber-input-wrap') || passwordInput.closest('.pill-input-container') || passwordInput.parentElement;
    if (!parentContainer) return null;

    const indicator = document.createElement('div');
    indicator.id = 'passwordStrength';
    indicator.style.fontSize = '0.78rem';
    indicator.style.marginTop = '0.35rem';
    indicator.style.fontWeight = '600';
    indicator.style.fontFamily = 'var(--font-sans, sans-serif)';
    indicator.style.transition = 'all 0.2s ease';
    parentContainer.appendChild(indicator);
    return indicator;
}

function showNotification(message, type = 'info') {
    let container = document.querySelector('.flash-messages');
    if (!container) {
        container = document.createElement('div');
        container.className = 'flash-messages';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `flash-message ${type}`;
    notification.textContent = message;
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-8px)';
        setTimeout(() => notification.remove(), 400);
    }, 5000);
}
