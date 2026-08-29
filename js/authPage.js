// Authentication Page Script for Smarty91
function showToast(msg, duration = 2500) {
    const toast = document.getElementById('auth-toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}

// Global Tab switcher
window.switchAuthTab = function(tab) {
    const loginBtn = document.getElementById('tab-login-btn');
    const regBtn = document.getElementById('tab-register-btn');
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');

    if (tab === 'login') {
        loginBtn.classList.add('active');
        regBtn.classList.remove('active');
        loginForm.style.display = 'block';
        regForm.style.display = 'none';
    } else {
        loginBtn.classList.remove('active');
        regBtn.classList.add('active');
        loginForm.style.display = 'none';
        regForm.style.display = 'block';
    }
};

window.togglePasswordVisibility = function(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
};

// Check query param for invite code (e.g. login.html?ref=SM1234)
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref') || params.get('invite');
    if (ref) {
        window.switchAuthTab('register');
        const inviteInput = document.getElementById('reg-invite-code');
        if (inviteInput) inviteInput.value = ref.toUpperCase();
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
        }, 800);
    } catch (err) {
        showToast('Network error during login');
        btn.disabled = false;
        btn.innerText = 'Log In';
    }
};

// Handle Register Submit
window.handleRegisterSubmit = async function(e) {
    e.preventDefault();
    const phone = document.getElementById('reg-phone').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;
    const inviteCode = document.getElementById('reg-invite-code').value.trim().toUpperCase();
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
        btn.disabled = true;
        btn.innerText = 'Creating account...';

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password, inviteCode })
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
        localStorage.setItem('smarty91_cached_balance', (data.user.balance || 0).toString());

        showToast('Account Created! Welcome to Smarty91');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 900);
    } catch (err) {
        showToast('Network error during registration');
        btn.disabled = false;
        btn.innerText = 'Register & Play';
    }
};
