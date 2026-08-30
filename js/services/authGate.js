// js/services/authGate.js - Persistent VIP Auth Gatekeeper & Device Storage
(function() {
    const isLoginPage = window.location.pathname.endsWith('login.html');
    const isRegisterPage = window.location.pathname.endsWith('register.html');
    const token = localStorage.getItem('smarty91_auth_token');
    const userId = localStorage.getItem('smarty91_user_id');

    // Show initial instant smooth loader if smarty loader exists
    function showSplash(msg) {
        if (window.SmartyLoader && typeof window.SmartyLoader.show === 'function') {
            window.SmartyLoader.show(msg || 'Syncing Smarty91 VIP...');
        }
    }

    function hideSplash() {
        if (window.SmartyLoader && typeof window.SmartyLoader.hide === 'function') {
            window.SmartyLoader.hide();
        }
    }

    if (isLoginPage || isRegisterPage) {
        // If user already logged in with valid token, verify and auto-redirect to game
        if (token && userId) {
            showSplash('Checking VIP Session...');
            fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(res => res.json())
            .then(data => {
                if (data && data.success && data.user) {
                    // Update fresh cached values in device storage
                    localStorage.setItem('smarty91_user_id', data.user.id);
                    localStorage.setItem('smarty91_user_phone', data.user.phone);
                    localStorage.setItem('smarty91_invite_code', data.user.inviteCode);
                    localStorage.setItem('smarty91_cached_balance', (data.user.balance || 0).toString());
                    window.location.replace('index.html');
                } else {
                    hideSplash();
                }
            })
            .catch(() => {
                hideSplash();
            });
        }
    } else {
        // Protected App Pages (index.html, profile.html, payment.html)
        if (!token || !userId) {
            // Not logged in -> Immediately route to login.html
            window.location.replace('login.html');
            return;
        }

        // Verify token in background with server
        fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(data => {
            if (!data || !data.success || !data.user) {
                // Token expired / invalidated -> Clear and go to login
                localStorage.removeItem('smarty91_auth_token');
                localStorage.removeItem('smarty91_user_id');
                window.location.replace('login.html');
            } else {
                // Keep device storage updated
                localStorage.setItem('smarty91_user_id', data.user.id);
                localStorage.setItem('smarty91_user_phone', data.user.phone);
                localStorage.setItem('smarty91_cached_balance', (data.user.balance || 0).toString());
            }
        })
        .catch(err => {
            console.warn('Background session sync warning:', err);
        });
    }
})();
