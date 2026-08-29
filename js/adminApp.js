// js/adminApp.js - Dedicated Master Admin Dashboard Engine
import { adminService } from './services/adminService.js';

let activeTab = 'outcomes'; // 'outcomes' | 'exposure' | 'users' | 'rules' | 'logs'
let selectedMode = '30s';   // '30s' | '1m' | '3m' | '5m'
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
            renderActiveTab();
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
            renderActiveTab();
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
        renderActiveTab();
    } catch (e) {
        console.error('Admin sync error:', e);
    }
}

function updateTopKpis(overview) {
    if (!overview) return;
    document.getElementById('kpi-users').textContent = overview.activeUsersCount || 1;
    document.getElementById('kpi-volume').textContent = `₹${(overview.totalBetVolume || 0).toLocaleString('en-IN')}`;
    document.getElementById('kpi-payout').textContent = `₹${(overview.totalPayoutVolume || 0).toLocaleString('en-IN')}`;
    const profitEl = document.getElementById('kpi-profit');
    const profit = overview.grossHouseProfit || 0;
    profitEl.textContent = `₹${profit.toLocaleString('en-IN')}`;
    profitEl.style.color = profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
}

function renderActiveTab() {
    if (!liveData) return;
    const container = document.getElementById('tab-view-container');

    switch (activeTab) {
        case 'outcomes':
            renderOutcomesView(container);
            break;
        case 'exposure':
            renderExposureView(container);
            break;
        case 'users':
            renderUsersView(container);
            break;
        case 'rules':
            renderRulesView(container);
            break;
        case 'logs':
            renderLogsView(container);
            break;
    }
}

// 1. OUTCOMES CONTROLLER VIEW
function renderOutcomesView(container) {
    const overrideVal = liveData.overrides ? liveData.overrides[selectedMode] : null;
    const exposure = (liveData.liveExposures && liveData.liveExposures[selectedMode]) || {};
    const modeConfig = liveData.config.modes[selectedMode] || { enabled: true, paused: false };

    container.innerHTML = `
        <div class="admin-card">
            <div class="card-header">
                <div>
                    <div class="card-title">🎯 Smarty91 ${selectedMode} — Outcome Controller</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                        Current Period: <b style="color: #fff;">#${exposure.periodId || '...'}</b> | 
                        Time Left: <b style="color: ${exposure.isLocked ? 'var(--accent-red)' : 'var(--accent-green)'};">${exposure.remainingSeconds || 0}s ${exposure.isLocked ? '(LOCKED)' : ''}</b>
                    </div>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; background: ${overrideVal !== null && overrideVal !== undefined ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}; color: ${overrideVal !== null && overrideVal !== undefined ? 'var(--primary)' : 'var(--accent-green)'};">
                        ${overrideVal !== null && overrideVal !== undefined ? `FORCED OUTCOME (${overrideVal})` : 'AUTO (CSPRNG FAIR)'}
                    </span>
                </div>
            </div>

            <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
                Tap any number below to FORCE the winning result for the upcoming round. Or keep AUTO to use server randomness:
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
                    🔄 Reset to Auto CSPRNG
                </button>
                <button id="btn-pick-random" class="btn-secondary" style="flex: 1; background: var(--accent-blue);">
                    🎲 Random Pick
                </button>
            </div>
        </div>

        <div class="admin-card">
            <div class="card-title" style="margin-bottom: 8px;">⚡ Mode Status Controls</div>
            <div style="display: flex; gap: 8px;">
                <button id="btn-toggle-pause" class="btn-secondary" style="flex: 1; background: ${modeConfig.paused ? 'var(--accent-green)' : '#334155'};">
                    ${modeConfig.paused ? '▶ Resume Mode' : '⏸ Pause Mode'}
                </button>
            </div>
        </div>
    `;

    // Bind Number Matrix Clicks
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

    const pauseBtn = container.querySelector('#btn-toggle-pause');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', async () => {
            try {
                await adminService.updateModeConfig(selectedMode, { paused: !modeConfig.paused });
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message);
            }
        });
    }
}

// 2. LIVE BETS & EXPOSURE HEATMAP
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

// 3. USERS & DIRECT WALLET CONTROLLER
function renderUsersView(container) {
    container.innerHTML = `
        <div class="admin-card">
            <div class="card-title" style="margin-bottom: 12px;">👤 Player Wallet Credit / Debit</div>
            
            <div class="form-group">
                <label class="form-label">Player Account ID / Username</label>
                <input type="text" id="user-adj-id" class="form-input" value="default_user" />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                <div>
                    <label class="form-label">Amount (₹)</label>
                    <input type="number" id="user-adj-amount" class="form-input" placeholder="e.g. 5000" />
                </div>
                <div>
                    <label class="form-label">Action Type</label>
                    <select id="user-adj-action" class="form-select">
                        <option value="ADD">➕ Add Balance (Credit)</option>
                        <option value="DEDUCT">➖ Deduct Balance (Debit)</option>
                    </select>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Reason / Remarks (Recorded in Audit Ledger)</label>
                <input type="text" id="user-adj-remarks" class="form-input" placeholder="e.g. Special VIP Deposit Bonus" />
            </div>

            <button id="btn-submit-wallet-adj" class="btn-primary">APPLY BALANCE UPDATE</button>
        </div>

        <div class="admin-card">
            <div class="card-title" style="margin-bottom: 8px;">📑 User Accounts List</div>
            <div id="users-list-table">Loading users...</div>
        </div>
    `;

    // Load users
    adminService.getUsers().then(res => {
        const tableEl = container.querySelector('#users-list-table');
        if (res && res.users) {
            tableEl.innerHTML = `
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>User ID</th>
                            <th>Name</th>
                            <th>Balance</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${res.users.map(u => `
                            <tr>
                                <td><b>${u.id}</b></td>
                                <td>${u.username}</td>
                                <td style="color: var(--accent-green); font-weight: bold;">₹${(u.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                <td><span style="color: var(--accent-green);">Active</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    }).catch(() => {});

    // Bind Wallet Adjustment
    const btn = container.querySelector('#btn-submit-wallet-adj');
    btn.addEventListener('click', async () => {
        const userId = container.querySelector('#user-adj-id').value.trim();
        const amount = Number(container.querySelector('#user-adj-amount').value);
        const action = container.querySelector('#user-adj-action').value;
        const remarks = container.querySelector('#user-adj-remarks').value.trim() || 'Admin manual balance adjustment';

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
            await fetchAndRefreshData();
        } catch (err) {
            alert(err.message || 'Action failed');
        } finally {
            btn.textContent = 'APPLY BALANCE UPDATE';
            btn.disabled = false;
        }
    });
}

// 4. PAYOUT RULES & MULTIPLIERS
function renderRulesView(container) {
    const { multipliers, serviceFeePercent, minBetAmount, maxBetAmount } = liveData.config;

    container.innerHTML = `
        <div class="admin-card">
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

// 5. AUDIT LOGS VIEW
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
