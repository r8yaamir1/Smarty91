// js/wallet.js - High Roller VIP Wallet Manager (Server-Authoritative Observable)
import { walletService } from './services/walletService.js';
import { subscribeToUserBalance } from './services/firebaseClient.js';

let currentBalance = Number(localStorage.getItem('smarty91_cached_balance')) || 0.00;

let activeBalanceListener = null;

// Dynamic listener setup that can be re-run whenever login state changes
export function setupBalanceListener() {
    if (activeBalanceListener) {
        try {
            activeBalanceListener(); // Unsubscribe previous listener
        } catch (e) {}
        activeBalanceListener = null;
    }

    const currentUserId = localStorage.getItem('smarty91_user_id') || 'default_user';
    try {
        activeBalanceListener = subscribeToUserBalance(currentUserId, (userData) => {
            if (userData && typeof userData.balance === 'number') {
                currentBalance = userData.balance;
                localStorage.setItem('smarty91_cached_balance', currentBalance.toString());
                renderBalance();
            }
        });
    } catch (e) {
        console.warn('Realtime balance listener warning:', e);
    }
}

// Initial listener setup
setupBalanceListener();

// Listen for balance changes across other tabs
window.addEventListener('storage', (e) => {
    if (e.key === 'smarty91_cached_balance' && e.newValue) {
        const val = Number(e.newValue);
        if (!isNaN(val)) {
            currentBalance = val;
            renderBalance();
        }
    }
});

// Update Header Profile Indicator
export function updateHeaderUserUI() {
    const userDisplay = document.getElementById('user-display-name');
    const phone = localStorage.getItem('smarty91_user_phone');
    if (userDisplay) {
        if (phone) {
            userDisplay.textContent = `👤 +91 ${phone.slice(-4)}`;
        } else {
            userDisplay.textContent = '👤 Login';
        }
    }
}

window.handleUserProfileClick = function() {
    const token = localStorage.getItem('smarty91_auth_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    window.location.href = 'profile.html';
};

export async function syncServerBalance(showLoader = false) {
    if (showLoader && window.SmartyLoader) window.SmartyLoader.show('Updating VIP Wallet...');
    try {
        const res = await walletService.getBalance();
        if (res && res.success && typeof res.balance === 'number') {
            currentBalance = res.balance;
            renderBalance();
        }
    } catch (e) {
        // Fallback to memory balance
    } finally {
        if (showLoader && window.SmartyLoader) window.SmartyLoader.hide();
    }
    return currentBalance;
}

export function getBalance() {
    return currentBalance;
}

export function setBalanceLocally(newBal) {
    currentBalance = Number(newBal);
    localStorage.setItem('smarty91_cached_balance', currentBalance.toString());
    renderBalance();
}

export function addBalance(amount) {
    currentBalance = Number((currentBalance + Number(amount)).toFixed(2));
    localStorage.setItem('smarty91_cached_balance', currentBalance.toString());
    renderBalance();
    return currentBalance;
}

export function deductBalance(amount) {
    currentBalance = Number(Math.max(0, currentBalance - Number(amount)).toFixed(2));
    localStorage.setItem('smarty91_cached_balance', currentBalance.toString());
    renderBalance();
    return currentBalance;
}

export function formatCurrency(amount) {
    const num = Number(amount) || 0;
    return `₹${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function renderBalance() {
    const moneyElements = document.querySelectorAll('.Wallet__C-balance-l1 > div, #wallet-display-balance, .current-wallet-val');
    moneyElements.forEach(el => {
        if (el) el.textContent = formatCurrency(currentBalance);
    });
}

// Global hook for other modules
window.refreshSmartyWallet = syncServerBalance;

// Show a temporary styled toast notification
export function showToast(message, type = 'success') {
    let toast = document.querySelector('.smarty-custom-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'smarty-custom-toast';
        document.body.appendChild(toast);
    }
    toast.className = `smarty-custom-toast ${type} active`;
    toast.innerHTML = `
        <div class="toast-content">
            <span class="toast-icon">${type === 'success' ? '✓' : (type === 'warn' ? 'ℹ' : '⚠')}</span>
            <span class="toast-msg">${message}</span>
        </div>
    `;
    setTimeout(() => {
        toast.classList.remove('active');
    }, 2400);
}

// Navigation to Dedicated Cashier Hub
export function openDepositHub() {
    window.location.href = 'payment.html?tab=deposit';
}

export function openWithdrawalHub() {
    window.location.href = 'payment.html?tab=withdraw';
}

// Global window exposure
window.openDepositHub = openDepositHub;
window.openWithdrawalHub = openWithdrawalHub;

// Initialize Wallet listeners
export function initWalletModals() {
    syncServerBalance();

    // Start continuous automatic balance synchronization every 4 seconds in the background
    setInterval(() => {
        syncServerBalance().catch(() => {});
    }, 4000);

    const refreshBtn = document.querySelector('.Wallet__C-balance-l2 svg, .Wallet__C-balance-l2');
    if (refreshBtn) {
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.addEventListener('click', async () => {
            await syncServerBalance(true);
            showToast('Wallet balance refreshed', 'success');
        });
    }

    const withdrawBtns = document.querySelectorAll('.withdraw-btn, .wallet-withdraw-btn');
    withdrawBtns.forEach(btn => {
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openWithdrawalHub();
        });
    });

    const depositBtns = document.querySelectorAll('.deposit-btn, .wallet-deposit-btn');
    depositBtns.forEach(btn => {
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openDepositHub();
        });
    });
}
