// js/wallet.js - High Roller VIP Wallet Manager (Server-Authoritative Observable)
import { walletService } from './services/walletService.js';
import { subscribeToUserBalance } from './services/firebaseClient.js';

let currentBalance = Number(localStorage.getItem('smarty91_cached_balance')) || 0.00;
const currentUserId = localStorage.getItem('smarty91_user_id') || 'default_user';

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

// Subscribe to real-time Firestore balance updates
try {
    subscribeToUserBalance(currentUserId, (userData) => {
        if (userData && typeof userData.balance === 'number') {
            currentBalance = userData.balance;
            localStorage.setItem('smarty91_cached_balance', currentBalance.toString());
            renderBalance();
        }
    });
} catch (e) {
    console.warn('Realtime balance listener warning:', e);
}

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

// Interactive Deposit Modal
function openDepositModal() {
    let modal = document.getElementById('smarty-deposit-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'smarty-deposit-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 10000;
            display: flex; align-items: flex-end; justify-content: center; backdrop-filter: blur(4px);
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    modal.innerHTML = `
        <div style="background: #141c2e; border-top: 2px solid #f59e0b; border-radius: 20px 20px 0 0; width: 100%; max-width: 480px; padding: 20px; color: #fff; box-shadow: 0 -10px 25px rgba(0,0,0,0.5);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div style="font-size: 16px; font-weight: 800; color: #f59e0b; display: flex; align-items: center; gap: 8px;">
                    <span>📥</span> Deposit Funds
                </div>
                <button id="close-dep-modal" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px;">✕</button>
            </div>

            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 10px;">Select Quick Amount (₹)</div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px;">
                <button class="dep-amt-chip" data-amt="500" style="background: #1e293b; border: 1px solid #334155; color: #fff; padding: 8px 0; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;">₹500</button>
                <button class="dep-amt-chip" data-amt="1000" style="background: rgba(245,158,11,0.2); border: 1px solid #f59e0b; color: #f59e0b; padding: 8px 0; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;">₹1,000</button>
                <button class="dep-amt-chip" data-amt="5000" style="background: #1e293b; border: 1px solid #334155; color: #fff; padding: 8px 0; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;">₹5,000</button>
                <button class="dep-amt-chip" data-amt="10000" style="background: #1e293b; border: 1px solid #334155; color: #fff; padding: 8px 0; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;">₹10,000</button>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Deposit Amount (₹)</label>
                <input type="number" id="dep-custom-amt" value="1000" min="100" style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 15px; font-weight: 700; outline: none;" />
            </div>

            <div style="margin-bottom: 12px;">
                <label style="display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Payment UTR / Reference ID</label>
                <input type="text" id="dep-utr-input" placeholder="e.g. UTR1234567890" value="UTR${Date.now().toString().slice(-8)}" style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 13px; outline: none;" />
            </div>

            <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); border-radius: 8px; padding: 10px; font-size: 11px; color: #10b981; margin-bottom: 16px;">
                ✔ Instant Live Admin Sync: Your deposit request will be submitted to the Admin Panel for approval.
            </div>

            <button id="submit-dep-request" style="width: 100%; background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; border: none; padding: 12px; border-radius: 10px; font-weight: 800; font-size: 14px; cursor: pointer;">
                SUBMIT DEPOSIT REQUEST
            </button>
        </div>
    `;

    // Modal Events
    modal.querySelector('#close-dep-modal').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    modal.querySelectorAll('.dep-amt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            modal.querySelectorAll('.dep-amt-chip').forEach(c => {
                c.style.background = '#1e293b';
                c.style.borderColor = '#334155';
                c.style.color = '#fff';
            });
            chip.style.background = 'rgba(245,158,11,0.2)';
            chip.style.borderColor = '#f59e0b';
            chip.style.color = '#f59e0b';
            modal.querySelector('#dep-custom-amt').value = chip.dataset.amt;
        });
    });

    modal.querySelector('#submit-dep-request').addEventListener('click', async () => {
        const amt = Number(modal.querySelector('#dep-custom-amt').value);
        const utr = modal.querySelector('#dep-utr-input').value.trim() || `UTR${Date.now()}`;

        if (!amt || amt < 100) {
            showToast('Minimum deposit is ₹100', 'error');
            return;
        }

        try {
            if (window.SmartyLoader) window.SmartyLoader.show('Processing Deposit Request...');
            const btn = modal.querySelector('#submit-dep-request');
            btn.textContent = 'Submitting...';
            btn.disabled = true;

            const res = await walletService.submitDepositRequest({
                amount: amt,
                utrNumber: utr,
                upiId: 'vip.pay@upi'
            });

            modal.style.display = 'none';
            showToast(res.message || 'Deposit request submitted successfully!', 'success');
        } catch (err) {
            showToast(err.message || 'Deposit request failed', 'error');
        } finally {
            if (window.SmartyLoader) window.SmartyLoader.hide();
        }
    });
}

