// js/profile.js - VIP Profile & Analytics Engine for Smarty91
// Strictly read & auth compliant with zero disruption to game engine / backend

function showToast(msg, duration = 3000) {
    const toast = document.getElementById('profile-toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}

// Global Profile State
let currentUser = null;
let currentBalance = 0;
let userLedger = [];
let userBets = [];

// Determine VIP Level based on balance + total deposits
function calculateVipLevel(balance, totalDeposits) {
    const score = (balance || 0) + (totalDeposits || 0);
    if (score >= 1000000) return { level: 9, title: 'Supreme Crown VIP', target: 2000000, progress: 100 };
    if (score >= 500000) return { level: 8, title: 'Royal Diamond VIP', target: 1000000, progress: Math.min(100, (score / 1000000) * 100) };
    if (score >= 200000) return { level: 7, title: 'Platinum Elite VIP', target: 500000, progress: Math.min(100, (score / 500000) * 100) };
    if (score >= 100000) return { level: 6, title: 'Gold Master VIP', target: 200000, progress: Math.min(100, (score / 200000) * 100) };
    if (score >= 50000) return { level: 5, title: 'Emerald High Roller', target: 100000, progress: Math.min(100, (score / 100000) * 100) };
    if (score >= 20000) return { level: 4, title: 'Ruby Veteran VIP', target: 50000, progress: Math.min(100, (score / 50000) * 100) };
    if (score >= 5000) return { level: 3, title: 'Silver Pro VIP', target: 20000, progress: Math.min(100, (score / 20000) * 100) };
    if (score >= 1000) return { level: 2, title: 'Bronze VIP Player', target: 5000, progress: Math.min(100, (score / 5000) * 100) };
    return { level: 1, title: 'VIP Pioneer', target: 1000, progress: Math.min(100, (score / 1000) * 100) };
}

// Mask Phone number (e.g. +91 98****3210)
function maskPhone(phone) {
    if (!phone) return '+91 --';
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 10) {
        return `+91 ${clean.slice(0, 2)}****${clean.slice(6)}`;
    }
    return `+91 ${phone}`;
}

// Generate human-like short UID
function formatUID(id) {
    if (!id) return 'UID 910001';
    if (id.startsWith('user_')) {
        return 'UID ' + id.replace('user_', '').slice(-7).toUpperCase();
    }
    return 'UID ' + id.slice(-6).toUpperCase();
}

// Fetch all profile data
async function loadUserProfile() {
    const token = localStorage.getItem('smarty91_auth_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Loading VIP Profile...');

        // 1. Fetch User details
        const meRes = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const meData = await meRes.json();

        if (!meData.success || !meData.user) {
            localStorage.removeItem('smarty91_auth_token');
            window.location.href = 'login.html';
            return;
        }

        currentUser = meData.user;
        currentBalance = Number(currentUser.balance) || 0;

        // 2. Fetch Ledger (Passbook)
        try {
            const ledgerRes = await fetch('/api/wallet/ledger', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const ledgerData = await ledgerRes.json();
            if (ledgerData.success && Array.isArray(ledgerData.items)) {
                userLedger = ledgerData.items;
            }
        } catch (e) {
            userLedger = [];
        }

        // 3. Fetch Bets History across all 4 modes for accurate win stats
        userBets = [];
        const modes = ['30s', '1m', '3m', '5m'];
        for (const m of modes) {
            try {
                const betRes = await fetch(`/api/bets/my-history/${m}?limit=50`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const betData = await betRes.json();
                if (betData.success && Array.isArray(betData.items)) {
                    userBets.push(...betData.items);
                }
            } catch (e) {}
        }

        renderProfileUI();
    } catch (err) {
        showToast('Network error loading profile');
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
}

// Render everything on screen
function renderProfileUI() {
    if (!currentUser) return;

    // Calculate metrics
    let totalDepositAmount = 0;
    let totalWithdrawAmount = 0;
    userLedger.forEach(item => {
        if (item.type === 'DEPOSIT') totalDepositAmount += Math.abs(item.amount || 0);
        if (item.type === 'WITHDRAWAL') totalWithdrawAmount += Math.abs(item.amount || 0);
    });

    const vipInfo = calculateVipLevel(currentBalance, totalDepositAmount);

    // Calculate Bet Performance
    const totalBetsCount = userBets.length;
    let winCount = 0;
    let totalWonAmount = 0;
    let totalBetAmount = 0;

    userBets.forEach(b => {
        const betCost = (b.unitAmount || 0) * (b.multiplier || 1) * (b.quantity || 1);
        totalBetAmount += betCost;
        if (b.status === 'WON') {
            winCount++;
            totalWonAmount += (b.payout || 0);
        }
    });

    const winRate = totalBetsCount > 0 ? ((winCount / totalBetsCount) * 100).toFixed(1) : '0.0';
    const netProfit = totalWonAmount - totalBetAmount;

    // 1. Identity Elements
    const phoneEl = document.getElementById('user-phone-display');
    const uidEl = document.getElementById('user-uid-display');
    const inviteEl = document.getElementById('user-invite-display');
    const vipLevelEl = document.getElementById('user-vip-level');
    const vipTitleEl = document.getElementById('user-vip-title');
    const vipBadgeEl = document.getElementById('user-vip-badge-icon');
    const vipBarEl = document.getElementById('vip-progress-bar');
    const vipProgressTextEl = document.getElementById('vip-progress-text');
    const balanceEl = document.getElementById('user-balance-val');
    const depositTotalEl = document.getElementById('stat-total-deposit');
    const withdrawTotalEl = document.getElementById('stat-total-withdraw');

    if (phoneEl) phoneEl.textContent = maskPhone(currentUser.phone);
    if (uidEl) uidEl.textContent = formatUID(currentUser.id);
    if (inviteEl) inviteEl.textContent = currentUser.inviteCode || 'SM91VIP';
    if (vipLevelEl) vipLevelEl.textContent = `VIP ${vipInfo.level}`;
    if (vipTitleEl) vipTitleEl.textContent = vipInfo.title;
    if (vipBadgeEl) vipBadgeEl.textContent = `👑 VIP ${vipInfo.level}`;
    if (vipBarEl) vipBarEl.style.width = `${Math.max(8, vipInfo.progress)}%`;
    if (vipProgressTextEl) vipProgressTextEl.textContent = `Progress to VIP ${vipInfo.level + 1}: ${Math.floor(vipInfo.progress)}% (Target ₹${vipInfo.target.toLocaleString('en-IN')})`;
    if (balanceEl) balanceEl.textContent = `₹${currentBalance.toFixed(2)}`;
    if (depositTotalEl) depositTotalEl.textContent = `₹${totalDepositAmount.toFixed(2)}`;
    if (withdrawTotalEl) withdrawTotalEl.textContent = `₹${totalWithdrawAmount.toFixed(2)}`;

    // 2. Performance Stats
    const winRateEl = document.getElementById('stat-win-rate');
    const winRateRingEl = document.getElementById('stat-win-rate-ring');
    const totalBetsEl = document.getElementById('stat-total-bets');
    const totalWinsEl = document.getElementById('stat-total-wins');
    const netProfitEl = document.getElementById('stat-net-profit');

    if (winRateEl) winRateEl.textContent = `${winRate}%`;
    if (winRateRingEl) {
        // Circle perimeter is 2 * PI * 40 = ~251.2
        const strokeOffset = 251.2 - (251.2 * (parseFloat(winRate) / 100));
        winRateRingEl.style.strokeDashoffset = strokeOffset;
    }
    if (totalBetsEl) totalBetsEl.textContent = totalBetsCount.toString();
    if (totalWinsEl) totalWinsEl.textContent = winCount.toString();
    if (netProfitEl) {
        if (netProfit >= 0) {
            netProfitEl.textContent = `+₹${netProfit.toFixed(2)}`;
            netProfitEl.style.color = '#10b981';
        } else {
            netProfitEl.textContent = `-₹${Math.abs(netProfit).toFixed(2)}`;
            netProfitEl.style.color = '#ef4444';
        }
    }

    // 3. Render Passbook List
    renderLedgerList();
}

// Render Passbook Ledger
function renderLedgerList() {
    const container = document.getElementById('ledger-history-list');
    if (!container) return;

    if (userLedger.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 0.6rem 0.2rem; color: #6b7280; font-size: 0.32rem;">
                <div style="font-size: 0.8rem; margin-bottom: 0.2rem; opacity: 0.5;">📒</div>
                No transaction records found yet.
            </div>
        `;
        return;
    }

    let html = '';
    userLedger.slice(0, 15).forEach(item => {
        const isPositive = item.amount > 0;
        const color = isPositive ? '#10B981' : '#EF4444';
        const sign = isPositive ? '+' : '';
        const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

        let icon = '💳';
        if (item.type === 'DEPOSIT') icon = '📥';
        else if (item.type === 'WITHDRAWAL') icon = '📤';
        else if (item.type === 'WIN') icon = '🏆';
        else if (item.type === 'BET') icon = '🎲';

        html += `
            <div class="ledger-item">
                <div class="ledger-left">
                    <div class="ledger-icon">${icon}</div>
                    <div class="ledger-details">
                        <div class="ledger-title">${item.description || item.type}</div>
                        <div class="ledger-time">${dateStr} • ${timeStr}</div>
                    </div>
                </div>
                <div class="ledger-right">
                    <div class="ledger-amount" style="color: ${color};">${sign}₹${Math.abs(item.amount).toFixed(2)}</div>
                    <div class="ledger-bal">Bal: ₹${(item.balanceAfter || 0).toFixed(2)}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// 1-Click Copy Helpers
window.copyUID = function() {
    if (!currentUser) return;
    const uid = currentUser.id;
    navigator.clipboard.writeText(uid).then(() => {
        showToast(`Copied User UID: ${uid}`);
    }).catch(() => {
        showToast(`UID: ${uid}`);
    });
};

window.copyInvite = function() {
    if (!currentUser) return;
    const invite = currentUser.inviteCode || 'SM91VIP';
    const inviteUrl = `${window.location.origin}/login.html?ref=${invite}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
        showToast(`Invite Link Copied: ${inviteUrl}`);
    }).catch(() => {
        showToast(`Invite Code: ${invite}`);
    });
};

// Refresh Balance
window.refreshBalance = async function() {
    const token = localStorage.getItem('smarty91_auth_token');
    const icon = document.getElementById('balance-refresh-icon');
    if (icon) icon.classList.add('spinning');

    try {
        const res = await fetch('/api/wallet/balance', {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const data = await res.json();
        if (data.success && typeof data.balance === 'number') {
            currentBalance = data.balance;
            localStorage.setItem('smarty91_cached_balance', currentBalance.toString());
            const balanceEl = document.getElementById('user-balance-val');
            if (balanceEl) balanceEl.textContent = `₹${currentBalance.toFixed(2)}`;
            showToast('Balance updated!');
        }
    } catch (e) {
        showToast('Failed to refresh');
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('spinning');
        }, 600);
    }
};

// Security Change Password Modal
window.openSecurityModal = function() {
    const modal = document.getElementById('security-modal');
    if (modal) modal.style.display = 'flex';
};

window.closeSecurityModal = function() {
    const modal = document.getElementById('security-modal');
    if (modal) modal.style.display = 'none';
};

window.handlePasswordChange = async function(e) {
    e.preventDefault();
    const newPassword = document.getElementById('new-password-input').value;
    const confirmPassword = document.getElementById('confirm-password-input').value;
    const pin = document.getElementById('security-pin-input').value.trim();

    if (newPassword.length < 6) {
        showToast('Password must be at least 6 characters');
        return;
    }
    if (newPassword !== confirmPassword) {
        showToast('Passwords do not match');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Updating Security...');
        const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: currentUser.phone,
                newPassword,
                securityPin: pin
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || 'Security PIN verification failed');
            return;
        }
        showToast('Password updated successfully!');
        window.closeSecurityModal();
    } catch (err) {
        showToast('Error updating password');
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
};

// Customer Support Trigger
window.openCustomerSupport = function() {
    showToast('Connecting to 24/7 VIP Dedicated Telegram Support...');
    setTimeout(() => {
        window.open('https://t.me/smarty91_official', '_blank');
    }, 400);
};

// Logout Handler
window.handleLogout = async function() {
    const token = localStorage.getItem('smarty91_auth_token');
    if (token) {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (e) {}
    }

    localStorage.removeItem('smarty91_auth_token');
    localStorage.removeItem('smarty91_user_id');
    localStorage.removeItem('smarty91_user_phone');
    localStorage.removeItem('smarty91_invite_code');
    localStorage.removeItem('smarty91_cached_balance');

    showToast('Logged out successfully');
    setTimeout(() => {
        window.location.href = 'login.html';
    }, 400);
};

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    loadUserProfile();
});
