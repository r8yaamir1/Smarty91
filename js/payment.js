// js/payment.js - Professional 3-Stage Checkout & Cashier Controller for Smarty91
// Direct UPI + Dynamic QR (6289140468@axl / Smarty91)

let currentDepositAmount = 200;
let currentBonusAmount = 200;
let selectedChannel = 'GPAY';
let countdownInterval = null;
let secondsRemaining = 600; // 10 minutes
let currentWalletSummary = null;
let activeMerchantUpi = '6289140468@axl';
let activeMerchantName = 'Smarty91';

// Load live merchant UPI config
async function fetchMerchantConfig() {
    try {
        const res = await fetch('/api/wallet/config');
        const data = await res.json();
        if (data.success && data.upiId) {
            activeMerchantUpi = data.upiId;
            activeMerchantName = data.upiName || 'Smarty91';
            const upiTextEl = document.getElementById('upi-merchant-id');
            if (upiTextEl) upiTextEl.textContent = activeMerchantUpi;
        }
    } catch (e) {
        console.warn('Using default merchant UPI config', e);
    }
}
fetchMerchantConfig();

// Toast Helper
function showToast(msg, duration = 3000) {
    const toast = document.getElementById('cashier-toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}

// Calculate bonus for any given amount
function computeBonusForAmount(amount) {
    const num = Number(amount) || 0;
    if (num >= 50000) return Math.round(num * 0.40);
    if (num >= 10000) return Math.round(num * 0.30);
    if (num >= 5000) return Math.round(num * 0.25);
    if (num >= 2000) return Math.round(num * 0.20);
    if (num >= 1000) return 250;
    if (num >= 500) return 150;
    if (num >= 200) return 200;
    return 0;
}

// Load initial user wallet data
async function loadWalletData() {
    const token = localStorage.getItem('smarty91_auth_token');
    if (!token) {
        window.location.replace('login.html');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Loading Cashier...');

        const res = await fetch('/api/wallet/summary', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Failed to load wallet data');
            return;
        }

        currentWalletSummary = data.summary;
        renderHeaderWalletInfo();
        renderTransactionsHistory();
    } catch (err) {
        showToast('Network error loading wallet data');
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
}

// Render header balances
function renderHeaderWalletInfo() {
    if (!currentWalletSummary) return;

    const balanceEl = document.getElementById('header-user-balance');
    const bonusEl = document.getElementById('header-user-bonus');
    const phoneEl = document.getElementById('header-user-phone');
    const availBalEl = document.getElementById('withdraw-available-bal');

    const bal = Number(currentWalletSummary.balance || 0);
    const bonus = Number(currentWalletSummary.bonusBalance || 0);
    const phone = currentWalletSummary.phone || localStorage.getItem('smarty91_user_phone') || 'VIP Player';

    if (balanceEl) balanceEl.innerText = `₹${bal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    if (bonusEl) bonusEl.innerText = `₹${bonus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    if (phoneEl) {
        const masked = phone.length === 10 ? `+91 ${phone.slice(0, 2)}****${phone.slice(6)}` : `+91 ${phone}`;
        phoneEl.innerText = masked;
    }
    if (availBalEl) availBalEl.innerText = `₹${bal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

// Global Tab Switcher (Deposit, Withdraw, Passbook)
window.switchCashierTab = function(tabName) {
    const depositSec = document.getElementById('section-deposit');
    const withdrawSec = document.getElementById('section-withdraw');
    const historySec = document.getElementById('section-history');

    const depositTabBtn = document.getElementById('tab-btn-deposit');
    const withdrawTabBtn = document.getElementById('tab-btn-withdraw');
    const historyTabBtn = document.getElementById('tab-btn-history');

    const mainTitle = document.getElementById('page-main-title');

    // Reset tab active states
    [depositTabBtn, withdrawTabBtn, historyTabBtn].forEach(b => {
        if (b) b.classList.remove('active');
    });

    if (tabName === 'deposit') {
        if (depositSec) depositSec.style.display = 'block';
        if (withdrawSec) withdrawSec.style.display = 'none';
        if (historySec) historySec.style.display = 'none';
        if (depositTabBtn) depositTabBtn.classList.add('active');
        if (mainTitle) mainTitle.innerText = 'Deposit Funds';
    } else if (tabName === 'withdraw') {
        if (depositSec) depositSec.style.display = 'none';
        if (withdrawSec) withdrawSec.style.display = 'block';
        if (historySec) historySec.style.display = 'none';
        if (withdrawTabBtn) withdrawTabBtn.classList.add('active');
        if (mainTitle) mainTitle.innerText = 'Bank Withdrawal';
    } else if (tabName === 'history') {
        if (depositSec) depositSec.style.display = 'none';
        if (withdrawSec) withdrawSec.style.display = 'none';
        if (historySec) historySec.style.display = 'block';
        if (historyTabBtn) historyTabBtn.classList.add('active');
        if (mainTitle) mainTitle.innerText = 'Transaction Passbook';
        loadWalletData();
    }
};

// Stage Navigation for Deposit Flow (1, 2, 3)
window.goToDepositStage = function(stageNumber) {
    const stage1 = document.getElementById('deposit-stage-1');
    const stage2 = document.getElementById('deposit-stage-2');
    const stage3 = document.getElementById('deposit-stage-3');

    const step1Ind = document.getElementById('wizard-step-1-indicator');
    const step2Ind = document.getElementById('wizard-step-2-indicator');
    const step3Ind = document.getElementById('wizard-step-3-indicator');

    const line1 = document.getElementById('wizard-line-1');
    const line2 = document.getElementById('wizard-line-2');

    if (stageNumber === 1) {
        if (stage1) stage1.style.display = 'block';
        if (stage2) stage2.style.display = 'none';
        if (stage3) stage3.style.display = 'none';

        step1Ind.className = 'step-item active';
        step2Ind.className = 'step-item';
        step3Ind.className = 'step-item';
        if (line1) line1.className = 'step-line';
        if (line2) line2.className = 'step-line';
        clearInterval(countdownInterval);
    } else if (stageNumber === 2) {
        if (currentDepositAmount < 200) {
            showToast('Minimum deposit is ₹200');
            return;
        }
        if (stage1) stage1.style.display = 'none';
        if (stage2) stage2.style.display = 'block';
        if (stage3) stage3.style.display = 'none';

        step1Ind.className = 'step-item completed';
        step2Ind.className = 'step-item active';
        step3Ind.className = 'step-item';
        if (line1) line1.className = 'step-line completed';
        if (line2) line2.className = 'step-line';

        const stage2Amount = document.getElementById('stage-2-amount-display');
        if (stage2Amount) stage2Amount.innerText = `₹${currentDepositAmount.toLocaleString('en-IN')}`;
    } else if (stageNumber === 3) {
        if (stage1) stage1.style.display = 'none';
        if (stage2) stage2.style.display = 'none';
        if (stage3) stage3.style.display = 'block';

        step1Ind.className = 'step-item completed';
        step2Ind.className = 'step-item completed';
        step3Ind.className = 'step-item active';
        if (line1) line1.className = 'step-line completed';
        if (line2) line2.className = 'step-line completed';
    }
};

// Select Quick Amount Pill
window.selectDepositAmount = function(amount, bonus) {
    currentDepositAmount = Number(amount);
    currentBonusAmount = Number(bonus);

    // Update Pill active styling
    const pills = document.querySelectorAll('.amount-pill-card');
    pills.forEach(p => p.classList.remove('selected'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('selected');
    }

    const customInput = document.getElementById('custom-deposit-input');
    if (customInput) customInput.value = amount;

    updateBonusPreviewCard();
};

// Handle Custom Input
window.handleCustomDepositChange = function(val) {
    const num = Number(val) || 0;
    currentDepositAmount = num;
    currentBonusAmount = computeBonusForAmount(num);

    // Remove pill selection if not exact match
    const pills = document.querySelectorAll('.amount-pill-card');
    pills.forEach(p => p.classList.remove('selected'));

    updateBonusPreviewCard();
};

function updateBonusPreviewCard() {
    const titleEl = document.getElementById('bonus-card-title');
    const descEl = document.getElementById('bonus-card-desc');
    const amtEl = document.getElementById('bonus-card-amount');

    if (currentDepositAmount >= 200) {
        if (currentBonusAmount > 0) {
            if (titleEl) titleEl.innerText = currentDepositAmount === 200 ? '100% First Deposit Match Bonus' : 'VIP Tier Match Bonus';
            if (descEl) descEl.innerText = `Deposit ₹${currentDepositAmount.toLocaleString('en-IN')} & get ₹${(currentDepositAmount + currentBonusAmount).toLocaleString('en-IN')} total playing credit`;
            if (amtEl) amtEl.innerText = `+₹${currentBonusAmount.toLocaleString('en-IN')}`;
        } else {
            if (titleEl) titleEl.innerText = 'Standard Fast Deposit';
            if (descEl) descEl.innerText = `Deposit ₹${currentDepositAmount.toLocaleString('en-IN')} instant play credit`;
            if (amtEl) amtEl.innerText = '+₹0';
        }
    } else {
        if (titleEl) titleEl.innerText = 'Minimum Deposit is ₹200';
        if (descEl) descEl.innerText = 'Please select at least ₹200 to receive instant VIP Bonus';
        if (amtEl) amtEl.innerText = '+₹0';
    }
}

// Payment Channel Selection (Stage 2)
window.selectPaymentChannel = function(channelCode, cardElement) {
    selectedChannel = channelCode;
    const cards = document.querySelectorAll('.payment-channel-card');
    cards.forEach(c => c.classList.remove('selected'));
    if (cardElement) cardElement.classList.add('selected');
};

// Start Stage 3 (Generate Dynamic QR and Start 10-Minute Countdown)
window.startDepositCheckoutPhase = function() {
    if (currentDepositAmount < 200) {
        showToast('Minimum deposit amount is ₹200');
        return;
    }

    goToDepositStage(3);

    // Update Amount & Bonus displays
    const st3Amt = document.getElementById('stage-3-amount-display');
    const st3Bonus = document.getElementById('stage-3-bonus-display');
    if (st3Amt) st3Amt.innerText = `₹${currentDepositAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    if (st3Bonus) st3Bonus.innerText = currentBonusAmount > 0 ? `+ Includes ₹${currentBonusAmount.toLocaleString('en-IN')} VIP Bonus` : '+ 100% Secure & Fast Deposit';

    // Construct Exact Amount UPI URI
    const upiId = activeMerchantUpi || '6289140468@axl';
    const upiName = activeMerchantName || 'Smarty91';
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${encodeURIComponent(currentDepositAmount.toFixed(2))}&cu=INR&tn=VIP_DEP_${Date.now()}`;

    // Update UPI text display
    const upiTextEl = document.getElementById('upi-merchant-id');
    if (upiTextEl) upiTextEl.textContent = upiId;

    // Set Dynamic QR Image URL
    const qrImg = document.getElementById('dynamic-qr-image');
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=10&data=${encodeURIComponent(upiUri)}`;
    }

    // Set Direct UPI App Deep Link
    const directLink = document.getElementById('upi-direct-app-link');
    if (directLink) {
        directLink.href = upiUri;
    }

    // Start 10-Minute Countdown Timer
    startCountdownTimer(600);
};

// 10-Minute Countdown Timer Logic
function startCountdownTimer(durationSeconds) {
    clearInterval(countdownInterval);
    secondsRemaining = durationSeconds;

    const timerDisplay = document.getElementById('checkout-timer-display');

    function tick() {
        const minutes = Math.floor(secondsRemaining / 60);
        const seconds = secondsRemaining % 60;
        const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (timerDisplay) {
            timerDisplay.innerText = formatted;
        }

        if (secondsRemaining <= 0) {
            clearInterval(countdownInterval);
            showToast('Payment session expired. Please start again.');
            goToDepositStage(1);
        } else {
            secondsRemaining--;
        }
    }

    tick();
    countdownInterval = setInterval(tick, 1000);
}

// Copy UPI ID helper
window.copyUpiId = function() {
    const upiId = activeMerchantUpi || '6289140468@axl';
    navigator.clipboard.writeText(upiId)
        .then(() => showToast('Official UPI ID copied: ' + upiId))
        .catch(() => showToast('UPI ID: ' + upiId));
};

// Cancel Deposit Session
window.cancelDepositSession = function() {
    clearInterval(countdownInterval);
    goToDepositStage(1);
};

// Submit Deposit UTR Verification
window.submitDepositUTR = async function() {
    const token = localStorage.getItem('smarty91_auth_token');
    const utrInput = document.getElementById('utr-number-input');
    const submitBtn = document.getElementById('submit-deposit-btn');
    const utr = utrInput ? utrInput.value.trim() : '';

    if (!utr || utr.length < 6) {
        showToast('Please enter a valid 12-digit UTR / Ref number');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Submitting UTR Verification...');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'Submitting...';
        }

        const res = await fetch('/api/wallet/deposit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount: currentDepositAmount,
                utrNumber: utr,
                upiId: activeMerchantUpi || '6289140468@axl',
                channel: selectedChannel
            })
        });

        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Deposit submission failed');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Submit UTR Verification';
            }
            return;
        }

        clearInterval(countdownInterval);
        showToast('Deposit request submitted! Credited upon verification within 2-5 minutes.');

        if (utrInput) utrInput.value = '';

        // Switch to History tab after short delay
        setTimeout(() => {
            switchCashierTab('history');
            goToDepositStage(1);
        }, 1200);

    } catch (err) {
        showToast('Network error during deposit submission');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Submit UTR Verification';
        }
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
};