// Interactive Withdrawal Modal
function openWithdrawalModal() {
    let modal = document.getElementById('smarty-withdraw-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'smarty-withdraw-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 10000;
            display: flex; align-items: flex-end; justify-content: center; backdrop-filter: blur(4px);
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    modal.innerHTML = `
        <div style="background: #141c2e; border-top: 2px solid #8b5cf6; border-radius: 20px 20px 0 0; width: 100%; max-width: 480px; padding: 20px; color: #fff; box-shadow: 0 -10px 25px rgba(0,0,0,0.5);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div style="font-size: 16px; font-weight: 800; color: #a78bfa; display: flex; align-items: center; gap: 8px;">
                    <span>📤</span> Withdraw Funds
                </div>
                <button id="close-wth-modal" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px;">✕</button>
            </div>

            <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8;">Available Balance:</span>
                <span style="font-size: 15px; font-weight: 800; color: #10b981;">${formatCurrency(currentBalance)}</span>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Withdrawal Amount (₹)</label>
                <input type="number" id="wth-amt-input" value="500" min="100" style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 15px; font-weight: 700; outline: none;" />
            </div>

            <div style="margin-bottom: 12px;">
                <label style="display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Bank Account / UPI ID</label>
                <input type="text" id="wth-acc-input" value="98765432100" style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 13px; outline: none;" />
            </div>

            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Bank Name / IFSC</label>
                <input type="text" id="wth-bank-input" value="State Bank of India (SBIN0001234)" style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 13px; outline: none;" />
            </div>

            <button id="submit-wth-request" style="width: 100%; background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; font-size: 14px; cursor: pointer;">
                SUBMIT WITHDRAWAL REQUEST
            </button>
        </div>
    `;

    // Modal Events
    modal.querySelector('#close-wth-modal').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    modal.querySelector('#submit-wth-request').addEventListener('click', async () => {
        const amt = Number(modal.querySelector('#wth-amt-input').value);
        const acc = modal.querySelector('#wth-acc-input').value.trim();
        const bank = modal.querySelector('#wth-bank-input').value.trim();

        if (!amt || amt < 100) {
            showToast('Minimum withdrawal is ₹100', 'error');
            return;
        }
        if (amt > currentBalance) {
            showToast('Insufficient wallet balance', 'error');
            return;
        }

        try {
            if (window.SmartyLoader) window.SmartyLoader.show('Submitting Withdrawal Request...');
            const btn = modal.querySelector('#submit-wth-request');
            btn.textContent = 'Processing...';
            btn.disabled = true;

            const res = await walletService.submitWithdrawalRequest({
                amount: amt,
                bankName: bank,
                accountNumber: acc,
                ifsc: 'SBIN0001234'
            });

            if (res.newBalance !== undefined) {
                currentBalance = res.newBalance;
                renderBalance();
            }

            modal.style.display = 'none';
            showToast(res.message || 'Withdrawal request submitted!', 'success');
        } catch (err) {
            showToast(err.message || 'Withdrawal failed', 'error');
        } finally {
            if (window.SmartyLoader) window.SmartyLoader.hide();
        }
    });
}

// Initialize Wallet listeners
export function initWalletModals() {
    syncServerBalance();

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
            e.stopPropagation();
            openWithdrawalModal();
        });
    });

    const depositBtns = document.querySelectorAll('.deposit-btn, .wallet-deposit-btn');
    depositBtns.forEach(btn => {
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDepositModal();
        });
    });
}
