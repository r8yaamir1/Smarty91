// js/payment.js - Dedicated VIP Cashier & Payment Gateway Hub
import { walletService } from './services/walletService.js';
import { subscribeToUserBalance } from './services/firebaseClient.js';

let walletState = {
    realBalance: 0.00,
    bonusBalance: 0.00,
    upiId: 'vip.pay@upi',
    upiName: 'VIP SMARTY91 GAMING',
    minDeposit: 200,
    maxDeposit: 100000,
    selectedDepositAmount: 200,
    transactions: [],
    currentFilter: 'ALL'
};

const currentUserId = localStorage.getItem('smarty91_user_id') || 'default_user';

// Bank IFSC Prefix Lookup Dictionary
const IFSC_BANKS = {
    'SBIN': 'State Bank of India',
    'HDFC': 'HDFC Bank',
    'ICIC': 'ICICI Bank',
    'PUNB': 'Punjab National Bank',
    'BARB': 'Bank of Baroda',
    'UTIB': 'Axis Bank',
    'KKBK': 'Kotak Mahindra Bank',
    'INDB': 'IndusInd Bank',
    'CNRB': 'Canara Bank',
    'UBIN': 'Union Bank of India',
    'YESB': 'Yes Bank',
    'PYTM': 'Paytm Payments Bank',
    'AIRP': 'Airtel Payments Bank',
    'IDFB': 'IDFC FIRST Bank',
    'BKID': 'Bank of India',
    'CBIN': 'Central Bank of India',
    'IOBA': 'Indian Overseas Bank',
    'IDIB': 'Indian Bank'
};

// UI Notification Toast
function showToast(message, type = 'success') {
    const toast = document.getElementById('payment-toast');
    const icon = document.getElementById('toast-icon');
    const msg = document.getElementById('toast-msg');
    if (!toast) return;

    icon.textContent = type === 'success' ? '✓' : (type === 'error' ? '⚠' : 'ℹ');
    msg.textContent = message;
    toast.style.borderColor = type === 'success' ? '#10B981' : (type === 'error' ? '#EF4444' : '#F59E0B');
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 2600);
}

// Currency Formatter
function formatCurrency(val) {
    const num = Number(val) || 0;
    return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format Time
function formatTime(isoStr) {
    if (!isoStr) return '--:--';
    const date = new Date(isoStr);
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Tab Switching
export function switchTab(tabName) {
    const panes = ['deposit', 'withdraw', 'history'];
    panes.forEach(p => {
        const paneEl = document.getElementById(`pane-${p}`);
        const tabBtn = document.getElementById(`tab-btn-${p}`);
        if (paneEl) paneEl.classList.toggle('active', p === tabName);
        if (tabBtn) tabBtn.classList.toggle('active', p === tabName);
    });

    if (tabName === 'history') {
        fetchTransactions();
    }
}
window.switchTab = switchTab;

// Update Balance UI
function renderBalances() {
    const realEl = document.getElementById('display-real-balance');
    const bonusEl = document.getElementById('display-bonus-balance');
    if (realEl) realEl.textContent = formatCurrency(walletState.realBalance);
    if (bonusEl) bonusEl.textContent = formatCurrency(walletState.bonusBalance);
}

// Fetch Full Wallet Summary
export async function refreshWalletData(silent = false) {
    const spinner = document.getElementById('refresh-spinner');
    if (spinner && !silent) spinner.style.transform = 'rotate(360deg)';

    try {
        const res = await walletService.getSummary();
        if (res && res.success && res.summary) {
            walletState.realBalance = res.summary.balance || 0;
            walletState.bonusBalance = res.summary.bonusBalance || 0;
            if (res.summary.upiConfig) {
                walletState.upiId = res.summary.upiConfig.upiId || walletState.upiId;
                walletState.upiName = res.summary.upiConfig.upiName || walletState.upiName;
                const upiDisplay = document.getElementById('official-upi-id-display');
                if (upiDisplay) upiDisplay.value = walletState.upiId;
            }
            renderBalances();
            updateDepositGateway();
            if (!silent) showToast('VIP Assets updated live', 'success');
        }
    } catch (err) {
        console.warn('Wallet summary load error:', err);
    } finally {
        if (spinner && !silent) {
            setTimeout(() => { spinner.style.transform = 'rotate(0deg)'; }, 300);
        }
    }
}
window.refreshWalletData = refreshWalletData;

// Update QR Code and Deep Link URLs
function updateDepositGateway() {
    const amount = Number(walletState.selectedDepositAmount) || 200;
    const upiId = walletState.upiId;
    const upiName = walletState.upiName;
    const txRef = 'DEP' + Date.now().toString().slice(-6);
    const note = `Recharge ${txRef} SMARTY91`;

    // Standard NPCI UPI URI
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

    // Update QR Code Image
    const qrImg = document.getElementById('dynamic-qr-img');
    const qrCaption = document.getElementById('qr-amount-caption');
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUri)}`;
    }
    if (qrCaption) {
        qrCaption.textContent = `PAY ${formatCurrency(amount)}`;
    }

    // Update App Deep Links
    const gpay = document.getElementById('btn-pay-gpay');
    const phonepe = document.getElementById('btn-pay-phonepe');
    const paytm = document.getElementById('btn-pay-paytm');
    const bhim = document.getElementById('btn-pay-bhim');

    if (gpay) gpay.href = `tez://upi/pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
    if (phonepe) phonepe.href = `phonepe://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
    if (paytm) paytm.href = `paytmmp://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
    if (bhim) bhim.href = upiUri;

    // Update Bonus Preview
    const bonusTag = document.getElementById('bonus-preview-tag');
    if (bonusTag) {
        if (amount >= 200) {
            bonusTag.textContent = 'Bonus: +₹200.00 VIP Promo';
            bonusTag.style.color = '#FBBF24';
        } else {
            bonusTag.textContent = 'Min ₹200 for ₹200 Bonus';
            bonusTag.style.color = '#94A3B8';
        }
    }
}

