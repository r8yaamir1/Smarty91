// wallet.js - High Roller VIP Wallet Manager

const STORAGE_KEY = 'smarty91_wallet_balance';
const DEFAULT_BALANCE = 25679.96;

let balance = loadBalance();

export function loadBalance() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val >= 0) return val;
    }
    return DEFAULT_BALANCE;
}

export function saveBalance(amount) {
    balance = Math.max(0, amount);
    localStorage.setItem(STORAGE_KEY, balance.toString());
    renderBalance();
    return balance;
}

export function getBalance() {
    return balance;
}

export function addBalance(amount) {
    if (amount <= 0) return balance;
    return saveBalance(balance + amount);
}

export function deductBalance(amount) {
    if (amount <= 0 || amount > balance) return false;
    saveBalance(balance - amount);
    return true;
}

export function formatCurrency(amount) {
    return `₹${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function renderBalance() {
    const moneyElements = document.querySelectorAll('.Wallet__C-balance-l1 > div, #wallet-display-balance, .current-wallet-val');
    moneyElements.forEach(el => {
        if (el) el.textContent = formatCurrency(balance);
    });
}

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
            <span class="toast-icon">${type === 'success' ? '✓' : '⚠'}</span>
            <span class="toast-msg">${message}</span>
        </div>
    `;
    setTimeout(() => {
        toast.classList.remove('active');
    }, 2400);
}

// Initialize Wallet listeners
export function initWalletModals() {
    renderBalance();

    const refreshBtn = document.querySelector('.Wallet__C-balance-l2 svg, .Wallet__C-balance-l2');

    if (refreshBtn) {
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.addEventListener('click', () => {
            renderBalance();
            showToast('Wallet balance refreshed', 'success');
        });
    }
}

