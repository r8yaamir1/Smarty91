// js/adminApp.js - Dedicated Master Admin Dashboard Engine
import { adminService } from './services/adminService.js';

let activeTab = 'outcomes'; // 'outcomes' | 'chances' | 'transactions' | 'exposure' | 'users' | 'rules' | 'logs'
let selectedMode = '30s';   // '30s' | '1m' | '3m' | '5m'
let txFilterType = 'ALL';   // 'ALL' | 'DEPOSIT' | 'WITHDRAWAL'
let txFilterStatus = 'ALL'; // 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'
let liveData = null;
let pollTimer = null;

const NUMBER_PROPERTIES = {
    0: { color: 'violet-red', label: 'Red+Violet (0)' },
    1: { color: 'green', label: 'Green (1)' },
    2: { color: 'red', label: 'Red (2)' },
    3: { color: 'green', label: 'Green (3)' },
    4: { color: 'red', label: 'Red (4)' },
    5: { color: 'violet-green', label: 'Green+Violet (5)' },
    6: { color: 'red', label: 'Red (6)' },
    7: { color: 'green', label: 'Green (7)' },
    8: { color: 'red', label: 'Red (8)' },
    9: { color: 'green', label: 'Green (9)' }
};

let cachedAdminUsers = [];
let userSearchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
    initAuthFlow();
    initTabNavigation();
    initModeChips();
});

function initAuthFlow() {
    const authScreen = document.getElementById('admin-auth-screen');
    const pinInput = document.getElementById('auth-pin-input');
    const submitBtn = document.getElementById('auth-submit-btn');
    const errEl = document.getElementById('auth-error-msg');
    const logoutBtn = document.getElementById('admin-logout-btn');

    const savedPin = sessionStorage.getItem('smarty91_admin_pin') || localStorage.getItem('smarty91_admin_pin');
    if (savedPin) {
        verifyPinAndLoad(savedPin);
    }

    submitBtn.addEventListener('click', () => {
        const pin = pinInput.value.trim();
        if (!pin) {
            showAuthError('Please enter Master PIN');
            return;
        }
        verifyPinAndLoad(pin);
    });

    pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const pin = pinInput.value.trim();
            if (pin) verifyPinAndLoad(pin);
        }
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('smarty91_admin_pin');
            localStorage.removeItem('smarty91_admin_pin');
            if (pollTimer) clearInterval(pollTimer);
            authScreen.style.display = 'flex';
            pinInput.value = '';
        });
    }

    async function verifyPinAndLoad(pin) {
        submitBtn.textContent = 'VERIFYING...';
        submitBtn.disabled = true;
        try {
            await adminService.login(pin);
            sessionStorage.setItem('smarty91_admin_pin', pin);
            authScreen.style.display = 'none';
            startLiveSync();
        } catch (err) {
            showAuthError(err.message || 'Invalid Master PIN');
            submitBtn.textContent = 'ACCESS MASTER CONSOLE';
            submitBtn.disabled = false;
        }
    }

    function showAuthError(msg) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
    }
}

function initTabNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            activeTab = item.dataset.tab;
            renderActiveTab(true);
        });
    });
}

function initModeChips() {
    const chips = document.querySelectorAll('.mode-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedMode = chip.dataset.mode;
            renderActiveTab(true);
        });
    });
}

async function startLiveSync() {
    await fetchAndRefreshData();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchAndRefreshData, 1500);
}

async function fetchAndRefreshData() {
    try {
        liveData = await adminService.getOverview();
        updateTopKpis(liveData.overview);
        renderActiveTab(false);
    } catch (e) {
        console.error('Admin sync error:', e);
    }
}

function updateTopKpis(overview) {
    if (!overview) return;
    const usersEl = document.getElementById('kpi-users');
    if (usersEl) usersEl.textContent = overview.activeUsersCount || 1;

    const volumeEl = document.getElementById('kpi-volume');
    if (volumeEl) volumeEl.textContent = `₹${(overview.totalBetVolume || 0).toLocaleString('en-IN')}`;

    const payoutEl = document.getElementById('kpi-payout');
    if (payoutEl) payoutEl.textContent = `₹${(overview.totalPayoutVolume || 0).toLocaleString('en-IN')}`;

    const profitEl = document.getElementById('kpi-profit');
    if (profitEl) {
        const profit = overview.grossHouseProfit || 0;
        profitEl.textContent = `₹${profit.toLocaleString('en-IN')}`;
        profitEl.style.color = profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    }
}

function renderActiveTab(force = false) {
    if (!liveData) return;
    const container = document.getElementById('tab-view-container');
    if (!container) return;

    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA') && container.contains(activeEl);

    switch (activeTab) {
        case 'outcomes':
            if (!isTyping || force) renderOutcomesView(container);
            break;
        case 'chances':
            if (!isTyping || force) renderChancesView(container);
            break;
        case 'transactions':
            if (!isTyping || force) renderTransactionsView(container);
            break;
        case 'exposure':
            renderExposureView(container);
            break;
        case 'users':
            renderUsersView(container, force);
            break;
        case 'rules':
            renderRulesView(container, force);
            break;
        case 'logs':
            if (!isTyping || force) renderLogsView(container);
            break;
    }
}

