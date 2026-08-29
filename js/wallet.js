// js/wallet.js - High Roller VIP Wallet Manager (Server-Authoritative Observable)
import { walletService } from './services/walletService.js';

let currentBalance = 25679.96;

export async function syncServerBalance() {
    try {
        const res = await walletService.getBalance();
        if (res && res.success && typeof res.balance === 'number') {
            currentBalance = res.balance;
            renderBalance();
        }
    } catch (e) {
        // Fallback to memory balance
    }
    return currentBalance;
}

export function getBalance() {
    return currentBalance;
}

export function setBalanceLocally(newBal) {
    currentBalance = Number(newBal);
    renderBalance();
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
    syncServerBalance();

    const refreshBtn = document.querySelector('.Wallet__C-balance-l2 svg, .Wallet__C-balance-l2');
    if (refreshBtn) {
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.addEventListener('click', async () => {
            await syncServerBalance();
            showToast('Wallet balance refreshed', 'success');
        });
    }

    const withdrawBtn = document.querySelector('.withdraw-btn');
    if (withdrawBtn) {
        withdrawBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const res = await walletService.withdraw(500);
                if (res.success) {
                    currentBalance = res.newBalance;
                    renderBalance();
                    showToast(res.message, 'success');
                }
            } catch (err) {
                showToast(err.message || 'Withdrawal failed', 'error');
            }
        });
    }

    const depositBtn = document.querySelector('.deposit-btn');
    if (depositBtn) {
        depositBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const res = await walletService.deposit(1000);
                if (res.success) {
                    currentBalance = res.newBalance;
                    renderBalance();
                    showToast(res.message, 'success');
                }
            } catch (err) {
                showToast(err.message || 'Deposit failed', 'error');
            }
        });
    }
}
