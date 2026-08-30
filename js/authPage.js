// Authentication & Fast2SMS OTP Page Script for Smarty91 VIP

function showToast(msg, duration = 3000) {
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
    const tabsWrap = document.getElementById('auth-tabs-wrap');
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const forgotForm = document.getElementById('forgot-form');

    if (tab === 'login') {
        if (tabsWrap) tabsWrap.style.display = 'flex';
        if (loginBtn) loginBtn.classList.add('active');
        if (regBtn) regBtn.classList.remove('active');
        if (loginForm) loginForm.style.display = 'block';
        if (regForm) regForm.style.display = 'none';
        if (forgotForm) forgotForm.style.display = 'none';
    } else if (tab === 'register') {
        if (tabsWrap) tabsWrap.style.display = 'flex';
        if (loginBtn) loginBtn.classList.remove('active');
        if (regBtn) regBtn.classList.add('active');
        if (loginForm) loginForm.style.display = 'none';
        if (regForm) regForm.style.display = 'block';
        if (forgotForm) forgotForm.style.display = 'none';
    } else if (tab === 'forgot') {
        if (tabsWrap) tabsWrap.style.display = 'none';
        if (loginForm) loginForm.style.display = 'none';
        if (regForm) regForm.style.display = 'none';
        if (forgotForm) forgotForm.style.display = 'block';
    }
};

window.togglePasswordVisibility = function(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
};

// Toggle additional register fields (Security PIN & Invite Code)
window.toggleExtraRegisterFields = function() {
    const extraBox = document.getElementById('reg-extra-fields');
    const icon = document.getElementById('expand-icon');
    if (!extraBox) return;
    if (extraBox.style.display === 'none') {
        extraBox.style.display = 'block';
        if (icon) icon.innerText = '▲';
    } else {
        extraBox.style.display = 'none';
        if (icon) icon.innerText = '▼';
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

// Cooldown Timers for OTP
let otpTimers = {
    reg: null,
    forgot: null
};

function startOtpCountdown(context, seconds = 60) {
    const btn = document.getElementById(`${context}-send-otp-btn`);
    if (!btn) return;

    if (otpTimers[context]) {
        clearInterval(otpTimers[context]);
    }

    let remaining = seconds;
    btn.disabled = true;
    btn.innerText = `Resend (${remaining}s)`;

    otpTimers[context] = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(otpTimers[context]);
            otpTimers[context] = null;
            btn.disabled = false;
            btn.innerText = 'Resend OTP';
        } else {
            btn.innerText = `Resend (${remaining}s)`;
        }
    }, 1000);
}

// Send OTP Handler (via Fast2SMS)
window.handleSendOtp = async function(context) {
    const phoneInput = document.getElementById(context === 'reg' ? 'reg-phone' : 'forgot-phone');
    const sendBtn = document.getElementById(`${context}-send-otp-btn`);
    if (!phoneInput || !sendBtn) return;

    const phone = phoneInput.value.trim();
    if (!/^[6-9]\d{9}$/.test(phone)) {
        showToast('Please enter a valid 10-digit mobile number (starts with 6-9)');
        phoneInput.focus();
        return;
    }

    try {
        sendBtn.disabled = true;
        sendBtn.innerText = 'Sending...';

        const otpType = context === 'reg' ? 'REGISTER' : 'FORGOT_PASSWORD';
        const res = await fetch('/api/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, type: otpType })
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Failed to send OTP');
            sendBtn.disabled = false;
            sendBtn.innerText = 'Send OTP';
            return;
        }

        showToast(data.message || 'OTP sent successfully to your mobile number!');
        startOtpCountdown(context, data.cooldownSeconds || 60);

        // Auto-focus OTP input
        const otpInput = document.getElementById(context === 'reg' ? 'reg-otp' : 'forgot-otp');
        if (otpInput) otpInput.focus();
    } catch (err) {
        showToast('Network error while requesting OTP');
        sendBtn.disabled = false;
        sendBtn.innerText = 'Send OTP';
    }
};

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
        }, 600);
    } catch (err) {
        showToast('Network error during login');
        btn.disabled = false;
        btn.innerText = 'Log In';
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
        localStorage.setItem('smarty91_cached_balance', (data.user.balance || 0).toString());

        showToast('Account Created! Welcome to Smarty91 VIP');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 800);
    } catch (err) {
        showToast('Network error during registration');
        btn.disabled = false;
        btn.innerText = 'Register & Play';
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
    }
};