// Withdraw All helper
window.withdrawAllBalance = function() {
    const bal = currentWalletSummary ? Number(currentWalletSummary.balance || 0) : 0;
    const input = document.getElementById('withdraw-amount-input');
    if (input) input.value = Math.floor(bal);
};

// Submit Withdrawal Request
window.submitWithdrawalRequest = async function() {
    const token = localStorage.getItem('smarty91_auth_token');
    const amountInput = document.getElementById('withdraw-amount-input');
    const holderInput = document.getElementById('withdraw-holder-input');
    const accountInput = document.getElementById('withdraw-account-input');
    const ifscInput = document.getElementById('withdraw-ifsc-input');
    const bankNameInput = document.getElementById('withdraw-bank-name-input');
    const pinInput = document.getElementById('withdraw-pin-input');
    const submitBtn = document.getElementById('submit-withdraw-btn');

    const amount = Number(amountInput ? amountInput.value : 0);
    const holderName = holderInput ? holderInput.value.trim() : '';
    const accountNum = accountInput ? accountInput.value.trim() : '';
    const ifsc = ifscInput ? ifscInput.value.trim().toUpperCase() : '';
    const bankName = bankNameInput ? bankNameInput.value.trim() : 'Bank Transfer';
    const pin = pinInput ? pinInput.value.trim() : '';

    if (isNaN(amount) || amount < 200) {
        showToast('Minimum withdrawal amount is ₹200');
        return;
    }
    if (!accountNum || accountNum.length < 6) {
        showToast('Please enter a valid bank account number');
        return;
    }
    if (!ifsc || ifsc.length < 8) {
        showToast('Please enter a valid Bank IFSC code');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Processing Withdrawal Request...');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'Submitting...';
        }

        const res = await fetch('/api/wallet/withdraw', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount,
                accountHolderName: holderName,
                bankName,
                accountNumber: accountNum,
                ifsc,
                securityPin: pin
            })
        });

        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Withdrawal failed');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Submit Withdrawal Request';
            }
            return;
        }

        showToast(data.message || 'Withdrawal request submitted successfully!');

        // Clear inputs
        if (amountInput) amountInput.value = '';
        if (pinInput) pinInput.value = '';

        // Refresh wallet
        loadWalletData();

        setTimeout(() => {
            switchCashierTab('history');
        }, 1200);

    } catch (err) {
        showToast('Network error during withdrawal submission');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Submit Withdrawal Request';
        }
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
};

