// js/payment.js - Professional 3-Stage Checkout & Cashier Controller for Smarty91
// Direct UPI + Dynamic QR + USDT Crypto Automatic Verification

let currentDepositAmount = 200;
let currentBonusAmount = 200;
let selectedChannel = 'BHIM_UPI';
let currentPlatform = 'INR';
let currentDepositAmountUsdt = 10;
let countdownInterval = null;
let secondsRemaining = 600; // 10 minutes
let currentWalletSummary = null;
let activeMerchantUpi = '6289140468@axl';
let activeMerchantName = 'Smarty91';
let activeMerchantUsdtAddress = 'TEX8NYBX78GkaStcmtp8UJGF7GJsrAnvHh';
let activeUsdtRate = 90;

// Load live merchant config (UPI & USDT)
async function fetchMerchantConfig() {
    try {
        const res = await fetch('/api/wallet/config');
        const data = await res.json();
        if (data.success) {
            if (data.upiId) {
                activeMerchantUpi = data.upiId;
                activeMerchantName = data.upiName || 'Smarty91';
                const upiTextEl = document.getElementById('upi-merchant-id');
                if (upiTextEl) upiTextEl.textContent = activeMerchantUpi;
            }
            if (data.usdtAddress) {
                activeMerchantUsdtAddress = data.usdtAddress;
                const usdtAddrEl = document.getElementById('usdt-merchant-address');
                if (usdtAddrEl) usdtAddrEl.textContent = activeMerchantUsdtAddress;
            }
            if (data.usdtRate) {
                activeUsdtRate = Number(data.usdtRate) || 90;
            }
        }
    } catch (e) {
        console.warn('Using default merchant config', e);
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

// Calculate bonus for any given amount (100% Match Bonus for all deposits >= 200)
function computeBonusForAmount(amount) {
    const num = Number(amount) || 0;
    if (num >= 200) {
        return num; // 100% bonus matching deposit amount
    }
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
        if (window.revealPageReady) {
            window.revealPageReady('.cashier-page-container');
        }
    } catch (err) {
        showToast('Network error loading wallet data');
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
        if (depositSec) {
            depositSec.style.display = 'block';
            if (window.applyTabAnimation) window.applyTabAnimation(depositSec);
        }
        if (withdrawSec) withdrawSec.style.display = 'none';
        if (historySec) historySec.style.display = 'none';
        if (depositTabBtn) depositTabBtn.classList.add('active');
        if (mainTitle) mainTitle.innerText = 'Deposit Funds';
    } else if (tabName === 'withdraw') {
        if (depositSec) depositSec.style.display = 'none';
        if (withdrawSec) {
            withdrawSec.style.display = 'block';
            if (window.applyTabAnimation) window.applyTabAnimation(withdrawSec);
        }
        if (historySec) historySec.style.display = 'none';
        if (withdrawTabBtn) withdrawTabBtn.classList.add('active');
        if (mainTitle) mainTitle.innerText = 'Withdraw Funds';
        switchWithdrawMethod('USDT');
    } else if (tabName === 'history') {
        if (depositSec) depositSec.style.display = 'none';
        if (withdrawSec) withdrawSec.style.display = 'none';
        if (historySec) {
            historySec.style.display = 'block';
            if (window.applyTabAnimation) window.applyTabAnimation(historySec);
        }
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
        if (stage1) {
            stage1.style.display = 'block';
            if (window.applyTabAnimation) window.applyTabAnimation(stage1);
        }
        if (stage2) stage2.style.display = 'none';
        if (stage3) stage3.style.display = 'none';

        if (step1Ind) step1Ind.className = 'step-item active';
        if (step2Ind) step2Ind.className = 'step-item';
        if (step3Ind) step3Ind.className = 'step-item';
        if (line1) line1.className = 'step-line';
        if (line2) line2.className = 'step-line';
        clearInterval(countdownInterval);
    } else if (stageNumber === 2) {
        if (stage1) stage1.style.display = 'none';
        if (stage2) {
            stage2.style.display = 'block';
            if (window.applyTabAnimation) window.applyTabAnimation(stage2);
        }
        if (stage3) stage3.style.display = 'none';

        const inrPanel = document.getElementById('inr-stage2-panel');
        const usdtPanel = document.getElementById('usdt-stage2-panel');

        if (currentPlatform === 'INR') {
            if (inrPanel) inrPanel.style.display = 'block';
            if (usdtPanel) usdtPanel.style.display = 'none';
            selectDepositAmount(currentDepositAmount, currentBonusAmount);
        } else {
            if (inrPanel) inrPanel.style.display = 'none';
            if (usdtPanel) usdtPanel.style.display = 'block';
            selectDepositAmountUsdt(currentDepositAmountUsdt);
        }

        if (step1Ind) step1Ind.className = 'step-item completed';
        if (step2Ind) step2Ind.className = 'step-item active';
        if (step3Ind) step3Ind.className = 'step-item';
        if (line1) line1.className = 'step-line completed';
        if (line2) line2.className = 'step-line';
    } else if (stageNumber === 3) {
        if (stage1) stage1.style.display = 'none';
        if (stage2) stage2.style.display = 'none';
        if (stage3) {
            stage3.style.display = 'block';
            if (window.applyTabAnimation) window.applyTabAnimation(stage3);
        }

        if (step1Ind) step1Ind.className = 'step-item completed';
        if (step2Ind) step2Ind.className = 'step-item completed';
        if (step3Ind) step3Ind.className = 'step-item active';
        if (line1) line1.className = 'step-line completed';
        if (line2) line2.className = 'step-line completed';
    }
};

// Platform selection handler
window.selectPaymentPlatform = function(platform) {
    currentPlatform = platform;

    // Highlight selected card and unhighlight other
    const platformInr = document.getElementById('platform-card-inr');
    const platformUsdt = document.getElementById('platform-card-usdt');

    if (platform === 'INR') {
        if (platformInr) {
            platformInr.classList.add('selected');
            platformInr.style.borderColor = '#FFD700';
        }
        if (platformUsdt) {
            platformUsdt.classList.remove('selected');
            platformUsdt.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        }
        selectedChannel = 'BHIM_UPI'; // Default INR channel
    } else {
        if (platformInr) {
            platformInr.classList.remove('selected');
            platformInr.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        }
        if (platformUsdt) {
            platformUsdt.classList.add('selected');
            platformUsdt.style.borderColor = '#10b981';
        }
        selectedChannel = 'USDT_TRC20'; // Default USDT channel
    }
};

// Select Quick Amount Pill (INR)
window.selectDepositAmount = function(amount, bonus) {
    currentDepositAmount = Number(amount);
    currentBonusAmount = Number(bonus);

    // Update Pill active styling
    const pills = document.querySelectorAll('#inr-stage2-panel .amount-pill-card');
    pills.forEach(p => p.classList.remove('selected'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('selected');
    }

    const customInput = document.getElementById('custom-deposit-input');
    if (customInput) customInput.value = amount;

    updateBonusPreviewCard();
};

// Handle Custom Input (INR)
window.handleCustomDepositChange = function(val) {
    const num = Number(val) || 0;
    currentDepositAmount = num;
    currentBonusAmount = computeBonusForAmount(num);

    // Remove pill selection if not exact match
    const pills = document.querySelectorAll('#inr-stage2-panel .amount-pill-card');
    pills.forEach(p => p.classList.remove('selected'));

    updateBonusPreviewCard();
};

function updateBonusPreviewCard() {
    const titleEl = document.getElementById('bonus-card-title');
    const descEl = document.getElementById('bonus-card-desc');
    const amtEl = document.getElementById('bonus-card-amount');

    if (currentDepositAmount >= 200) {
        if (currentBonusAmount > 0) {
            if (titleEl) {
                titleEl.innerHTML = `<span>100% Deposit Match Bonus</span> <span class="bonus-coupon-tag">COUPON APPLIED</span>`;
            }
            if (descEl) descEl.innerText = `Deposit ₹${currentDepositAmount.toLocaleString('en-IN')} & get ₹${(currentDepositAmount + currentBonusAmount).toLocaleString('en-IN')} total playing credit (Instant 2X)`;
            if (amtEl) amtEl.innerText = `+₹${currentBonusAmount.toLocaleString('en-IN')}`;
        } else {
            if (titleEl) {
                titleEl.innerHTML = `<span>Standard Fast Deposit</span>`;
            }
            if (descEl) descEl.innerText = `Deposit ₹${currentDepositAmount.toLocaleString('en-IN')} instant play credit`;
            if (amtEl) amtEl.innerText = '+₹0';
        }
    } else {
        if (titleEl) {
            titleEl.innerHTML = `<span>Minimum Deposit is ₹200</span>`;
        }
        if (descEl) descEl.innerText = 'Please select at least ₹200 to receive instant 100% Match Bonus';
        if (amtEl) amtEl.innerText = '+₹0';
    }
}

// Select Quick Amount Pill (USDT)
window.selectDepositAmountUsdt = function(usdtAmount) {
    currentDepositAmountUsdt = Number(usdtAmount);

    // Update Pill active styling
    const pills = document.querySelectorAll('#usdt-stage2-panel .amount-pill-card');
    pills.forEach(p => p.classList.remove('selected'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('selected');
    }

    const customInput = document.getElementById('custom-deposit-usdt-input');
    if (customInput) customInput.value = usdtAmount;

    updateUsdtBonusPreviewCard();
};

// Handle Custom Input (USDT)
window.handleCustomDepositUsdtChange = function(val) {
    const num = Number(val) || 0;
    currentDepositAmountUsdt = num;

    // Remove pill selection if not exact match
    const pills = document.querySelectorAll('#usdt-stage2-panel .amount-pill-card');
    pills.forEach(p => p.classList.remove('selected'));

    updateUsdtBonusPreviewCard();
};

function updateUsdtBonusPreviewCard() {
    const titleEl = document.getElementById('usdt-bonus-card-title');
    const descEl = document.getElementById('usdt-bonus-card-desc');
    const amtEl = document.getElementById('usdt-bonus-card-amount');

    const inrValue = currentDepositAmountUsdt * activeUsdtRate;
    const bonusInr = inrValue; // 100% matching bonus

    if (currentDepositAmountUsdt >= 10) {
        if (titleEl) {
            titleEl.innerHTML = `<span>100% USDT Match Bonus</span> <span class="bonus-coupon-tag" style="background: #10b981;">COUPON APPLIED</span>`;
        }
        if (descEl) descEl.innerText = `Deposit $${currentDepositAmountUsdt} USDT (₹${inrValue.toLocaleString('en-IN')}) & get ₹${(inrValue + bonusInr).toLocaleString('en-IN')} total play credit`;
        if (amtEl) amtEl.innerText = `+₹${bonusInr.toLocaleString('en-IN')}`;
    } else {
        if (titleEl) {
            titleEl.innerHTML = `<span>Minimum USDT Deposit is 10</span>`;
        }
        if (descEl) descEl.innerText = 'Please select at least 10 USDT to receive instant 100% Match Bonus';
        if (amtEl) amtEl.innerText = '+₹0';
    }
}

// Quick Add Custom Amount (USDT)
window.addCustomUsdtVal = function(val) {
    const customInput = document.getElementById('custom-deposit-usdt-input');
    if (customInput) {
        let currentVal = Number(customInput.value) || 0;
        customInput.value = currentVal + Number(val);
        handleCustomDepositUsdtChange(customInput.value);
    }
};

// Payment Channel Selection (Stage 2)
window.selectPaymentChannel = function(channelCode, cardElement) {
    selectedChannel = channelCode;
    const cards = document.querySelectorAll('#deposit-stage-2 .payment-channel-card');
    cards.forEach(c => c.classList.remove('selected'));
    if (cardElement) cardElement.classList.add('selected');
};

// Start Stage 3 (Generate Dynamic QR and Start 10-Minute Countdown)
window.startDepositCheckoutPhase = function() {
    if (currentPlatform === 'INR') {
        if (currentDepositAmount < 200) {
            showToast('Minimum deposit amount is ₹200');
            return;
        }
    } else {
        if (currentDepositAmountUsdt < 10) {
            showToast('Minimum deposit amount is 10 USDT');
            return;
        }
    }

    goToDepositStage(3);

    const usdtBox = document.getElementById('usdt-checkout-box');
    const upiBox = document.getElementById('upi-checkout-box');

    if (currentPlatform === 'USDT') {
        if (usdtBox) usdtBox.style.display = 'block';
        if (upiBox) upiBox.style.display = 'none';

        const usdtAmtEl = document.getElementById('usdt-payable-amount');
        const usdtConvEl = document.getElementById('usdt-inr-conversion-display');
        const usdtBonusEl = document.getElementById('usdt-stage3-bonus-display');
        const usdtAddrEl = document.getElementById('usdt-merchant-address');
        const usdtQrImg = document.getElementById('usdt-qr-image');

        const inrEquivalent = currentDepositAmountUsdt * activeUsdtRate;
        const usdtBonusVal = inrEquivalent; // 100% matching bonus

        if (usdtAmtEl) usdtAmtEl.innerText = `$${currentDepositAmountUsdt.toFixed(2)} USDT`;
        if (usdtConvEl) usdtConvEl.innerText = `Equivalent to ₹${inrEquivalent.toLocaleString('en-IN')} (@ ₹${activeUsdtRate.toFixed(2)} / USDT)`;
        if (usdtBonusEl) usdtBonusEl.innerText = `+ Includes ₹${usdtBonusVal.toLocaleString('en-IN')} VIP Bonus`;
        if (usdtAddrEl) usdtAddrEl.textContent = activeMerchantUsdtAddress;
        if (usdtQrImg) {
            usdtQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=10&data=${encodeURIComponent(activeMerchantUsdtAddress)}`;
        }
    } else {
        if (usdtBox) usdtBox.style.display = 'none';
        if (upiBox) upiBox.style.display = 'block';

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
window.copyUpiAddress = window.copyUpiId;

// Copy USDT Address helper
window.copyUsdtAddress = function() {
    const addr = activeMerchantUsdtAddress || 'TEX8NYBX78GkaStcmtp8UJGF7GJsrAnvHh';
    navigator.clipboard.writeText(addr)
        .then(() => showToast('USDT Address Copied!'))
        .catch(() => showToast('Address: ' + addr));
};

// Quick Add Custom Amount (+100, +500, +1000, +5000)
window.addCustomVal = function(delta) {
    const input = document.getElementById('custom-deposit-input');
    let current = Number(input ? input.value : currentDepositAmount) || 0;
    current += delta;
    if (input) input.value = current;
    handleCustomDepositChange(current);
};

// Cancel Deposit Session
window.cancelDepositSession = function() {
    clearInterval(countdownInterval);
    goToDepositStage(1);
};

// Submit USDT Deposit TxID Verification (Blockchain Automatic)
window.submitUsdtDepositTx = async function() {
    const token = localStorage.getItem('smarty91_auth_token');
    const txidInput = document.getElementById('usdt-txid-input');
    const submitBtn = document.getElementById('submit-usdt-deposit-btn');
    const txid = txidInput ? txidInput.value.trim() : '';

    if (!txid || txid.length < 10) {
        showToast('Please enter a valid Transaction ID / Reference No.');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Verifying USDT Transaction...');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'Verifying Transaction...';
        }

        const res = await fetch('/api/wallet/deposit-usdt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                txid,
                amountUsdt: currentPlatform === 'USDT' ? currentDepositAmountUsdt : Number((currentDepositAmount / activeUsdtRate).toFixed(2))
            })
        });

        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'USDT Verification failed');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Verify & Credit USDT';
            }
            return;
        }

        clearInterval(countdownInterval);
        showToast(data.message || 'USDT Deposit Verified! Balance credited.');

        if (txidInput) txidInput.value = '';

        await loadWalletData();

        setTimeout(() => {
            switchCashierTab('history');
            goToDepositStage(1);
        }, 1200);

    } catch (err) {
        showToast('Network error during USDT verification');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Verify & Credit USDT';
        }
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
};

// Submit Deposit UTR Verification
window.submitDepositUTR = async function() {
    const token = localStorage.getItem('smarty91_auth_token');
    const utrInput = document.getElementById('utr-ref-input') || document.getElementById('utr-number-input');
    const submitBtn = document.getElementById('submit-utr-btn') || document.getElementById('submit-deposit-btn');
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
window.submitUtrDeposit = window.submitDepositUTR;

// Withdrawal Method Switcher (USDT vs Bank)
window.switchWithdrawMethod = function(method) {
    const usdtContainer = document.getElementById('withdraw-usdt-form-container');
    const bankContainer = document.getElementById('withdraw-bank-form-container');
    const usdtBtn = document.getElementById('wtab-usdt-btn');
    const bankBtn = document.getElementById('wtab-bank-btn');

    if (method === 'USDT' || method === 'USDT_TRC20') {
        if (usdtContainer) usdtContainer.style.display = 'block';
        if (bankContainer) bankContainer.style.display = 'none';

        if (usdtBtn) {
            usdtBtn.style.background = 'linear-gradient(135deg, #059669 0%, #047857 100%)';
            usdtBtn.style.color = '#FFFFFF';
            usdtBtn.style.border = '1.5px solid #10b981';
            usdtBtn.style.boxShadow = '0 4px 14px rgba(16,185,129,0.35)';
        }
        if (bankBtn) {
            bankBtn.style.background = 'var(--card-elevated)';
            bankBtn.style.color = 'var(--text-muted)';
            bankBtn.style.border = '1px solid rgba(255,255,255,0.1)';
            bankBtn.style.boxShadow = 'none';
        }
    } else {
        if (usdtContainer) usdtContainer.style.display = 'none';
        if (bankContainer) bankContainer.style.display = 'block';

        if (bankBtn) {
            bankBtn.style.background = 'linear-gradient(135deg, #E51837 0%, #C10C27 100%)';
            bankBtn.style.color = '#FFFFFF';
            bankBtn.style.border = '1.5px solid var(--red-primary)';
            bankBtn.style.boxShadow = '0 4px 14px rgba(229,24,55,0.35)';
        }
        if (usdtBtn) {
            usdtBtn.style.background = 'var(--card-elevated)';
            usdtBtn.style.color = 'var(--text-muted)';
            usdtBtn.style.border = '1px solid rgba(255,255,255,0.1)';
            usdtBtn.style.boxShadow = 'none';
        }
    }
};

window.calculateUsdtPayoutAmount = function(inrVal) {
    const num = Number(inrVal) || 0;
    const rate = activeUsdtRate || 90;
    const usdtVal = (num / rate).toFixed(2);
    const getEl = document.getElementById('withdraw-usdt-get-amount');
    if (getEl) getEl.innerText = `$${usdtVal} USDT`;
};

window.withdrawAllBalanceUsdt = function() {
    const bal = currentWalletSummary ? Number(currentWalletSummary.balance || 0) : 0;
    const input = document.getElementById('withdraw-usdt-amount-input');
    if (input) {
        input.value = Math.floor(bal);
        calculateUsdtPayoutAmount(Math.floor(bal));
    }
};

window.submitUsdtWithdrawalRequest = async function() {
    const token = localStorage.getItem('smarty91_auth_token');
    const amountInput = document.getElementById('withdraw-usdt-amount-input');
    const addressInput = document.getElementById('withdraw-usdt-address-input');
    const pinInput = document.getElementById('withdraw-usdt-pin-input');
    const submitBtn = document.getElementById('submit-usdt-withdraw-btn');

    const amount = Number(amountInput ? amountInput.value : 0);
    const usdtAddress = addressInput ? addressInput.value.trim() : '';
    const pin = pinInput ? pinInput.value.trim() : '';

    if (isNaN(amount) || amount < 200) {
        showToast('Minimum withdrawal is 10 USDT (₹200)');
        return;
    }
    if (!usdtAddress || usdtAddress.length < 15) {
        showToast('Please enter a valid USDT wallet address');
        return;
    }

    try {
        if (window.SmartyLoader) window.SmartyLoader.show('Submitting USDT Withdrawal...');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'Submitting Request...';
        }

        const res = await fetch('/api/wallet/withdraw', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount,
                channel: 'USDT',
                usdtAddress,
                securityPin: pin
            })
        });

        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'USDT Withdrawal failed');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Confirm USDT Withdrawal';
            }
            return;
        }

        showToast(data.message || 'USDT Withdrawal request submitted!');

        if (amountInput) amountInput.value = '';
        if (pinInput) pinInput.value = '';

        loadWalletData();

        setTimeout(() => {
            switchCashierTab('history');
        }, 1200);

    } catch (err) {
        showToast('Network error during USDT withdrawal submission');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Confirm USDT Withdrawal';
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
window.fillMaxWithdraw = window.withdrawAllBalance;

// Submit Withdrawal Request
window.submitWithdrawalRequest = async function() {
    const token = localStorage.getItem('smarty91_auth_token');
    const amountInput = document.getElementById('withdraw-amount-input');
    const holderInput = document.getElementById('withdraw-holder-name') || document.getElementById('withdraw-holder-input');
    const accountInput = document.getElementById('withdraw-acc-num') || document.getElementById('withdraw-account-input');
    const ifscInput = document.getElementById('withdraw-ifsc') || document.getElementById('withdraw-ifsc-input');
    const mobileInput = document.getElementById('withdraw-mobile');
    const bankNameInput = document.getElementById('withdraw-bank-name-input');
    const pinInput = document.getElementById('withdraw-pin-input');
    const submitBtn = document.getElementById('withdraw-submit-btn') || document.getElementById('submit-withdraw-btn');

    const amount = Number(amountInput ? amountInput.value : 0);
    const holderName = holderInput ? holderInput.value.trim() : '';
    const accountNum = accountInput ? accountInput.value.trim() : '';
    const ifsc = ifscInput ? ifscInput.value.trim().toUpperCase() : '';
    const bankName = bankNameInput ? bankNameInput.value.trim() : 'Bank Transfer';
    const pin = pinInput ? pinInput.value.trim() : '';
    const mobile = mobileInput ? mobileInput.value.trim() : '';

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
                mobile,
                securityPin: pin
            })
        });

        const data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Withdrawal failed');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Confirm Bank Withdrawal';
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
            submitBtn.innerText = 'Confirm Bank Withdrawal';
        }
    } finally {
        if (window.SmartyLoader) window.SmartyLoader.hide();
    }
};

window.handleWithdrawalSubmit = function(e) {
    if (e && e.preventDefault) e.preventDefault();
    submitWithdrawalRequest();
    return false;
};

// Filter Transactions
let cachedLedgerItems = [];
window.filterTransactions = function(type, btn) {
    const buttons = document.querySelectorAll('.filter-chip-btn');
    buttons.forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    renderFilteredTransactions(type);
};

function renderFilteredTransactions(type) {
    const listContainer = document.getElementById('history-list-container') || document.getElementById('history-items-list');
    if (!listContainer) return;

    let filtered = cachedLedgerItems;
    if (type === 'DEPOSIT') {
        filtered = cachedLedgerItems.filter(item => item.type && item.type.includes('DEPOSIT'));
    } else if (type === 'WITHDRAWAL') {
        filtered = cachedLedgerItems.filter(item => item.type && item.type.includes('WITHDRAW'));
    } else if (type === 'BONUS') {
        filtered = cachedLedgerItems.filter(item => item.type && (item.type.includes('BONUS') || item.type.includes('PROMO')));
    }

    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; color: #94A3B8;">
                <div style="font-size: 2rem; margin-bottom: 8px;">📑</div>
                <div style="font-weight: 700; color: #64748b;">No Transactions Found</div>
                <div style="font-size: 0.75rem; margin-top: 4px;">No records match the selected filter.</div>
            </div>
        `;
        return;
    }

    let html = '';
    filtered.slice(0, 40).forEach(item => {
        const isCredit = item.amount > 0;
        const amountFormatted = `${isCredit ? '+' : ''}₹${Math.abs(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'Recent';

        let statusClass = 'approved';
        let statusLabel = item.type;
        if (item.status === 'PENDING' || item.type.includes('WITHDRAW')) {
            statusClass = item.status === 'APPROVED' ? 'approved' : item.status === 'REJECTED' ? 'rejected' : 'pending';
            statusLabel = item.status || 'PENDING';
        } else if (item.status === 'REJECTED') {
            statusClass = 'rejected';
            statusLabel = 'REJECTED';
        } else {
            statusClass = 'approved';
            statusLabel = item.status || 'COMPLETED';
        }

        html += `
            <div class="passbook-item-card">
                <div>
                    <div class="passbook-item-left">
                        <span>${item.description || item.type}</span>
                    </div>
                    <div class="passbook-item-date">${dateStr} • Ref: ${item.referenceId || 'N/A'}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 0.95rem; font-weight: 900; font-family: 'JetBrains Mono', monospace; color: ${isCredit ? '#10B981' : '#f87171'};">${amountFormatted}</div>
                    <span class="status-badge ${statusClass}">${statusLabel}</span>
                </div>
            </div>
        `;
    });

    listContainer.innerHTML = html;
}

// Render Transaction History (Passbook)
async function renderTransactionsHistory() {
    const listContainer = document.getElementById('history-list-container') || document.getElementById('history-items-list');
    if (!listContainer) return;

    const token = localStorage.getItem('smarty91_auth_token');

    try {
        const res = await fetch('/api/wallet/ledger', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.success || !Array.isArray(data.items) || data.items.length === 0) {
            cachedLedgerItems = [];
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 2.5rem 1rem; color: #94A3B8;">
                    <div style="font-size: 2rem; margin-bottom: 8px;">📑</div>
                    <div style="font-weight: 700; color: #64748b;">No Transactions Recorded Yet</div>
                    <div style="font-size: 0.75rem; margin-top: 4px;">Your deposits and withdrawals will appear here.</div>
                </div>
            `;
            return;
        }

        cachedLedgerItems = data.items;
        renderFilteredTransactions('ALL');

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