// -------------------------------------------------------------
// 1. OUTCOMES CONTROLLER VIEW & GRACEFUL PAUSE/RESUME
// -------------------------------------------------------------
function renderOutcomesView(container) {
    const overrideVal = liveData.overrides ? liveData.overrides[selectedMode] : null;
    const exposure = (liveData.liveExposures && liveData.liveExposures[selectedMode]) || {};
    const modeConfig = (liveData.config && liveData.config.modes && liveData.config.modes[selectedMode]) || { enabled: true, paused: false, pausePending: false };

    let statusBadgeText = 'ACTIVE (Running)';
    let statusBadgeColor = 'var(--accent-green)';
    let statusBadgeBg = 'rgba(16,185,129,0.15)';

    if (modeConfig.paused) {
        statusBadgeText = 'PAUSED (Draws Stopped)';
        statusBadgeColor = 'var(--accent-red)';
        statusBadgeBg = 'rgba(239,68,68,0.2)';
    } else if (modeConfig.pausePending || exposure.pausePending) {
        statusBadgeText = 'PAUSE PENDING (Will pause after round finishes)';
        statusBadgeColor = 'var(--primary)';
        statusBadgeBg = 'rgba(245,158,11,0.2)';
    }

    container.innerHTML = `
        <div class="admin-card">
            <div class="card-header">
                <div>
                    <div class="card-title">🎯 Smarty91 ${selectedMode} — Round & Outcome Controller</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                        Round: <b style="color: #fff;">#${exposure.periodId || '...'}</b> | 
                        Time: <b style="color: ${exposure.isLocked ? 'var(--accent-red)' : 'var(--accent-green)'};">${exposure.remainingSeconds || 0}s ${exposure.isLocked ? '(LOCKED)' : ''}</b>
                    </div>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; background: ${overrideVal !== null && overrideVal !== undefined ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}; color: ${overrideVal !== null && overrideVal !== undefined ? 'var(--primary)' : 'var(--accent-green)'};">
                        ${overrideVal !== null && overrideVal !== undefined ? `FORCED OUTCOME (${overrideVal})` : 'AUTO RNG'}
                    </span>
                </div>
            </div>

            <!-- Mode Pause & Resume Controls -->
            <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; margin-bottom: 14px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-size: 12px; font-weight: 700; color: #fff;">Game State:</div>
                    <div style="font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 12px; background: ${statusBadgeBg}; color: ${statusBadgeColor};">
                        ${statusBadgeText}
                    </div>
                </div>

                <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
                    <b>Graceful Pause:</b> Allows current active bets and round countdown to complete and settle, then automatically pauses the next round.
                </p>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    ${modeConfig.paused || modeConfig.pausePending ? `
                        <button id="btn-resume-mode" class="btn-secondary" style="background: var(--accent-green); color: #000; font-weight: 800;">
                            ▶ Resume Live Mode
                        </button>
                    ` : `
                        <button id="btn-pause-after-round" class="btn-secondary" style="background: #d97706; color: #fff; font-weight: 700;">
                            ⏸ Pause After Current Round
                        </button>
                    `}
                    <button id="btn-pause-immediate" class="btn-secondary" style="background: ${modeConfig.paused ? '#1e293b' : 'rgba(239,68,68,0.25)'}; color: ${modeConfig.paused ? 'var(--text-muted)' : 'var(--accent-red)'};">
                        ⏹ ${modeConfig.paused ? 'Already Paused' : 'Pause Immediately'}
                    </button>
                </div>
            </div>

            <!-- Outcome Selection Matrix -->
            <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
                Tap any number below to <b>FORCE the next winning number</b> for Smarty91 ${selectedMode}:
            </p>

            <div class="number-matrix">
                ${[0,1,2,3,4,5,6,7,8,9].map(num => {
                    const prop = NUMBER_PROPERTIES[num];
                    const isSel = overrideVal === num;
                    return `
                        <button class="num-btn ${isSel ? 'selected' : ''}" data-num="${num}" data-color="${prop.color}">
                            ${num}
                        </button>
                    `;
                }).join('')}
            </div>

            <div style="display: flex; gap: 8px; margin-top: 14px;">
                <button id="btn-reset-auto" class="btn-secondary" style="flex: 1;">
                    🔄 Reset to Auto RNG
                </button>
                <button id="btn-pick-random" class="btn-secondary" style="flex: 1; background: var(--accent-blue);">
                    🎲 Random Pick
                </button>
            </div>
        </div>
    `;

    // Event Bindings
    container.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const num = Number(btn.dataset.num);
            try {
                await adminService.setNextOutcome(selectedMode, num);
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message);
            }
        });
    });

    const resetBtn = container.querySelector('#btn-reset-auto');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            try {
                await adminService.setNextOutcome(selectedMode, null);
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message);
            }
        });
    }

    const randomBtn = container.querySelector('#btn-pick-random');
    if (randomBtn) {
        randomBtn.addEventListener('click', async () => {
            const randomNum = Math.floor(Math.random() * 10);
            try {
                await adminService.setNextOutcome(selectedMode, randomNum);
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message);
            }
        });
    }

    const pauseGracefulBtn = container.querySelector('#btn-pause-after-round');
    if (pauseGracefulBtn) {
        pauseGracefulBtn.addEventListener('click', async () => {
            try {
                await adminService.setModePauseState(selectedMode, 'PAUSE_AFTER_ROUND');
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message);
            }
        });
    }

    const resumeBtn = container.querySelector('#btn-resume-mode');
    if (resumeBtn) {
        resumeBtn.addEventListener('click', async () => {
            try {
                await adminService.setModePauseState(selectedMode, 'RESUME');
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message);
            }
        });
    }

    const pauseImmediateBtn = container.querySelector('#btn-pause-immediate');
    if (pauseImmediateBtn) {
        pauseImmediateBtn.addEventListener('click', async () => {
            try {
                await adminService.setModePauseState(selectedMode, 'PAUSE_IMMEDIATE');
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message);
            }
        });
    }
}