// Render Transaction History (Passbook)
async function renderTransactionsHistory() {
    const listContainer = document.getElementById('history-items-list');
    if (!listContainer) return;

    const token = localStorage.getItem('smarty91_auth_token');

    try {
        const res = await fetch('/api/wallet/ledger', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.success || !Array.isArray(data.items) || data.items.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 2.5rem 1rem; color: #94A3B8;">
                    <div style="font-size: 2rem; margin-bottom: 8px;">📑</div>
                    <div style="font-weight: 700; color: #475569;">No Transactions Recorded Yet</div>
                    <div style="font-size: 0.75rem; margin-top: 4px;">Your deposits and withdrawals will appear here.</div>
                </div>
            `;
            return;
        }

        let html = '';
        data.items.slice(0, 30).forEach(item => {
            const isCredit = item.amount > 0;
            const amountFormatted = `${isCredit ? '+' : ''}₹${Math.abs(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'Recent';

            let statusBadge = '';
            if (item.type.includes('DEPOSIT')) {
                statusBadge = `<span class="status-badge approved">Deposit</span>`;
            } else if (item.type.includes('WITHDRAWAL')) {
                statusBadge = `<span class="status-badge pending">Withdrawal</span>`;
            } else if (item.type.includes('BONUS')) {
                statusBadge = `<span class="status-badge approved">VIP Bonus</span>`;
            } else if (item.type.includes('WIN')) {
                statusBadge = `<span class="status-badge approved">Game Win</span>`;
            } else {
                statusBadge = `<span class="status-badge pending">${item.type}</span>`;
            }

            html += `
                <div class="history-card-item">
                    <div>
                        <div class="history-left-title">${item.description || item.type}</div>
                        <div class="history-time">${dateStr} • Ref: ${item.referenceId || 'N/A'}</div>
                    </div>
                    <div class="history-right-val">
                        <div class="history-amount" style="color: ${isCredit ? '#10B981' : '#E51837'};">${amountFormatted}</div>
                        <div>${statusBadge}</div>
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;

    } catch (e) {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #EF4444; font-size: 0.85rem;">
                Failed to load transaction history.
            </div>
        `;
    }
}

// Initial setup on page load
window.addEventListener('DOMContentLoaded', () => {
    loadWalletData();
    updateBonusPreviewCard();

    // Check URL query parameters for active tab (e.g. ?tab=withdraw or ?tab=history)
    const urlParams = new URLSearchParams(window.location.search);
    const requestedTab = urlParams.get('tab');
    if (requestedTab && ['deposit', 'withdraw', 'history'].includes(requestedTab)) {
        window.switchCashierTab(requestedTab);
    }
});