// Deposit Amount Selection
export function selectDepositAmount(amt) {
    walletState.selectedDepositAmount = Number(amt);
    const input = document.getElementById('deposit-amount-input');
    if (input) input.value = amt;

    // Toggle active chips
    document.querySelectorAll('.amount-chip').forEach(chip => {
        const chipAmt = Number(chip.getAttribute('data-amt'));
        chip.classList.toggle('active', chipAmt === amt);
    });

    updateDepositGateway();
}
window.selectDepositAmount = selectDepositAmount;

// Custom Deposit Input Handler
export function onDepositAmountChange() {
    const input = document.getElementById('deposit-amount-input');
    if (!input) return;
    const val = Number(input.value) || 0;
    walletState.selectedDepositAmount = val;

    document.querySelectorAll('.amount-chip').forEach(chip => {
        const chipAmt = Number(chip.getAttribute('data-amt'));
        chip.classList.toggle('active', chipAmt === val);
    });

    updateDepositGateway();
}
window.onDepositAmountChange = onDepositAmountChange;

// Copy Merchant UPI ID
export function copyMerchantUpi() {
    const upiDisplay = document.getElementById('official-upi-id-display');
    const val = upiDisplay ? upiDisplay.value : walletState.upiId;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(val).then(() => {
            showToast(`UPI ID "${val}" copied to clipboard!`, 'success');
        });
    } else {
        showToast(`UPI ID: ${val}`, 'success');
    }
}
window.copyMerchantUpi = copyMerchantUpi;

// UTR Input Auto-Filter
export function validateUtrInput() {
    const input = document.getElementById('utr-number-input');
    if (input) {
        input.value = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    }
}
window.validateUtrInput = validateUtrInput;

// Bank IFSC Real-time Detector
export function onIfscLookup(ifscVal) {
    const clean = String(ifscVal || '').trim().toUpperCase();
    const badge = document.getElementById('bank-detected-name');
    const label = document.getElementById('detected-bank-label');

    if (!clean || clean.length < 4) {
        if (badge) badge.style.display = 'none';
        return;
    }

    const prefix = clean.slice(0, 4);
    const bankName = IFSC_BANKS[prefix] || (clean.length >= 8 ? 'Verified Indian Commercial Bank' : null);

    if (bankName && badge && label) {
        label.textContent = bankName;
        badge.style.display = 'inline-flex';
    } else if (badge) {
        badge.style.display = 'none';
    }
}
window.onIfscLookup = onIfscLookup;

// Check Matching Account Numbers
export function checkAccountMatching() {
    const acc1 = document.getElementById('withdraw-acc-number')?.value || '';
    const acc2 = document.getElementById('withdraw-acc-confirm')?.value || '';
    const badge = document.getElementById('acc-match-badge');

    if (!badge) return;

    if (acc2.length > 0) {
        badge.style.display = 'inline-flex';
        if (acc1 === acc2) {
            badge.style.color = '#10B981';
            badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            badge.style.background = 'rgba(16, 185, 129, 0.1)';
            badge.textContent = '✓ Account Numbers Match';
        } else {
            badge.style.color = '#EF4444';
            badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            badge.style.background = 'rgba(239, 68, 68, 0.1)';
            badge.textContent = '⚠ Account numbers do not match';
        }
    } else {
        badge.style.display = 'none';
    }
}
window.checkAccountMatching = checkAccountMatching;