// -------------------------------------------------------------
// 2. WINNING CHANCES & ODDS PROBABILITY CONTROLLER
// -------------------------------------------------------------
function renderChancesView(container) {
    const prob = (liveData.config && liveData.config.probabilities) || {
        enabled: true,
        sizes: { big: 1.0, small: 1.0 },
        colors: { green: 1.0, red: 1.0, violet: 1.0 },
        numbers: { 0: 10, 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 10, 8: 10, 9: 10 }
    };

    const bigW = Number(prob.sizes?.big || 1.0);
    const smallW = Number(prob.sizes?.small || 1.0);
    const bigPercent = Math.round((bigW / (bigW + smallW || 1)) * 100);
    const smallPercent = 100 - bigPercent;

    container.innerHTML = `
        <div class="admin-card">
            <div class="card-header">
                <div>
                    <div class="card-title">🎲 Winning Chances & Dynamic Odds Engine</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                        Configure winning probabilities for Big/Small, Colors, and Numbers
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 11px; color: var(--text-muted);">Weighted RNG:</span>
                    <input type="checkbox" id="prob-toggle-enabled" ${prob.enabled ? 'checked' : ''} style="transform: scale(1.3); accent-color: var(--primary); cursor: pointer;" />
                </div>
            </div>

            <!-- Quick Presets -->
            <div style="margin-bottom: 14px;">
                <div class="form-label" style="text-transform: uppercase;">⚡ Quick Probability Presets</div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;">
                    <button class="btn-secondary preset-btn" data-preset="EQUAL" style="font-size: 11px; padding: 8px;">
                        ⚖️ Equal 50/50 Chance
                    </button>
                    <button class="btn-secondary preset-btn" data-preset="HIGH_BIG" style="font-size: 11px; padding: 8px; background: rgba(245,158,11,0.2); color: var(--primary);">
                        📈 Favor Big (75% Big)
                    </button>
                    <button class="btn-secondary preset-btn" data-preset="HIGH_SMALL" style="font-size: 11px; padding: 8px; background: rgba(14,165,233,0.2); color: var(--accent-blue);">
                        📉 Favor Small (75% Small)
                    </button>
                    <button class="btn-secondary preset-btn" data-preset="HIGH_VIOLET" style="font-size: 11px; padding: 8px; background: rgba(139,92,246,0.2); color: var(--accent-violet);">
                        💜 Favor Violet (0 & 5)
                    </button>
                </div>
            </div>

            <!-- Big vs Small Probability Weights -->
            <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; margin-bottom: 14px;">
                <div class="form-label" style="text-transform: uppercase; margin-bottom: 8px;">
                    Big vs Small Winning Probability Ratio
                </div>

                <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 800; margin-bottom: 6px;">
                    <span style="color: var(--accent-blue);">Small (0-4): ${smallPercent}% (Weight: <span id="val-small-w">${smallW}</span>)</span>
                    <span style="color: var(--primary);">Big (5-9): ${bigPercent}% (Weight: <span id="val-big-w">${bigW}</span>)</span>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div>
                        <label class="form-label">Small Weight (0-4)</label>
                        <input type="range" id="slider-small-w" min="0.1" max="10.0" step="0.1" value="${smallW}" style="width: 100%; accent-color: var(--accent-blue);" />
                    </div>
                    <div>
                        <label class="form-label">Big Weight (5-9)</label>
                        <input type="range" id="slider-big-w" min="0.1" max="10.0" step="0.1" value="${bigW}" style="width: 100%; accent-color: var(--primary);" />
                    </div>
                </div>
            </div>

            <!-- Color Probability Weights -->
            <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; margin-bottom: 14px;">
                <div class="form-label" style="text-transform: uppercase; margin-bottom: 8px;">
                    Color Winning Multiplier Multipliers
                </div>

                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                    <div>
                        <label class="form-label" style="color: var(--accent-green);">Green Weight</label>
                        <input type="number" id="prob-color-green" class="form-input" value="${prob.colors?.green || 1.0}" step="0.1" min="0.1" />
                    </div>
                    <div>
                        <label class="form-label" style="color: var(--accent-violet);">Violet Weight</label>
                        <input type="number" id="prob-color-violet" class="form-input" value="${prob.colors?.violet || 1.0}" step="0.1" min="0.1" />
                    </div>
                    <div>
                        <label class="form-label" style="color: var(--accent-red);">Red Weight</label>
                        <input type="number" id="prob-color-red" class="form-input" value="${prob.colors?.red || 1.0}" step="0.1" min="0.1" />
                    </div>
                </div>
            </div>

            <!-- Individual Number Weights (0-9) -->
            <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; margin-bottom: 16px;">
                <div class="form-label" style="text-transform: uppercase; margin-bottom: 8px;">
                    Individual Number Probability Weights (0 - 9)
                </div>

                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;">
                    ${[0,1,2,3,4,5,6,7,8,9].map(num => `
                        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px; text-align: center;">
                            <div style="font-weight: 800; font-size: 12px; color: var(--primary);">#${num}</div>
                            <input type="number" class="num-prob-input form-input" data-num="${num}" value="${prob.numbers?.[num] !== undefined ? prob.numbers[num] : 10}" min="0" max="100" style="padding: 4px; text-align: center; font-size: 12px; margin-top: 4px;" />
                        </div>
                    `).join('')}
                </div>
            </div>

            <button id="btn-save-probabilities" class="btn-primary">
                💾 SAVE & APPLY PROBABILITY CHANCES
            </button>
        </div>
    `;

    // Sliders Real-time Visual Updates
    const smallSlider = container.querySelector('#slider-small-w');
    const bigSlider = container.querySelector('#slider-big-w');
    const valSmall = container.querySelector('#val-small-w');
    const valBig = container.querySelector('#val-big-w');

    smallSlider.addEventListener('input', () => {
        valSmall.textContent = smallSlider.value;
    });
    bigSlider.addEventListener('input', () => {
        valBig.textContent = bigSlider.value;
    });

    // Preset Clicks
    container.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = btn.dataset.preset;
            if (p === 'EQUAL') {
                smallSlider.value = '1.0';
                bigSlider.value = '1.0';
                container.querySelector('#prob-color-green').value = '1.0';
                container.querySelector('#prob-color-violet').value = '1.0';
                container.querySelector('#prob-color-red').value = '1.0';
                container.querySelectorAll('.num-prob-input').forEach(inp => inp.value = '10');
            } else if (p === 'HIGH_BIG') {
                smallSlider.value = '0.3';
                bigSlider.value = '2.5';
                container.querySelectorAll('.num-prob-input').forEach(inp => {
                    const n = Number(inp.dataset.num);
                    inp.value = n >= 5 ? '25' : '4';
                });
            } else if (p === 'HIGH_SMALL') {
                smallSlider.value = '2.5';
                bigSlider.value = '0.3';
                container.querySelectorAll('.num-prob-input').forEach(inp => {
                    const n = Number(inp.dataset.num);
                    inp.value = n <= 4 ? '25' : '4';
                });
            } else if (p === 'HIGH_VIOLET') {
                container.querySelector('#prob-color-violet').value = '3.5';
                container.querySelectorAll('.num-prob-input').forEach(inp => {
                    const n = Number(inp.dataset.num);
                    inp.value = (n === 0 || n === 5) ? '35' : '5';
                });
            }
            valSmall.textContent = smallSlider.value;
            valBig.textContent = bigSlider.value;
        });
    });

    // Save Probabilities
    container.querySelector('#btn-save-probabilities').addEventListener('click', async () => {
        const enabled = container.querySelector('#prob-toggle-enabled').checked;
        const small = Number(smallSlider.value);
        const big = Number(bigSlider.value);
        const green = Number(container.querySelector('#prob-color-green').value);
        const violet = Number(container.querySelector('#prob-color-violet').value);
        const red = Number(container.querySelector('#prob-color-red').value);

        const numbers = {};
        container.querySelectorAll('.num-prob-input').forEach(inp => {
            numbers[inp.dataset.num] = Number(inp.value);
        });

        try {
            const btn = container.querySelector('#btn-save-probabilities');
            btn.textContent = 'SAVING TO FIREBASE...';
            btn.disabled = true;

            await adminService.updateProbabilities({
                enabled,
                sizes: { big, small },
                colors: { green, violet, red },
                numbers
            });

            alert('Winning chances and odds weights updated successfully!');
            await fetchAndRefreshData();
        } catch (err) {
            alert(err.message || 'Failed to update winning chances');
        }
    });
}

