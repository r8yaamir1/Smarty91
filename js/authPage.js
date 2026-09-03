// Authentication & Secure VIP Direct Access Script for Smarty91 VIP

function showToast(msg, duration = 3000) {
    const toast = document.getElementById('auth-toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}

// Global Tab switcher with smooth animated transitions
window.switchAuthTab = function(tab) {
    const loginBtn = document.getElementById('tab-login-btn');
    const regBtn = document.getElementById('tab-register-btn');
    const tabsWrap = document.getElementById('auth-tabs-wrap');
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const forgotForm = document.getElementById('forgot-form');

    const forms = [loginForm, regForm, forgotForm];
    forms.forEach(f => {
        if (f) {
            f.classList.remove('active');
            f.style.display = 'none';
        }
    });

    if (tab === 'login') {
        if (tabsWrap) tabsWrap.style.display = 'flex';
        if (loginBtn) loginBtn.classList.add('active');
        if (regBtn) regBtn.classList.remove('active');
        if (loginForm) {
            loginForm.style.display = 'block';
            // Trigger animation restart cleanly
            void loginForm.offsetWidth;
            loginForm.classList.add('active');
        }
    } else if (tab === 'register') {
        if (tabsWrap) tabsWrap.style.display = 'flex';
        if (loginBtn) loginBtn.classList.remove('active');
        if (regBtn) regBtn.classList.add('active');
        if (regForm) {
            regForm.style.display = 'block';
            void regForm.offsetWidth;
            regForm.classList.add('active');
        }
    } else if (tab === 'forgot') {
        if (tabsWrap) tabsWrap.style.display = 'none';
        if (forgotForm) {
            forgotForm.style.display = 'block';
            void forgotForm.offsetWidth;
            forgotForm.classList.add('active');
        }
    }
};

window.togglePasswordVisibility = function(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
};

// Toggle additional register fields (Security PIN & Invite Code) with smooth animation
window.toggleExtraRegisterFields = function() {
    const extraBox = document.getElementById('reg-extra-fields');
    const icon = document.getElementById('expand-icon');
    if (!extraBox) return;
    if (extraBox.style.display === 'none' || !extraBox.style.display) {
        extraBox.style.display = 'block';
        extraBox.style.animation = 'itemPop 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        if (icon) {
            icon.innerText = '▲';
            icon.style.color = '#FFD700';
        }
    } else {
        extraBox.style.display = 'none';
        if (icon) {
            icon.innerText = '▼';
            icon.style.color = '#9ca3af';
        }
    }
};

// Check query param for invite code (e.g. login.html?ref=SM1234)
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref') || params.get('invite');
    if (ref) {
        window.switchAuthTab('register');
        const inviteInput = document.getElementById('reg-invite-code');
        if (inviteInput) inviteInput.value = ref.toUpperCase();
        // Auto expand extra fields
        const extraBox = document.getElementById('reg-extra-fields');
        const icon = document.getElementById('expand-icon');
        if (extraBox) extraBox.style.display = 'block';
        if (icon) icon.innerText = '▲';
    }
});

// Handle Login Submit
window.handleLoginSubmit = async function(e) {
    e.preventDefault();
    const phone = document.getElementById('login-phone').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit-btn');

    if (!/^[6-9]\d{9}$/.test(phone)) {
        showToast('Please enter a valid 10-digit mobile number (starting with 6-9)');
        return;
    }
    if (!password) {
        showToast('Please enter your password');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Verifying VIP Credentials...');
        btn.disabled = true;
        btn.innerText = 'Logging in...';

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Login failed');
            btn.disabled = false;
            btn.innerText = 'Log In';
            return;
        }

        // Store secure session
        localStorage.setItem('smarty91_auth_token', data.token);
        localStorage.setItem('smarty91_user_id', data.user.id);
        localStorage.setItem('smarty91_user_phone', data.user.phone);
        localStorage.setItem('smarty91_invite_code', data.user.inviteCode);
        localStorage.setItem('smarty91_cached_balance', (data.user.balance || 0).toString());

        showToast('Login Successful! Redirecting...');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 600);
    } catch (err) {
        showToast('Network error during login');
        btn.disabled = false;
        btn.innerText = 'Log In';
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
};

// Handle Register Submit (Direct Fast Registration - 91 Club Style)
window.handleRegisterSubmit = async function(e) {
    e.preventDefault();
    const phone = document.getElementById('reg-phone').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;
    const securityPin = document.getElementById('reg-pin') ? document.getElementById('reg-pin').value.trim() : '';
    const inviteCode = document.getElementById('reg-invite-code') ? document.getElementById('reg-invite-code').value.trim().toUpperCase() : '';
    const btn = document.getElementById('reg-submit-btn');

    if (!/^[6-9]\d{9}$/.test(phone)) {
        showToast('Please enter a valid 10-digit mobile number (starting with 6-9)');
        return;
    }
    if (password.length < 6) {
        showToast('Password must be at least 6 characters');
        return;
    }
    if (password !== confirmPassword) {
        showToast('Passwords do not match');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Creating VIP Account...');
        btn.disabled = true;
        btn.innerText = 'Creating VIP account...';

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password, inviteCode, securityPin })
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Registration failed');
            btn.disabled = false;
            btn.innerText = 'Register & Play';
            return;
        }

        // Store secure session
        localStorage.setItem('smarty91_auth_token', data.token);
        localStorage.setItem('smarty91_user_id', data.user.id);
        localStorage.setItem('smarty91_user_phone', data.user.phone);
        localStorage.setItem('smarty91_invite_code', data.user.inviteCode);
        localStorage.setItem('smarty91_cached_balance', '0.00'); // Clean zero balance for all new registrations

        showToast('Account Created! Welcome to Smarty91 VIP');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 800);
    } catch (err) {
        showToast('Network error during registration');
        btn.disabled = false;
        btn.innerText = 'Register & Play';
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
};

// Handle Forgot Password Submit (Security PIN or Admin Master Reset)
window.handleForgotPasswordSubmit = async function(e) {
    e.preventDefault();
    const phone = document.getElementById('forgot-phone').value.trim();
    const securityPin = document.getElementById('forgot-pin').value.trim();
    const newPassword = document.getElementById('forgot-new-password').value;
    const confirmPassword = document.getElementById('forgot-confirm-password').value;
    const btn = document.getElementById('forgot-submit-btn');

    if (!/^[6-9]\d{9}$/.test(phone)) {
        showToast('Please enter a valid 10-digit mobile number');
        return;
    }
    if (!securityPin) {
        showToast('Please enter your Security PIN (or last 4 digits of your phone)');
        return;
    }
    if (newPassword.length < 6) {
        showToast('New password must be at least 6 characters');
        return;
    }
    if (newPassword !== confirmPassword) {
        showToast('Passwords do not match');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Resetting Password...');
        btn.disabled = true;
        btn.innerText = 'Updating password...';

        const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, newPassword, securityPin })
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Password reset failed');
            btn.disabled = false;
            btn.innerText = 'Update Password';
            return;
        }

        showToast('Password updated successfully! Please log in now with your new password');
        setTimeout(() => {
            window.switchAuthTab('login');
            const loginPhone = document.getElementById('login-phone');
            if (loginPhone) loginPhone.value = phone;
            btn.disabled = false;
            btn.innerText = 'Update Password';
        }, 1200);
    } catch (err) {
        showToast('Network error during password reset');
        btn.disabled = false;
        btn.innerText = 'Update Password';
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
};