// Handle Deposit Submission
export async function handleDepositSubmit() {
    const amt = Number(walletState.selectedDepositAmount);
    const utrInput = document.getElementById('utr-number-input');
    const utr = utrInput ? utrInput.value.trim() : '';

    if (!amt || amt < 200) {
        showToast('Minimum recharge amount is ₹200', 'error');
        return;
    }
    if (amt > 100000) {
        showToast('Maximum recharge amount is ₹1,00,000', 'error');
        return;
    }
    if (!utr || utr.length < 8) {
        showToast('Please enter a valid 12-Digit UTR / Transaction Reference Number', 'error');
        return;
    }

    const btn = document.getElementById('btn-submit-deposit');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Verifying & Submitting...</span>';
    }

    try {
        const res = await walletService.submitDepositRequest({
            amount: amt,
            utrNumber: utr,
            upiId: walletState.upiId,
            channel: 'UPI_FAST'
        });

        if (res && res.success) {
            // Trigger Clean Auto-Redirect Overlay
            const overlay = document.getElementById('redirect-overlay');
            const heading = document.getElementById('redirect-modal-heading');
            const desc = document.getElementById('redirect-modal-message');
            const countdown = document.getElementById('countdown-indicator');

            if (heading) heading.textContent = 'PAYMENT SUBMITTED';
            if (desc) desc.textContent = `₹${amt.toLocaleString('en-IN')} recharge recorded (UTR: ${utr}). Real-time balance and ₹200 bonus will update in your game wallet.`;
            if (overlay) overlay.classList.add('active');

            let timeLeft = 3;
            const timer = setInterval(() => {
                timeLeft -= 1;
                if (countdown) countdown.textContent = `Redirecting to Game in ${timeLeft}s...`;
                if (timeLeft <= 0) {
                    clearInterval(timer);
                    window.location.href = 'index.html';
                }
            }, 1000);
        } else {
            showToast(res.message || 'Deposit submission failed', 'error');
        }
    } catch (err) {
        showToast(err.message || 'Payment submission failed. Please retry.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>CONFIRM & SUBMIT RECHARGE</span><span>→</span>';
        }
    }
}
window.handleDepositSubmit = handleDepositSubmit;

// Handle Bank Withdrawal Submission
export async function handleWithdrawSubmit() {
    const accName = document.getElementById('withdraw-acc-name')?.value.trim() || '';
    const accNum = document.getElementById('withdraw-acc-number')?.value.trim() || '';
    const accConfirm = document.getElementById('withdraw-acc-confirm')?.value.trim() || '';
    const ifsc = document.getElementById('withdraw-ifsc')?.value.trim().toUpperCase() || '';
    const amt = Number(document.getElementById('withdraw-amount-input')?.value) || 0;
    const pin = document.getElementById('withdraw-security-pin')?.value.trim() || '';

    if (!accName || accName.length < 3) {
        showToast('Please enter the Account Holder Name as in bank records', 'error');
        return;
    }
    if (!accNum || accNum.length < 6) {
        showToast('Please enter a valid Bank Account Number', 'error');
        return;
    }
    if (accNum !== accConfirm) {
        showToast('Bank Account Numbers do not match', 'error');
        return;
    }
    if (!ifsc || ifsc.length < 8) {
        showToast('Please enter a valid Bank IFSC Code (e.g. SBIN0001234)', 'error');
        return;
    }
    if (!amt || amt < 200) {
        showToast('Minimum bank withdrawal is ₹200', 'error');
        return;
    }
    if (amt > 100000) {
        showToast('Maximum withdrawal per request is ₹1,00,000', 'error');
        return;
    }
    if (amt > walletState.realBalance) {
        showToast(`Insufficient real balance. Available: ${formatCurrency(walletState.realBalance)}`, 'error');
        return;
    }

    const btn = document.getElementById('btn-submit-withdraw');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Processing Request...</span>';
    }

    try {
        const prefix = ifsc.slice(0, 4);
        const bankName = IFSC_BANKS[prefix] || 'Commercial Bank';

        const res = await walletService.submitBankWithdrawal({
            amount: amt,
            accountHolderName: accName,
            bankName: bankName,
            accountNumber: accNum,
            ifsc: ifsc,
            securityPin: pin
        });

        if (res && res.success) {
            walletState.realBalance = res.newBalance !== undefined ? res.newBalance : Math.max(0, walletState.realBalance - amt);
            renderBalances();

            // Clear inputs
            if (document.getElementById('withdraw-acc-number')) document.getElementById('withdraw-acc-number').value = '';
            if (document.getElementById('withdraw-acc-confirm')) document.getElementById('withdraw-acc-confirm').value = '';
            if (document.getElementById('withdraw-security-pin')) document.getElementById('withdraw-security-pin').value = '';

            showToast(`Withdrawal request of ₹${amt.toLocaleString('en-IN')} submitted! Funds will credit within 2-24 hours.`, 'success');
            setTimeout(() => {
                switchTab('history');
            }, 1200);
        } else {
            showToast(res.message || 'Withdrawal request failed', 'error');
        }
    } catch (err) {
        showToast(err.message || 'Withdrawal request failed', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>REQUEST BANK PAYOUT</span><span>→</span>';
        }
    }
}
window.handleWithdrawSubmit = handleWithdrawSubmit;