// -------------------------------------------------------------
// 3. REALTIME DEPOSITS & WITHDRAWALS TRANSACTIONS MANAGEMENT
// -------------------------------------------------------------
function renderTransactionsView(container) {
    const txs = (liveData && liveData.recentTransactions) || [];
    const overview = liveData.overview || {};

    let filtered = [...txs];
    if (txFilterType !== 'ALL') {
        filtered = filtered.filter(t => t.type === txFilterType);
    }
    if (txFilterStatus !== 'ALL') {
        filtered = filtered.filter(t => t.status === txFilterStatus);
    }

    container.innerHTML = `
        <div class="admin-card">
            <div class="card-header">
                <div>
                    <div class="card-title">💰 Player Deposits & Withdrawals Live Dashboard</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                        Real-time pending requests review with 1-click Approval & Rejection
                    </div>
                </div>
            </div>

            <!-- Quick Summary Counters -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px;">
                <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); border-radius: 8px; padding: 10px;">
                    <div style="font-size: 10px; color: var(--accent-green); font-weight: 700; text-transform: uppercase;">Pending Deposits</div>
                    <div style="font-size: 16px; font-weight: 800; color: #fff;">
                        ${overview.pendingDepositsCount || 0} reqs (₹${(overview.pendingDepositsAmount || 0).toLocaleString('en-IN')})
                    </div>
                </div>
                <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 10px;">
                    <div style="font-size: 10px; color: var(--accent-red); font-weight: 700; text-transform: uppercase;">Pending Withdrawals</div>
                    <div style="font-size: 16px; font-weight: 800; color: #fff;">
                        ${overview.pendingWithdrawalsCount || 0} reqs (₹${(overview.pendingWithdrawalsAmount || 0).toLocaleString('en-IN')})
                    </div>
                </div>
            </div>

            <!-- Filter Controls -->
            <div style="display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap;">
                <select id="tx-filter-type" class="form-select" style="flex: 1; min-width: 130px;">
                    <option value="ALL" ${txFilterType === 'ALL' ? 'selected' : ''}>All Types</option>
                    <option value="DEPOSIT" ${txFilterType === 'DEPOSIT' ? 'selected' : ''}>📥 Deposits Only</option>
                    <option value="WITHDRAWAL" ${txFilterType === 'WITHDRAWAL' ? 'selected' : ''}>📤 Withdrawals Only</option>
                </select>
                <select id="tx-filter-status" class="form-select" style="flex: 1; min-width: 130px;">
                    <option value="ALL" ${txFilterStatus === 'ALL' ? 'selected' : ''}>All Status</option>
                    <option value="PENDING" ${txFilterStatus === 'PENDING' ? 'selected' : ''}>⏳ Pending Only</option>
                    <option value="APPROVED" ${txFilterStatus === 'APPROVED' ? 'selected' : ''}>✅ Approved</option>
                    <option value="REJECTED" ${txFilterStatus === 'REJECTED' ? 'selected' : ''}>❌ Rejected</option>
                </select>
            </div>

            <!-- Transactions List -->
            <div style="display: flex; flex-direction: column; gap: 10px;">
                ${filtered.length === 0 ? `
                    <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 12px; background: var(--bg-input); border-radius: 8px;">
                        No deposit or withdrawal requests found.
                    </div>
                ` : filtered.map(tx => {
                    const isPending = tx.status === 'PENDING';
                    const isDeposit = tx.type === 'DEPOSIT';
                    const statusColor = tx.status === 'APPROVED' ? 'var(--accent-green)' : (tx.status === 'REJECTED' ? 'var(--accent-red)' : 'var(--primary)');

                    return `
                        <div style="background: var(--bg-input); border-left: 4px solid ${isDeposit ? 'var(--accent-green)' : 'var(--accent-violet)'}; border-radius: 8px; padding: 12px; border-top: 1px solid var(--border-color); border-right: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color);">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                                <div>
                                    <span style="font-weight: 800; font-size: 13px; color: #fff;">${isDeposit ? '📥 DEPOSIT' : '📤 WITHDRAWAL'}</span>
                                    <span style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">#${tx.id}</span>
                                </div>
                                <span style="font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: ${statusColor}22; color: ${statusColor};">
                                    ${tx.status}
                                </span>
                            </div>

                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <div>
                                    <div style="font-size: 11px; color: var(--text-muted);">Player ID: <b style="color: #fff;">${tx.userId}</b></div>
                                    <div style="font-size: 10px; color: var(--text-muted);">${new Date(tx.createdAt).toLocaleString()}</div>
                                </div>
                                <div style="font-size: 18px; font-weight: 900; color: ${isDeposit ? 'var(--accent-green)' : 'var(--primary)'};">
                                    ₹${tx.amount.toLocaleString('en-IN')}
                                </div>
                            </div>

                            <!-- Payment Details -->
                            <div style="background: var(--bg-card); padding: 8px; border-radius: 6px; font-size: 11px; margin-bottom: 8px;">
                                ${isDeposit ? `
                                    <div>UTR / Ref No: <b style="color: var(--accent-blue);">${tx.utrNumber || 'N/A'}</b></div>
                                    <div>UPI ID / Gateway: <span style="color: var(--text-muted);">${tx.upiId || 'VIP Gateway'}</span></div>
                                ` : `
                                    <div>Bank: <b style="color: #fff;">${tx.bankName || 'Bank Payout'}</b> | Acc: <b style="color: var(--accent-blue);">${tx.accountNumber || tx.upiId}</b></div>
                                    <div>IFSC: <span style="color: var(--text-muted);">${tx.ifsc || 'N/A'}</span></div>
                                `}
                                ${tx.adminRemarks ? `<div style="margin-top: 4px; color: var(--primary);">Remarks: ${tx.adminRemarks}</div>` : ''}
                            </div>

                            <!-- Action Buttons for Pending -->
                            ${isPending ? `
                                <div style="display: flex; gap: 8px;">
                                    <button class="btn-approve-tx btn-secondary" data-id="${tx.id}" style="flex: 1; background: var(--accent-green); color: #000; font-weight: 800; padding: 8px;">
                                        ✅ Approve ${isDeposit ? '& Credit' : '& Mark Paid'}
                                    </button>
                                    <button class="btn-reject-tx btn-secondary" data-id="${tx.id}" style="flex: 1; background: rgba(239,68,68,0.25); color: var(--accent-red); font-weight: 700; padding: 8px;">
                                        ❌ Reject
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    // Filter Change Listeners
    container.querySelector('#tx-filter-type').addEventListener('change', (e) => {
        txFilterType = e.target.value;
        renderActiveTab();
    });

    container.querySelector('#tx-filter-status').addEventListener('change', (e) => {
        txFilterStatus = e.target.value;
        renderActiveTab();
    });

    // Approve & Reject Handlers
    container.querySelectorAll('.btn-approve-tx').forEach(btn => {
        btn.addEventListener('click', async () => {
            const txId = btn.dataset.id;
            try {
                btn.textContent = 'Approving...';
                btn.disabled = true;
                await adminService.processTransaction(txId, 'APPROVE', 'Approved by Admin');
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message || 'Approval failed');
            }
        });
    });

    container.querySelectorAll('.btn-reject-tx').forEach(btn => {
        btn.addEventListener('click', async () => {
            const txId = btn.dataset.id;
            const remarks = prompt('Enter rejection reason / remarks:', 'Payment verification failed');
            if (remarks === null) return;

            try {
                btn.textContent = 'Rejecting...';
                btn.disabled = true;
                await adminService.processTransaction(txId, 'REJECT', remarks);
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message || 'Rejection failed');
            }
        });
    });
}

// -------------------------------------------------------------
// 4. LIVE BETS & RISK EXPOSURE HEATMAP
// -------------------------------------------------------------
function renderExposureView(container) {
    const exposure = (liveData.liveExposures && liveData.liveExposures[selectedMode]) || {
        numbers: {}, colors: {}, sizes: {}, totalBetVolume: 0, totalBetsCount: 0
    };

    container.innerHTML = `
        <div class="admin-card">
            <div class="card-header">
                <div class="card-title">🔥 Live Risk Exposure — Smarty91 ${selectedMode}</div>
                <div style="font-weight: 800; color: var(--accent-blue); font-size: 14px;">
                    Total: ₹${(exposure.totalBetVolume || 0).toLocaleString('en-IN')} (${exposure.totalBetsCount || 0} bets)
                </div>
            </div>

            <!-- Color Exposure -->
            <div style="margin-bottom: 14px;">
                <div class="form-label" style="text-transform: uppercase;">Color Bets Volume</div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                    <div style="background: var(--bg-input); border-left: 4px solid var(--accent-green); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 10px; color: var(--text-muted);">GREEN</div>
                        <div style="font-size: 15px; font-weight: 800; color: #fff;">₹${(exposure.colors?.green || 0).toLocaleString('en-IN')}</div>
                    </div>
                    <div style="background: var(--bg-input); border-left: 4px solid var(--accent-violet); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 10px; color: var(--text-muted);">VIOLET</div>
                        <div style="font-size: 15px; font-weight: 800; color: #fff;">₹${(exposure.colors?.violet || 0).toLocaleString('en-IN')}</div>
                    </div>
                    <div style="background: var(--bg-input); border-left: 4px solid var(--accent-red); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 10px; color: var(--text-muted);">RED</div>
                        <div style="font-size: 15px; font-weight: 800; color: #fff;">₹${(exposure.colors?.red || 0).toLocaleString('en-IN')}</div>
                    </div>
                </div>
            </div>

            <!-- Size Exposure -->
            <div style="margin-bottom: 14px;">
                <div class="form-label" style="text-transform: uppercase;">Size Bets Volume</div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                    <div style="background: var(--bg-input); border-left: 4px solid var(--primary); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 10px; color: var(--text-muted);">BIG (5-9)</div>
                        <div style="font-size: 15px; font-weight: 800; color: #fff;">₹${(exposure.sizes?.big || 0).toLocaleString('en-IN')}</div>
                    </div>
                    <div style="background: var(--bg-input); border-left: 4px solid var(--accent-blue); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 10px; color: var(--text-muted);">SMALL (0-4)</div>
                        <div style="font-size: 15px; font-weight: 800; color: #fff;">₹${(exposure.sizes?.small || 0).toLocaleString('en-IN')}</div>
                    </div>
                </div>
            </div>

            <!-- Number Distribution Grid -->
            <div>
                <div class="form-label" style="text-transform: uppercase;">Individual Number Exposure (0 - 9)</div>
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;">
                    ${[0,1,2,3,4,5,6,7,8,9].map(num => `
                        <div style="background: var(--bg-input); padding: 8px 4px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color);">
                            <div style="font-weight: 800; font-size: 12px; color: var(--primary);">#${num}</div>
                            <div style="font-size: 11px; font-weight: 700; color: #fff; margin-top: 2px;">
                                ₹${(exposure.numbers && exposure.numbers[num]) || 0}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

// -------------------------------------------------------------
// 5. USERS & DIRECT WALLET CONTROLLER
// -------------------------------------------------------------
function renderUsersView(container, force = false) {
    const isMounted = container.querySelector('#users-admin-view');
    if (!isMounted || force) {
        container.innerHTML = `
            <div id="users-admin-view">
                <div class="admin-card">
                    <div class="card-title" style="margin-bottom: 12px;">👤 Player Direct Wallet Controller (Credit / Debit)</div>
                    
                    <div class="form-group">
                        <label class="form-label">Player Account ID / Mobile Number</label>
                        <input type="text" id="user-adj-id" class="form-input" placeholder="e.g. USR_9876543210 (or click '⚡ Select' from list below)" />
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                        <div>
                            <label class="form-label">Amount (₹)</label>
                            <input type="number" id="user-adj-amount" class="form-input" placeholder="e.g. 500" min="1" />
                        </div>
                        <div>
                            <label class="form-label">Action Type</label>
                            <select id="user-adj-action" class="form-select">
                                <option value="ADD">➕ Add Balance (Credit / Deposit)</option>
                                <option value="DEDUCT">➖ Deduct Balance (Debit / Penalty)</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Reason / Remarks (Recorded in Audit Ledger)</label>
                        <input type="text" id="user-adj-remarks" class="form-input" placeholder="e.g. Admin direct topup / Welcome gift" />
                    </div>

                    <button id="btn-submit-wallet-adj" class="btn-primary" style="height: 40px; font-weight: 800;">APPLY WALLET UPDATE</button>
                </div>

                <div class="admin-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <div class="card-title">📑 Registered Player Accounts</div>
                            <div style="font-size: 11px; color: var(--text-muted);">Real-time database of all user wallets, referrals & deposits</div>
                        </div>
                        <div style="width: 240px; max-width: 100%;">
                            <input type="text" id="users-search-input" class="form-input" placeholder="🔍 Search mobile, ID, invite..." style="padding: 6px 10px; font-size: 12px;" />
                        </div>
                    </div>
                    <div id="users-list-table-wrap">
                        <div id="users-list-table" style="overflow-x: auto;">Loading player accounts...</div>
                    </div>
                </div>
            </div>
        `;

        // Search filter input listener (does not wipe keyboard state)
        const searchInput = container.querySelector('#users-search-input');
        if (searchInput) {
            searchInput.value = userSearchQuery;
            searchInput.addEventListener('input', (e) => {
                userSearchQuery = e.target.value.toLowerCase().trim();
                renderUsersTableContent(container);
            });
        }

        // Wallet Adjustment Submit Listener
        const btn = container.querySelector('#btn-submit-wallet-adj');
        if (btn) {
            btn.addEventListener('click', async () => {
                const userId = container.querySelector('#user-adj-id').value.trim();
                const amount = Number(container.querySelector('#user-adj-amount').value);
                const action = container.querySelector('#user-adj-action').value;
                const remarks = container.querySelector('#user-adj-remarks').value.trim() || 'Admin manual balance adjustment';

                if (!userId) {
                    alert('Please enter or select a Player Account ID');
                    return;
                }
                if (!amount || amount <= 0) {
                    alert('Please enter a valid amount');
                    return;
                }

                try {
                    btn.textContent = 'Processing...';
                    btn.disabled = true;
                    await adminService.adjustUserBalance(userId, amount, action, remarks);
                    alert(`Balance updated successfully for ${userId}`);
                    container.querySelector('#user-adj-amount').value = '';
                    await refreshUsersData(container);
                } catch (err) {
                    alert(err.message || 'Action failed');
                } finally {
                    btn.textContent = 'APPLY WALLET UPDATE';
                    btn.disabled = false;
                }
            });
        }
    }

    // Refresh users table in background without touching inputs or focus
    refreshUsersData(container);
}

async function refreshUsersData(container) {
    try {
        const res = await adminService.getUsers();
        if (res && res.users) {
            cachedAdminUsers = res.users;
            renderUsersTableContent(container);
        }
    } catch (e) {
        console.error('Failed to load users:', e);
    }
}

function renderUsersTableContent(container) {
    const tableEl = container.querySelector('#users-list-table');
    if (!tableEl) return;

    let filtered = cachedAdminUsers;
    if (userSearchQuery) {
        filtered = cachedAdminUsers.filter(u => 
            (u.id && u.id.toLowerCase().includes(userSearchQuery)) ||
            (u.phone && u.phone.includes(userSearchQuery)) ||
            (u.inviteCode && u.inviteCode.toLowerCase().includes(userSearchQuery)) ||
            (u.username && u.username.toLowerCase().includes(userSearchQuery))
        );
    }

    if (filtered.length === 0) {
        tableEl.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); padding: 16px; text-align: center;">No player accounts found matching "${userSearchQuery}"</div>`;
        return;
    }

    tableEl.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Mobile / User ID</th>
                    <th>Referral Code</th>
                    <th>Invited By</th>
                    <th>Real Balance</th>
                    <th>1st Deposit</th>
                    <th>Status</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(u => `
                    <tr>
                        <td>
                            <div style="font-weight: 700; color: #fff;">${u.phone ? `📱 +91 ${u.phone}` : u.username}</div>
                            <div style="font-size: 10px; color: var(--text-muted);">${u.id}</div>
                        </td>
                        <td>
                            <span style="font-family: monospace; color: #f59e0b; font-weight: 700;">${u.inviteCode || '—'}</span>
                        </td>
                        <td>
                            <span style="font-size: 11px; color: var(--text-muted);">${u.referredBy || 'Direct'}</span>
                        </td>
                        <td style="color: var(--accent-green); font-weight: 800; font-size: 13px;">
                            ₹${(u.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td>
                            <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; ${u.hasDeposited ? 'background: rgba(16,185,129,0.2); color: var(--accent-green);' : 'background: rgba(255,255,255,0.06); color: var(--text-muted);'}">
                                ${u.hasDeposited ? '✅ DEPOSITED' : '⏳ NO DEPOSIT'}
                            </span>
                        </td>
                        <td>
                            <span style="font-size: 10px; font-weight: 700; color: ${u.isBlocked ? 'var(--accent-red)' : 'var(--accent-green)'};">
                                ${u.isBlocked ? 'SUSPENDED' : 'ACTIVE'}
                            </span>
                        </td>
                        <td>
                            <button class="btn-select-user" data-uid="${u.id}" style="background: rgba(245,158,11,0.2); border: 1px solid #f59e0b; color: #f59e0b; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                ⚡ Select
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Bind Quick Select buttons
    tableEl.querySelectorAll('.btn-select-user').forEach(b => {
        b.addEventListener('click', () => {
            const uid = b.dataset.uid;
            const idInput = container.querySelector('#user-adj-id');
            const amtInput = container.querySelector('#user-adj-amount');
            if (idInput) {
                idInput.value = uid;
                idInput.style.borderColor = '#f59e0b';
                setTimeout(() => { idInput.style.borderColor = ''; }, 1200);
            }
            if (amtInput) amtInput.focus();
        });
    });
}

// -------------------------------------------------------------
// 6. PAYOUT RULES & MULTIPLIERS
// -------------------------------------------------------------
function renderRulesView(container, force = false) {
    const isMounted = container.querySelector('#rules-admin-view');
    if (isMounted && !force) return;

    const { multipliers, serviceFeePercent, minBetAmount, maxBetAmount } = liveData.config;

    container.innerHTML = `
        <div id="rules-admin-view" class="admin-card">
            <div class="card-title" style="margin-bottom: 12px;">⚙️ Payout Multipliers & Margins</div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
                <div>
                    <label class="form-label">Single Number Match (x)</label>
                    <input type="number" id="rule-mult-number" class="form-input" value="${multipliers.number}" step="0.1" />
                </div>
                <div>
                    <label class="form-label">Pure Color Match (x)</label>
                    <input type="number" id="rule-mult-color" class="form-input" value="${multipliers.pureColor}" step="0.1" />
                </div>
                <div>
                    <label class="form-label">Violet Match (x)</label>
                    <input type="number" id="rule-mult-violet" class="form-input" value="${multipliers.violet}" step="0.1" />
                </div>
                <div>
                    <label class="form-label">Big / Small Match (x)</label>
                    <input type="number" id="rule-mult-bigsmall" class="form-input" value="${multipliers.bigSmall}" step="0.1" />
                </div>
            </div>

            <div class="card-title" style="margin-bottom: 12px;">🛡️ Risk Exposure Limits</div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">
                <div>
                    <label class="form-label">Fee (%)</label>
                    <input type="number" id="rule-fee-percent" class="form-input" value="${serviceFeePercent}" />
                </div>
                <div>
                    <label class="form-label">Min Bet (₹)</label>
                    <input type="number" id="rule-min-bet" class="form-input" value="${minBetAmount}" />
                </div>
                <div>
                    <label class="form-label">Max Bet (₹)</label>
                    <input type="number" id="rule-max-bet" class="form-input" value="${maxBetAmount}" />
                </div>
            </div>

            <button id="btn-save-rules" class="btn-primary">SAVE SYSTEM CONFIGURATION</button>
        </div>
    `;

    container.querySelector('#btn-save-rules').addEventListener('click', async () => {
        const multNumber = Number(container.querySelector('#rule-mult-number').value);
        const multColor = Number(container.querySelector('#rule-mult-color').value);
        const multViolet = Number(container.querySelector('#rule-mult-violet').value);
        const multBigSmall = Number(container.querySelector('#rule-mult-bigsmall').value);
        const serviceFeePercent = Number(container.querySelector('#rule-fee-percent').value);
        const minBetAmount = Number(container.querySelector('#rule-min-bet').value);
        const maxBetAmount = Number(container.querySelector('#rule-max-bet').value);

        try {
            await adminService.updatePayoutRules({
                multipliers: {
                    number: multNumber,
                    pureColor: multColor,
                    violet: multViolet,
                    bigSmall: multBigSmall
                },
                serviceFeePercent,
                minBetAmount,
                maxBetAmount
            });
            alert('Payout rules and limits saved successfully!');
            await fetchAndRefreshData();
        } catch (err) {
            alert(err.message);
        }
    });
}

// -------------------------------------------------------------
// 7. AUDIT LOGS VIEW
// -------------------------------------------------------------
function renderLogsView(container) {
    const logs = liveData.recentAuditLogs || [];

    container.innerHTML = `
        <div class="admin-card">
            <div class="card-title" style="margin-bottom: 12px;">📜 System & Admin Audit Logs</div>
            ${logs.length === 0 ? '<div style="font-size:12px; color:var(--text-muted);">No logs recorded yet</div>' : ''}
            <div style="display: flex; flex-direction: column; gap: 8px;">
                ${logs.map(log => `
                    <div style="background: var(--bg-input); border-left: 3px solid var(--primary); padding: 10px; border-radius: 6px; font-size: 11px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <span style="font-weight: 700; color: #fff;">${log.action}</span>
                            <span style="color: var(--text-muted); font-size: 10px;">${new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div style="color: var(--text-muted);">${log.details}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}