// Fetch and Render Transactions Passbook
export async function fetchTransactions() {
    const container = document.getElementById('history-items-container');
    const indicator = document.getElementById('tx-count-indicator');
    if (!container) return;

    try {
        const res = await walletService.getTransactions();
        if (res && res.success && Array.isArray(res.items)) {
            walletState.transactions = res.items;
            renderTransactionList();
        }
    } catch (e) {
        container.innerHTML = `<div class="empty-history-box">Unable to load transactions</div>`;
    }
}

export function filterTransactions(filterType, pillEl) {
    walletState.currentFilter = filterType;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    if (pillEl) pillEl.classList.add('active');
    renderTransactionList();
}
window.filterTransactions = filterTransactions;

function renderTransactionList() {
    const container = document.getElementById('history-items-container');
    const indicator = document.getElementById('tx-count-indicator');
    if (!container) return;

    let items = [...walletState.transactions];
    if (walletState.currentFilter !== 'ALL') {
        items = items.filter(t => t.type === walletState.currentFilter);
    }

    if (indicator) indicator.textContent = `${items.length} Records`;

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-history-box">
                <div style="font-size: 1.8rem; margin-bottom: 6px;">📂</div>
                <div>No ${walletState.currentFilter === 'ALL' ? '' : walletState.currentFilter.toLowerCase()} transactions found</div>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(tx => {
        const isDep = tx.type === 'DEPOSIT';
        const isPending = tx.status === 'PENDING';
        const isApproved = tx.status === 'APPROVED';
        const isRejected = tx.status === 'REJECTED';

        const statusClass = isPending ? 'status-pending' : (isApproved ? 'status-approved' : 'status-rejected');
        const statusLabel = isPending ? 'Processing (Within 24h)' : (isApproved ? 'Success / Credited' : 'Rejected');

        const title = isDep ? 'Deposit (Instant UPI)' : `Bank Withdrawal (${tx.bankName || 'Bank'})`;
        const sub = isDep ? `UTR: ${tx.utrNumber || 'N/A'}` : `A/C: •••• ${String(tx.accountNumber || '').slice(-4)}`;

        return `
            <div class="history-card">
                <div class="tx-left">
                    <div class="tx-icon-wrap ${isDep ? 'deposit' : 'withdraw'}">
                        ${isDep ? '📥' : '📤'}
                    </div>
                    <div>
                        <div class="tx-title">${title}</div>
                        <div class="tx-time">${formatTime(tx.createdAt)} • ${sub}</div>
                    </div>
                </div>
                <div class="tx-right">
                    <div class="tx-amount ${isDep ? 'pos' : 'neg'}">
                        ${isDep ? '+' : '-'}₹${Number(tx.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                    <span class="tx-status-badge ${statusClass}">${statusLabel}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Real-time Firestore sync
try {
    subscribeToUserBalance(currentUserId, (userData) => {
        if (userData && typeof userData.balance === 'number') {
            walletState.realBalance = userData.balance;
            if (typeof userData.bonusBalance === 'number') {
                walletState.bonusBalance = userData.bonusBalance;
            }
            renderBalances();
        }
    });
} catch (e) {
    console.warn('Realtime listener in payment hub:', e);
}

// Initial Bootstrapping
document.addEventListener('DOMContentLoaded', () => {
    // Check initial tab in URL hash or query params (?tab=withdraw)
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam && ['deposit', 'withdraw', 'history'].includes(tabParam)) {
        switchTab(tabParam);
    } else {
        switchTab('deposit');
    }

    refreshWalletData(true);
    selectDepositAmount(200);
});
