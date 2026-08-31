// js/adminApp.js - Dedicated Master Admin Dashboard Engine
import { adminService } from './services/adminService.js';

let activeTab = 'cashier'; // 'cashier' | 'outcomes' | 'chances' | 'exposure' | 'users' | 'rules' | 'logs'
let selectedMode = '30s';   // '30s' | '1m' | '3m' | '5m'
let txFilterType = 'ALL';   // 'ALL' | 'DEPOSIT' | 'WITHDRAWAL'
let txFilterStatus = 'ALL'; // 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'
let txSearchQuery = '';
let liveData = null;
let pollTimer = null;

// Realtime Sound Alarm System (Web Audio API - 5-6 Second Siren Beep)
let isAudioAlarmEnabled = localStorage.getItem('smarty91_admin_sound_enabled') !== 'false';
let audioCtx = null;
let isAlarmPlaying = false;
let knownPendingTxIds = new Set();
let isFirstSync = true;

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
    initDeveloperPortal();
    initSoundToggle();
});

function getAudioContext() {
    try {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } catch (e) {
        console.warn('AudioContext error:', e);
    }
    return audioCtx;
}

// 5.5-Second Loud High-Pitch Beep Alert
export function play5SecondAlarm() {
    if (!isAudioAlarmEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    if (isAlarmPlaying) return;
    isAlarmPlaying = true;

    try {
        const now = ctx.currentTime;
        const pulseInterval = 0.75;
        const pulseCount = 7; // 7 bursts x 0.75s = ~5.3 - 5.5 seconds total

        for (let i = 0; i < pulseCount; i++) {
            const startTime = now + (i * pulseInterval);

            // Primary High-Volume Tone
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(880, startTime);
            osc1.frequency.exponentialRampToValueAtTime(1450, startTime + 0.35);

            gain1.gain.setValueAtTime(0.001, startTime);
            gain1.gain.linearRampToValueAtTime(0.7, startTime + 0.05);
            gain1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

            osc1.connect(gain1);
            gain1.connect(ctx.destination);

            osc1.start(startTime);
            osc1.stop(startTime + 0.45);

            // Harmonic Dual-Tone Tone
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(1100, startTime + 0.08);
            osc2.frequency.exponentialRampToValueAtTime(1760, startTime + 0.35);

            gain2.gain.setValueAtTime(0.001, startTime + 0.08);
            gain2.gain.linearRampToValueAtTime(0.4, startTime + 0.12);
            gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

            osc2.connect(gain2);
            gain2.connect(ctx.destination);

            osc2.start(startTime + 0.08);
            osc2.stop(startTime + 0.45);
        }

        setTimeout(() => {
            isAlarmPlaying = false;
        }, 5500);
    } catch (e) {
        console.warn('Audio alarm playback error:', e);
        isAlarmPlaying = false;
    }
}

function initSoundToggle() {
    const soundBtn = document.getElementById('admin-sound-toggle-btn');
    const soundIcon = document.getElementById('sound-icon');
    const soundText = document.getElementById('sound-status-text');

    function updateSoundUI() {
        if (!soundBtn) return;
        if (isAudioAlarmEnabled) {
            soundBtn.style.background = 'rgba(16, 185, 129, 0.15)';
            soundBtn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            soundBtn.style.color = '#10b981';
            if (soundIcon) soundIcon.textContent = '🔔';
            if (soundText) soundText.textContent = 'Alarm ON';
        } else {
            soundBtn.style.background = 'rgba(239, 68, 68, 0.15)';
            soundBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            soundBtn.style.color = '#ef4444';
            if (soundIcon) soundIcon.textContent = '🔇';
            if (soundText) soundText.textContent = 'Muted';
        }
    }

    updateSoundUI();

    if (soundBtn) {
        soundBtn.addEventListener('click', () => {
            getAudioContext(); // Unlock audio context on user interaction
            isAudioAlarmEnabled = !isAudioAlarmEnabled;
            localStorage.setItem('smarty91_admin_sound_enabled', isAudioAlarmEnabled ? 'true' : 'false');
            updateSoundUI();

            if (isAudioAlarmEnabled) {
                // Play a brief 1-chirp sample
                play5SecondAlarm();
            }
        });
    }
}

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

        // Realtime Cashier Notification & Alarm Check
        const txs = (liveData && liveData.recentTransactions) || [];
        const pendingTxs = txs.filter(t => t.status === 'PENDING');
        const pendingCount = pendingTxs.length;

        const badgeEl = document.getElementById('cashier-badge');
        if (badgeEl) {
            if (pendingCount > 0) {
                badgeEl.textContent = pendingCount;
                badgeEl.style.display = 'inline-block';
                document.title = `🔔 (${pendingCount}) NEW CASHIER REQ - Smarty91 Admin`;
            } else {
                badgeEl.style.display = 'none';
                document.title = 'Smarty91 Master Admin Console';
            }
        }

        // Detect newly arrived pending requests
        let hasNewRequest = false;
        pendingTxs.forEach(t => {
            if (!knownPendingTxIds.has(t.id)) {
                knownPendingTxIds.add(t.id);
                if (!isFirstSync) {
                    hasNewRequest = true;
                }
            }
        });

        if (hasNewRequest) {
            play5SecondAlarm();
        }

        if (isFirstSync) {
            isFirstSync = false;
        }

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
        case 'cashier':
        case 'transactions':
            if (!isTyping || force) renderCashierView(container);
            break;
        case 'outcomes':
            if (!isTyping || force) renderOutcomesView(container);
            break;
        case 'chances':
            if (!isTyping || force) renderChancesView(container);
            break;
        case 'exposure':
            renderExposureView(container);
            break;
        case 'users':
            renderUsersView(container, force);
            break;
        case 'profitstars':
            renderProfitStarsView(container, force);
            break;
        case 'rules':
            renderRulesView(container, force);
            break;
        case 'logs':
            if (!isTyping || force) renderLogsView(container);
            break;
        default:
            if (!isTyping || force) renderCashierView(container);
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
// 3. REALTIME CASHIER & REQUESTS APPROVAL DASHBOARD (DEPOSITS & WITHDRAWALS)
// -------------------------------------------------------------
function renderCashierView(container) {
    const txs = (liveData && liveData.recentTransactions) || [];
    const overview = liveData.overview || {};

    let filtered = [...txs];
    if (txFilterType !== 'ALL') {
        filtered = filtered.filter(t => t.type === txFilterType);
    }
    if (txFilterStatus !== 'ALL') {
        filtered = filtered.filter(t => t.status === txFilterStatus);
    }
    if (txSearchQuery.trim()) {
        const q = txSearchQuery.trim().toLowerCase();
        filtered = filtered.filter(t => 
            (t.id && t.id.toLowerCase().includes(q)) ||
            (t.userId && t.userId.toLowerCase().includes(q)) ||
            (t.utrNumber && t.utrNumber.toLowerCase().includes(q)) ||
            (t.accountNumber && t.accountNumber.toLowerCase().includes(q)) ||
            (t.upiId && t.upiId.toLowerCase().includes(q)) ||
            (t.ifsc && t.ifsc.toLowerCase().includes(q)) ||
            (t.bankName && t.bankName.toLowerCase().includes(q))
        );
    }

    const pendingDepositsCount = overview.pendingDepositsCount || 0;
    const pendingWithdrawalsCount = overview.pendingWithdrawalsCount || 0;
    const totalPending = pendingDepositsCount + pendingWithdrawalsCount;

    container.innerHTML = `
        <div class="admin-card">
            <!-- Active Alarm Warning Banner -->
            ${totalPending > 0 ? `
                <div class="alarm-banner">
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 13px;">
                        <span>🚨</span>
                        <span>${totalPending} PENDING CASHIER REQUEST${totalPending > 1 ? 'S' : ''} REQUIRING APPROVAL!</span>
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button type="button" id="btn-banner-test-sound" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; cursor: pointer;">
                            🔊 Play Siren
                        </button>
                    </div>
                </div>
            ` : ''}

            <div class="card-header">
                <div>
                    <div class="card-title">💰 Master Cashier & Banking Dashboard</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                        Realtime Deposit & Withdrawal approvals, 5-6s Loud Siren Alarm & Instant Telegram alerts
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <button type="button" id="btn-cashier-test-alarm" class="btn-secondary" style="font-size: 11px; padding: 6px 10px; background: rgba(245, 158, 11, 0.2); color: var(--primary); font-weight: 800; border: 1px solid rgba(245, 158, 11, 0.4);" title="Play 5-6 second high volume alarm sound">
                        🔊 Test 6s Siren
                    </button>
                </div>
            </div>

            <!-- Quick Summary Counters -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
                <div style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.35); border-radius: 10px; padding: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-size: 11px; color: var(--accent-green); font-weight: 800; text-transform: uppercase;">📥 Pending Deposits</div>
                        <span style="font-size: 10px; font-weight: 800; background: rgba(16,185,129,0.25); color: #10b981; padding: 2px 6px; border-radius: 6px;">${pendingDepositsCount} REQS</span>
                    </div>
                    <div style="font-size: 20px; font-weight: 900; color: #fff; margin-top: 4px;">
                        ₹${(overview.pendingDepositsAmount || 0).toLocaleString('en-IN')}
                    </div>
                </div>
                <div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35); border-radius: 10px; padding: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-size: 11px; color: var(--accent-red); font-weight: 800; text-transform: uppercase;">📤 Pending Withdrawals</div>
                        <span style="font-size: 10px; font-weight: 800; background: rgba(239,68,68,0.25); color: #ef4444; padding: 2px 6px; border-radius: 6px;">${pendingWithdrawalsCount} REQS</span>
                    </div>
                    <div style="font-size: 20px; font-weight: 900; color: #fff; margin-top: 4px;">
                        ₹${(overview.pendingWithdrawalsAmount || 0).toLocaleString('en-IN')}
                    </div>
                </div>
            </div>

            <!-- Telegram Bot Status & Direct Test Controller -->
            <div style="background: #111a2e; border: 1px solid #1e2c4f; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 15px;">🤖</span>
                        <span style="font-weight: 800; font-size: 12px; color: #38bdf8;">TELEGRAM 24/7 INSTANT BOT ALERTS</span>
                    </div>
                    <span style="font-size: 10px; color: #10b981; font-weight: 800; background: rgba(16,185,129,0.15); padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(16,185,129,0.3);">
                        ● Active (Token Loaded)
                    </span>
                </div>
                <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4; margin-bottom: 10px;">
                    Bot: <strong style="color: #fff;">@smarty91_alert_bot</strong> | Chat ID: <strong style="color: #facc15;">8282793854</strong>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button type="button" id="btn-telegram-test" class="btn-primary" style="flex: 1; min-width: 160px; font-size: 11px; padding: 8px 12px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #fff; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <span>📲</span>
                        <span>SEND TELEGRAM TEST MSG</span>
                    </button>
                    <a href="https://t.me/smarty91_alert_bot" target="_blank" class="btn-secondary" style="font-size: 11px; padding: 8px 12px; text-decoration: none; color: #94a3b8; display: inline-flex; align-items: center; gap: 6px; font-weight: 700;">
                        <span>🔗</span>
                        <span>Open Bot (Click Start)</span>
                    </a>
                </div>
                <div id="telegram-test-feedback" style="display: none; font-size: 11px; margin-top: 8px; padding: 6px 10px; border-radius: 6px; font-weight: 700;"></div>
            </div>

            <!-- Search and Filter Bar -->
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
                <input type="text" id="tx-search-input" class="form-input" placeholder="🔍 Search by UTR / Phone / User ID / Bank A/C..." value="${txSearchQuery}" style="width: 100%; box-sizing: border-box; font-size: 12px;" />
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <select id="tx-filter-type" class="form-select" style="flex: 1; min-width: 130px; font-size: 12px;">
                        <option value="ALL" ${txFilterType === 'ALL' ? 'selected' : ''}>All Transaction Types</option>
                        <option value="DEPOSIT" ${txFilterType === 'DEPOSIT' ? 'selected' : ''}>📥 Deposits Only</option>
                        <option value="WITHDRAWAL" ${txFilterType === 'WITHDRAWAL' ? 'selected' : ''}>📤 Withdrawals Only</option>
                    </select>
                    <select id="tx-filter-status" class="form-select" style="flex: 1; min-width: 130px; font-size: 12px;">
                        <option value="ALL" ${txFilterStatus === 'ALL' ? 'selected' : ''}>All Statuses</option>
                        <option value="PENDING" ${txFilterStatus === 'PENDING' ? 'selected' : ''}>⏳ Pending Only (${totalPending})</option>
                        <option value="APPROVED" ${txFilterStatus === 'APPROVED' ? 'selected' : ''}>✅ Approved</option>
                        <option value="REJECTED" ${txFilterStatus === 'REJECTED' ? 'selected' : ''}>❌ Rejected</option>
                    </select>
                </div>
            </div>

            <!-- Transactions List -->
            <div style="display: flex; flex-direction: column; gap: 10px;">
                ${filtered.length === 0 ? `
                    <div style="text-align: center; padding: 30px 20px; color: var(--text-muted); font-size: 13px; background: var(--bg-input); border-radius: 10px; border: 1px dashed var(--border-color);">
                        No matching deposit or withdrawal records found.
                    </div>
                ` : filtered.map(tx => {
                    const isPending = tx.status === 'PENDING';
                    const isDeposit = tx.type === 'DEPOSIT';
                    const statusColor = tx.status === 'APPROVED' ? 'var(--accent-green)' : (tx.status === 'REJECTED' ? 'var(--accent-red)' : 'var(--primary)');
                    const formattedDate = new Date(tx.createdAt).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
                    });

                    return `
                        <div style="background: var(--bg-input); border-left: 4px solid ${isDeposit ? 'var(--accent-green)' : 'var(--accent-violet)'}; border-radius: 10px; padding: 14px; border-top: 1px solid var(--border-color); border-right: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); ${isPending ? 'box-shadow: 0 0 10px rgba(245, 158, 11, 0.15);' : ''}">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-weight: 900; font-size: 13px; color: #fff;">
                                        ${isDeposit ? '📥 DEPOSIT REQUEST' : '📤 WITHDRAWAL REQUEST'}
                                    </span>
                                    <span style="font-size: 10px; font-family: monospace; color: var(--text-muted);">#${tx.id.slice(-8)}</span>
                                </div>
                                <span style="font-size: 10px; font-weight: 800; padding: 3px 9px; border-radius: 12px; background: ${statusColor}22; color: ${statusColor}; border: 1px solid ${statusColor}44;">
                                    ${tx.status}
                                </span>
                            </div>

                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <div>
                                    <div style="font-size: 12px; color: var(--text-muted);">
                                        Player: <b style="color: #fff;">${tx.userId}</b>
                                    </div>
                                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${formattedDate}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 20px; font-weight: 900; color: ${isDeposit ? 'var(--accent-green)' : 'var(--primary)'};">
                                        ₹${Number(tx.amount || 0).toLocaleString('en-IN')}
                                    </div>
                                </div>
                            </div>

                            <!-- Detailed Banking / Payment Reference Box -->
                            <div style="background: var(--bg-card); padding: 10px 12px; border-radius: 8px; font-size: 11px; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.06); line-height: 1.6;">
                                ${isDeposit ? `
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span>UTR / Ref No:</span>
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <b style="color: #38bdf8; font-family: monospace; font-size: 12px;">${tx.utrNumber || 'N/A'}</b>
                                            ${tx.utrNumber ? `<button type="button" class="btn-copy-chip copy-trigger" data-copy="${tx.utrNumber}">📋 Copy</button>` : ''}
                                        </div>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                                        <span>Gateway UPI:</span>
                                        <span style="color: var(--text-muted);">${tx.upiId || 'VIP Merchant Gateway'}</span>
                                    </div>
                                ` : `
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span>Bank & Name:</span>
                                        <span style="color: #fff; font-weight: 700;">${tx.bankName || 'Bank Payout'} (${tx.accountHolderName || 'User'})</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                                        <span>Account No:</span>
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <b style="color: #38bdf8; font-family: monospace; font-size: 12px;">${tx.accountNumber || tx.upiId || 'N/A'}</b>
                                            ${tx.accountNumber ? `<button type="button" class="btn-copy-chip copy-trigger" data-copy="${tx.accountNumber}">📋 Copy</button>` : ''}
                                        </div>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                                        <span>IFSC Code:</span>
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <b style="color: #facc15; font-family: monospace;">${tx.ifsc || 'N/A'}</b>
                                            ${tx.ifsc ? `<button type="button" class="btn-copy-chip copy-trigger" data-copy="${tx.ifsc}">📋 Copy</button>` : ''}
                                        </div>
                                    </div>
                                    ${tx.upiId ? `
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                                            <span>UPI ID:</span>
                                            <div style="display: flex; align-items: center; gap: 6px;">
                                                <b style="color: #a78bfa;">${tx.upiId}</b>
                                                <button type="button" class="btn-copy-chip copy-trigger" data-copy="${tx.upiId}">📋 Copy</button>
                                            </div>
                                        </div>
                                    ` : ''}
                                `}
                                ${tx.adminRemarks ? `
                                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1); color: var(--primary); font-weight: 700;">
                                        Admin Remarks: ${tx.adminRemarks}
                                    </div>
                                ` : ''}
                            </div>

                            <!-- Action Buttons for Pending -->
                            ${isPending ? `
                                <div style="display: flex; gap: 8px;">
                                    <button class="btn-approve-tx btn-secondary" data-id="${tx.id}" style="flex: 1; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; font-weight: 900; padding: 10px; font-size: 12px; border: none; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);">
                                        ✅ Approve ${isDeposit ? '& Credit Balance' : '& Mark Paid'}
                                    </button>
                                    <button class="btn-reject-tx btn-secondary" data-id="${tx.id}" style="flex: 1; background: rgba(239,68,68,0.18); color: var(--accent-red); font-weight: 800; padding: 10px; font-size: 12px; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; cursor: pointer;">
                                        ❌ Reject ${isDeposit ? 'Request' : '& Refund'}
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
    container.querySelector('#tx-filter-type')?.addEventListener('change', (e) => {
        txFilterType = e.target.value;
        renderActiveTab(true);
    });

    container.querySelector('#tx-filter-status')?.addEventListener('change', (e) => {
        txFilterStatus = e.target.value;
        renderActiveTab(true);
    });

    const searchInput = container.querySelector('#tx-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            txSearchQuery = e.target.value;
            renderActiveTab(false);
        });
    }

    // Audio Test Buttons
    container.querySelector('#btn-cashier-test-alarm')?.addEventListener('click', () => {
        getAudioContext();
        play5SecondAlarm();
    });

    container.querySelector('#btn-banner-test-sound')?.addEventListener('click', () => {
        getAudioContext();
        play5SecondAlarm();
    });

    // 1-Click Copy Chips
    container.querySelectorAll('.copy-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.dataset.copy;
            if (text) {
                navigator.clipboard.writeText(text).then(() => {
                    const original = btn.textContent;
                    btn.textContent = '✓ Copied!';
                    btn.style.color = '#10b981';
                    setTimeout(() => {
                        btn.textContent = original;
                        btn.style.color = '#38bdf8';
                    }, 1500);
                }).catch(() => {
                    prompt('Copy text manually:', text);
                });
            }
        });
    });

    // Telegram Bot Test Button
    const tgBtn = container.querySelector('#btn-telegram-test');
    const tgFeedback = container.querySelector('#telegram-test-feedback');
    if (tgBtn) {
        tgBtn.addEventListener('click', async () => {
            tgBtn.disabled = true;
            tgBtn.textContent = 'Sending Test Msg...';
            if (tgFeedback) tgFeedback.style.display = 'none';

            try {
                const res = await adminService.sendTelegramTest();
                if (tgFeedback) {
                    tgFeedback.style.display = 'block';
                    tgFeedback.style.background = 'rgba(16, 185, 129, 0.15)';
                    tgFeedback.style.color = '#10b981';
                    tgFeedback.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                    tgFeedback.textContent = '✅ Telegram test notification sent successfully to @smarty91_alert_bot!';
                }
            } catch (err) {
                if (tgFeedback) {
                    tgFeedback.style.display = 'block';
                    tgFeedback.style.background = 'rgba(239, 68, 68, 0.15)';
                    tgFeedback.style.color = '#ef4444';
                    tgFeedback.style.border = '1px solid rgba(239, 68, 68, 0.3)';
                    tgFeedback.textContent = `❌ ${err.message || 'Failed to send Telegram message. Make sure you opened @smarty91_alert_bot and clicked START!'}`;
                }
            } finally {
                tgBtn.disabled = false;
                tgBtn.textContent = '📲 SEND TELEGRAM TEST MSG';
            }
        });
    }

    // Approve & Reject Handlers
    container.querySelectorAll('.btn-approve-tx').forEach(btn => {
        btn.addEventListener('click', async () => {
            const txId = btn.dataset.id;
            const confirmed = confirm('Are you sure you want to APPROVE this transaction? This will instantly credit the balance / mark withdrawal paid.');
            if (!confirmed) return;

            try {
                btn.textContent = 'Approving...';
                btn.disabled = true;
                await adminService.processTransaction(txId, 'APPROVE', 'Approved by Admin');
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message || 'Approval failed');
                btn.textContent = 'Approve';
                btn.disabled = false;
            }
        });
    });

    container.querySelectorAll('.btn-reject-tx').forEach(btn => {
        btn.addEventListener('click', async () => {
            const txId = btn.dataset.id;
            const remarks = prompt('Enter rejection reason / remarks for player:', 'Payment verification failed / Invalid UTR');
            if (remarks === null) return;

            try {
                btn.textContent = 'Rejecting...';
                btn.disabled = true;
                await adminService.processTransaction(txId, 'REJECT', remarks);
                await fetchAndRefreshData();
            } catch (err) {
                alert(err.message || 'Rejection failed');
                btn.textContent = 'Reject';
                btn.disabled = false;
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
// 5.5. TODAY'S PROFIT STARS MANAGER (HOME PAGE PODIUM CONTROLLER)
// -------------------------------------------------------------
let cachedProfitStars = null;
let cachedReferralStars = null;

async function renderProfitStarsView(container, force = false) {
    const isMounted = container.querySelector('#profit-stars-admin-view');
    if (isMounted && !force) return;

    try {
        const resp = await adminService.getProfitStars();
        if (resp && resp.success && resp.profitStars) {
            cachedProfitStars = resp.profitStars;
        }
    } catch (e) {
        console.warn('Failed to fetch profit stars for admin:', e);
    }

    try {
        const respRef = await adminService.getReferralStars();
        if (respRef && respRef.success && respRef.referralStars) {
            cachedReferralStars = respRef.referralStars;
        }
    } catch (e) {
        console.warn('Failed to fetch referral stars for admin:', e);
    }

    const s = cachedProfitStars || {
        rank1: { first2: '98', last2: '71', amount: '₹1,84,500' },
        rank2: { first2: '91', last2: '04', amount: '₹1,12,800' },
        rank3: { first2: '88', last2: '51', amount: '₹76,400' }
    };

    const refS = cachedReferralStars || {
        rank1: { first2: '98', last2: '12', amount: '₹1,48,500' },
        rank2: { first2: '91', last2: '88', amount: '₹92,400' },
        rank3: { first2: '88', last2: '45', amount: '₹64,200' }
    };

    container.innerHTML = `
        <div id="profit-stars-admin-view" class="admin-card">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 20px;">👑</span>
                    <div>
                        <div style="font-size: 15px; font-weight: 800; color: #fff;">Today's Profit Stars Controller</div>
                        <div style="font-size: 11px; color: var(--text-muted);">Edit the top 3 leaderboard winners shown on the Home screen</div>
                    </div>
                </div>
                <span style="font-size: 10px; font-weight: 800; background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); padding: 3px 8px; border-radius: 12px;">
                    ⚡ Live Home Sync
                </span>
            </div>

            <!-- Rank 1: Gold / Champion -->
            <div style="background: rgba(245, 158, 11, 0.08); border: 1.5px solid rgba(245, 158, 11, 0.35); border-radius: 12px; padding: 14px; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #f59e0b;">
                        <span>🥇</span>
                        <span>RANK 1 (1ST PLACE - GOLD CHAMPION)</span>
                    </div>
                    <div id="preview-rank1" style="font-size: 11px; font-weight: 700; color: #fef08a; background: rgba(0,0,0,0.4); padding: 3px 8px; border-radius: 6px;">
                        Preview: User ${s.rank1.first2 || '98'}***${s.rank1.last2 || '71'} (${s.rank1.amount || '₹1,84,500'})
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px;">
                    <div>
                        <label class="form-label" style="color: #fcd34d;">First 2 Digits</label>
                        <input type="text" id="star-r1-first2" class="form-input" value="${s.rank1.first2 || '98'}" maxlength="4" placeholder="98" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label" style="color: #fcd34d;">Last 2 Digits</label>
                        <input type="text" id="star-r1-last2" class="form-input" value="${s.rank1.last2 || '71'}" maxlength="4" placeholder="71" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label" style="color: #fcd34d;">Profit Price / Amount (₹)</label>
                        <input type="text" id="star-r1-amount" class="form-input" value="${s.rank1.amount || '₹1,84,500'}" placeholder="₹1,84,500" style="font-size: 14px; font-weight: 700; color: #34d399;" />
                    </div>
                </div>
            </div>

            <!-- Rank 2: Silver -->
            <div style="background: rgba(148, 163, 184, 0.08); border: 1.5px solid rgba(148, 163, 184, 0.3); border-radius: 12px; padding: 14px; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #cbd5e1;">
                        <span>🥈</span>
                        <span>RANK 2 (2ND PLACE - SILVER PODIUM)</span>
                    </div>
                    <div id="preview-rank2" style="font-size: 11px; font-weight: 700; color: #e2e8f0; background: rgba(0,0,0,0.4); padding: 3px 8px; border-radius: 6px;">
                        Preview: User ${s.rank2.first2 || '91'}***${s.rank2.last2 || '04'} (${s.rank2.amount || '₹1,12,800'})
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px;">
                    <div>
                        <label class="form-label">First 2 Digits</label>
                        <input type="text" id="star-r2-first2" class="form-input" value="${s.rank2.first2 || '91'}" maxlength="4" placeholder="91" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label">Last 2 Digits</label>
                        <input type="text" id="star-r2-last2" class="form-input" value="${s.rank2.last2 || '04'}" maxlength="4" placeholder="04" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label">Profit Price / Amount (₹)</label>
                        <input type="text" id="star-r2-amount" class="form-input" value="${s.rank2.amount || '₹1,12,800'}" placeholder="₹1,12,800" style="font-size: 14px; font-weight: 700; color: #34d399;" />
                    </div>
                </div>
            </div>

            <!-- Rank 3: Bronze -->
            <div style="background: rgba(180, 83, 9, 0.08); border: 1.5px solid rgba(180, 83, 9, 0.35); border-radius: 12px; padding: 14px; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #fb923c;">
                        <span>🥉</span>
                        <span>RANK 3 (3RD PLACE - BRONZE PODIUM)</span>
                    </div>
                    <div id="preview-rank3" style="font-size: 11px; font-weight: 700; color: #fed7aa; background: rgba(0,0,0,0.4); padding: 3px 8px; border-radius: 6px;">
                        Preview: User ${s.rank3.first2 || '88'}***${s.rank3.last2 || '51'} (${s.rank3.amount || '₹76,400'})
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px;">
                    <div>
                        <label class="form-label" style="color: #fdba74;">First 2 Digits</label>
                        <input type="text" id="star-r3-first2" class="form-input" value="${s.rank3.first2 || '88'}" maxlength="4" placeholder="88" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label" style="color: #fdba74;">Last 2 Digits</label>
                        <input type="text" id="star-r3-last2" class="form-input" value="${s.rank3.last2 || '51'}" maxlength="4" placeholder="51" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label" style="color: #fdba74;">Profit Price / Amount (₹)</label>
                        <input type="text" id="star-r3-amount" class="form-input" value="${s.rank3.amount || '₹76,400'}" placeholder="₹76,400" style="font-size: 14px; font-weight: 700; color: #34d399;" />
                    </div>
                </div>
            </div>

            <!-- Feedback banner -->
            <div id="profit-stars-feedback" style="display:none; padding: 10px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; margin-bottom: 14px;"></div>

            <!-- Action Button -->
            <button id="btn-save-profit-stars" class="btn-primary" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #000; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span>👑</span>
                <span>SAVE & SYNC TODAY'S PROFIT STARS</span>
            </button>
        </div>

        <!-- TOP 3 REFERRAL STARS CONTROLLER -->
        <div id="referral-stars-admin-view" class="admin-card" style="margin-top: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 20px;">🌟</span>
                    <div>
                        <div style="font-size: 15px; font-weight: 800; color: #fff;">Top 3 Referral Stars Controller</div>
                        <div style="font-size: 11px; color: var(--text-muted);">Customize the Top 3 Agent Champions shown on the Referral Hub</div>
                    </div>
                </div>
                <span style="font-size: 10px; font-weight: 800; background: rgba(229, 24, 55, 0.15); color: #ff4d6d; border: 1px solid rgba(229, 24, 55, 0.3); padding: 3px 8px; border-radius: 12px;">
                    ⚡ Live Referral Sync
                </span>
            </div>

            <!-- Rank 1 Referral Star -->
            <div style="background: rgba(229, 24, 55, 0.08); border: 1.5px solid rgba(229, 24, 55, 0.35); border-radius: 12px; padding: 14px; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #ff4d6d;">
                        <span>🥇</span>
                        <span>RANK 1 (1ST PLACE - GOLD CHAMPION)</span>
                    </div>
                    <div id="preview-ref-rank1" style="font-size: 11px; font-weight: 700; color: #ff4d6d; background: rgba(0,0,0,0.4); padding: 3px 8px; border-radius: 6px;">
                        Preview: User ${refS.rank1.first2 || '98'}***${refS.rank1.last2 || '12'} (${refS.rank1.amount || '₹1,48,500'})
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px;">
                    <div>
                        <label class="form-label" style="color: #ff4d6d;">First 2 Digits</label>
                        <input type="text" id="refstar-r1-first2" class="form-input" value="${refS.rank1.first2 || '98'}" maxlength="4" placeholder="98" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label" style="color: #ff4d6d;">Last 2 Digits</label>
                        <input type="text" id="refstar-r1-last2" class="form-input" value="${refS.rank1.last2 || '12'}" maxlength="4" placeholder="12" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label" style="color: #ff4d6d;">Earnings Amount (₹)</label>
                        <input type="text" id="refstar-r1-amount" class="form-input" value="${refS.rank1.amount || '₹1,48,500'}" placeholder="₹1,48,500" style="font-size: 14px; font-weight: 700; color: #34d399;" />
                    </div>
                </div>
            </div>

            <!-- Rank 2 Referral Star -->
            <div style="background: rgba(255, 215, 0, 0.05); border: 1.5px solid rgba(255, 215, 0, 0.25); border-radius: 12px; padding: 14px; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #FFD700;">
                        <span>🥈</span>
                        <span>RANK 2 (2ND PLACE - SILVER PODIUM)</span>
                    </div>
                    <div id="preview-ref-rank2" style="font-size: 11px; font-weight: 700; color: #ffd700; background: rgba(0,0,0,0.4); padding: 3px 8px; border-radius: 6px;">
                        Preview: User ${refS.rank2.first2 || '91'}***${refS.rank2.last2 || '88'} (${refS.rank2.amount || '₹92,400'})
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px;">
                    <div>
                        <label class="form-label">First 2 Digits</label>
                        <input type="text" id="refstar-r2-first2" class="form-input" value="${refS.rank2.first2 || '91'}" maxlength="4" placeholder="91" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label">Last 2 Digits</label>
                        <input type="text" id="refstar-r2-last2" class="form-input" value="${refS.rank2.last2 || '88'}" maxlength="4" placeholder="88" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label">Earnings Amount (₹)</label>
                        <input type="text" id="refstar-r2-amount" class="form-input" value="${refS.rank2.amount || '₹92,400'}" placeholder="₹92,400" style="font-size: 14px; font-weight: 700; color: #34d399;" />
                    </div>
                </div>
            </div>

            <!-- Rank 3 Referral Star -->
            <div style="background: rgba(180, 83, 9, 0.08); border: 1.5px solid rgba(180, 83, 9, 0.35); border-radius: 12px; padding: 14px; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #fb923c;">
                        <span>🥉</span>
                        <span>RANK 3 (3RD PLACE - BRONZE PODIUM)</span>
                    </div>
                    <div id="preview-ref-rank3" style="font-size: 11px; font-weight: 700; color: #fed7aa; background: rgba(0,0,0,0.4); padding: 3px 8px; border-radius: 6px;">
                        Preview: User ${refS.rank3.first2 || '88'}***${refS.rank3.last2 || '45'} (${refS.rank3.amount || '₹64,200'})
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px;">
                    <div>
                        <label class="form-label" style="color: #fdba74;">First 2 Digits</label>
                        <input type="text" id="refstar-r3-first2" class="form-input" value="${refS.rank3.first2 || '88'}" maxlength="4" placeholder="88" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label" style="color: #fdba74;">Last 2 Digits</label>
                        <input type="text" id="refstar-r3-last2" class="form-input" value="${refS.rank3.last2 || '45'}" maxlength="4" placeholder="45" style="font-family: monospace; font-size: 14px; font-weight: 700; text-align: center;" />
                    </div>
                    <div>
                        <label class="form-label" style="color: #fdba74;">Earnings Amount (₹)</label>
                        <input type="text" id="refstar-r3-amount" class="form-input" value="${refS.rank3.amount || '₹64,200'}" placeholder="₹64,200" style="font-size: 14px; font-weight: 700; color: #34d399;" />
                    </div>
                </div>
            </div>

            <div id="referral-stars-feedback" style="display:none; padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; margin-bottom: 12px;"></div>

            <button id="btn-save-referral-stars" class="btn-primary" style="background: linear-gradient(135deg, #E51837 0%, #B80A22 100%); color: #fff; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span>🌟</span>
                <span>SAVE & SYNC TOP 3 REFERRAL STARS</span>
            </button>
        </div>
    `;

    // Live Preview update listeners
    const updatePreviews = () => {
        const f1 = container.querySelector('#star-r1-first2').value.trim() || '98';
        const l1 = container.querySelector('#star-r1-last2').value.trim() || '71';
        const a1 = container.querySelector('#star-r1-amount').value.trim() || '₹1,84,500';
        container.querySelector('#preview-rank1').textContent = `Preview: User ${f1}***${l1} (${a1})`;

        const f2 = container.querySelector('#star-r2-first2').value.trim() || '91';
        const l2 = container.querySelector('#star-r2-last2').value.trim() || '04';
        const a2 = container.querySelector('#star-r2-amount').value.trim() || '₹1,12,800';
        container.querySelector('#preview-rank2').textContent = `Preview: User ${f2}***${l2} (${a2})`;

        const f3 = container.querySelector('#star-r3-first2').value.trim() || '88';
        const l3 = container.querySelector('#star-r3-last2').value.trim() || '51';
        const a3 = container.querySelector('#star-r3-amount').value.trim() || '₹76,400';
        container.querySelector('#preview-rank3').textContent = `Preview: User ${f3}***${l3} (${a3})`;

        // Referral Stars Previews
        const rf1 = container.querySelector('#refstar-r1-first2').value.trim() || '98';
        const rl1 = container.querySelector('#refstar-r1-last2').value.trim() || '12';
        const ra1 = container.querySelector('#refstar-r1-amount').value.trim() || '₹1,48,500';
        container.querySelector('#preview-ref-rank1').textContent = `Preview: User ${rf1}***${rl1} (${ra1})`;

        const rf2 = container.querySelector('#refstar-r2-first2').value.trim() || '91';
        const rl2 = container.querySelector('#refstar-r2-last2').value.trim() || '88';
        const ra2 = container.querySelector('#refstar-r2-amount').value.trim() || '₹92,400';
        container.querySelector('#preview-ref-rank2').textContent = `Preview: User ${rf2}***${rl2} (${ra2})`;

        const rf3 = container.querySelector('#refstar-r3-first2').value.trim() || '88';
        const rl3 = container.querySelector('#refstar-r3-last2').value.trim() || '45';
        const ra3 = container.querySelector('#refstar-r3-amount').value.trim() || '₹64,200';
        container.querySelector('#preview-ref-rank3').textContent = `Preview: User ${rf3}***${rl3} (${ra3})`;
    };

    container.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', updatePreviews);
    });

    // Save button event listener
    const saveBtn = container.querySelector('#btn-save-profit-stars');
    const feedbackEl = container.querySelector('#profit-stars-feedback');

    saveBtn.addEventListener('click', async () => {
        const payload = {
            rank1: {
                first2: container.querySelector('#star-r1-first2').value.trim(),
                last2: container.querySelector('#star-r1-last2').value.trim(),
                amount: container.querySelector('#star-r1-amount').value.trim()
            },
            rank2: {
                first2: container.querySelector('#star-r2-first2').value.trim(),
                last2: container.querySelector('#star-r2-last2').value.trim(),
                amount: container.querySelector('#star-r2-amount').value.trim()
            },
            rank3: {
                first2: container.querySelector('#star-r3-first2').value.trim(),
                last2: container.querySelector('#star-r3-last2').value.trim(),
                amount: container.querySelector('#star-r3-amount').value.trim()
            }
        };

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span>⏳</span><span>SAVING & SYNCING...</span>';

        try {
            const res = await adminService.updateProfitStars(payload);
            if (res && res.success) {
                cachedProfitStars = res.profitStars;
                feedbackEl.style.display = 'block';
                feedbackEl.style.background = 'rgba(16, 185, 129, 0.15)';
                feedbackEl.style.border = '1px solid #10b981';
                feedbackEl.style.color = '#10b981';
                feedbackEl.textContent = '✅ Success! Today\'s Profit Stars updated and synced to Firestore & all live players!';
                updatePreviews();
            } else {
                throw new Error(res.message || 'Failed to update profit stars');
            }
        } catch (err) {
            feedbackEl.style.display = 'block';
            feedbackEl.style.background = 'rgba(239, 68, 68, 0.15)';
            feedbackEl.style.border = '1px solid #ef4444';
            feedbackEl.style.color = '#ef4444';
            feedbackEl.textContent = `❌ Error: ${err.message}`;
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<span>👑</span><span>SAVE & SYNC TODAY\'S PROFIT STARS</span>';
        }
    });

    // Save Referral Stars listener
    const saveRefBtn = container.querySelector('#btn-save-referral-stars');
    const refFeedbackEl = container.querySelector('#referral-stars-feedback');

    if (saveRefBtn) {
        saveRefBtn.addEventListener('click', async () => {
            const payload = {
                rank1: {
                    first2: container.querySelector('#refstar-r1-first2').value.trim(),
                    last2: container.querySelector('#refstar-r1-last2').value.trim(),
                    amount: container.querySelector('#refstar-r1-amount').value.trim()
                },
                rank2: {
                    first2: container.querySelector('#refstar-r2-first2').value.trim(),
                    last2: container.querySelector('#refstar-r2-last2').value.trim(),
                    amount: container.querySelector('#refstar-r2-amount').value.trim()
                },
                rank3: {
                    first2: container.querySelector('#refstar-r3-first2').value.trim(),
                    last2: container.querySelector('#refstar-r3-last2').value.trim(),
                    amount: container.querySelector('#refstar-r3-amount').value.trim()
                }
            };

            saveRefBtn.disabled = true;
            saveRefBtn.innerHTML = '<span>⏳</span><span>SAVING & SYNCING...</span>';

            try {
                const res = await adminService.updateReferralStars(payload);
                if (res && res.success) {
                    cachedReferralStars = res.referralStars;
                    refFeedbackEl.style.display = 'block';
                    refFeedbackEl.style.background = 'rgba(16, 185, 129, 0.15)';
                    refFeedbackEl.style.border = '1px solid #10b981';
                    refFeedbackEl.style.color = '#10b981';
                    refFeedbackEl.textContent = '✅ Success! Top 3 Referral Stars updated and synced to Firestore & Referral Hub!';
                    updatePreviews();
                } else {
                    throw new Error(res.message || 'Failed to update referral stars');
                }
            } catch (err) {
                refFeedbackEl.style.display = 'block';
                refFeedbackEl.style.background = 'rgba(239, 68, 68, 0.15)';
                refFeedbackEl.style.border = '1px solid #ef4444';
                refFeedbackEl.style.color = '#ef4444';
                refFeedbackEl.textContent = `❌ Error: ${err.message}`;
            } finally {
                saveRefBtn.disabled = false;
                saveRefBtn.innerHTML = '<span>🌟</span><span>SAVE & SYNC TOP 3 REFERRAL STARS</span>';
            }
        });
    }
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
            <div class="card-title audit-log-header-trigger" style="margin-bottom: 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
                <span>📜 System & Admin Audit Logs</span>
                <span style="font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 10px;">Audit Trail</span>
            </div>
            ${logs.length === 0 ? '<div style="font-size:12px; color:var(--text-muted);">No logs recorded yet</div>' : ''}
            <div style="display: flex; flex-direction: column; gap: 8px;">
                ${logs.map(log => `
                    <div style="background: var(--bg-input); border-left: 3px solid ${log.action.includes('DEVELOPER') ? '#10b981' : 'var(--primary)'}; padding: 10px; border-radius: 6px; font-size: 11px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <span style="font-weight: 700; color: ${log.action.includes('DEVELOPER') ? '#10b981' : '#fff'};">${log.action}</span>
                            <span style="color: var(--text-muted); font-size: 10px;">${new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div style="color: var(--text-muted);">${log.details}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    // Also attach tap listener to the card header
    const headerTrigger = container.querySelector('.audit-log-header-trigger');
    if (headerTrigger) {
        headerTrigger.addEventListener('click', handleAuditLogTap);
    }
}

// -------------------------------------------------------------
// 8. SECRET DEVELOPER PORTAL (TRIPLE-TAP TRIGGER ON AUDIT LOG)
// -------------------------------------------------------------
let tapTimestamps = [];

function handleAuditLogTap() {
    const now = Date.now();
    tapTimestamps.push(now);

    // Keep only timestamps within 1.5 seconds
    tapTimestamps = tapTimestamps.filter(t => now - t <= 1500);

    if (tapTimestamps.length >= 3) {
        tapTimestamps = [];
        openDeveloperAuthModal();
    }
}

function initDeveloperPortal() {
    // Attach triple tap to bottom nav item "Audit Logs"
    const logsNavItem = document.querySelector('.nav-item[data-tab="logs"]');
    if (logsNavItem) {
        logsNavItem.addEventListener('click', handleAuditLogTap);
    }

    // Modal elements
    const authModal = document.getElementById('dev-portal-auth-modal');
    const mainModal = document.getElementById('dev-portal-main-modal');
    const closeAuthBtn = document.getElementById('close-dev-auth-modal-btn');
    const cancelAuthBtn = document.getElementById('cancel-dev-auth-btn');
    const submitAuthBtn = document.getElementById('submit-dev-auth-btn');
    const passwordInput = document.getElementById('dev-portal-password-input');
    const authError = document.getElementById('dev-portal-auth-error');

    const closeMainBtn = document.getElementById('close-dev-portal-modal-btn');
    const currentUpiEl = document.getElementById('dev-portal-current-upi');
    const currentUsdtEl = document.getElementById('dev-portal-current-usdt');
    const currentNameEl = document.getElementById('dev-portal-current-name');
    const newUpiInput = document.getElementById('dev-portal-new-upi-input');
    const newUsdtInput = document.getElementById('dev-portal-new-usdt-input');
    const newRateInput = document.getElementById('dev-portal-new-rate-input');
    const newNameInput = document.getElementById('dev-portal-new-name-input');
    const updateBtn = document.getElementById('dev-portal-update-btn');
    const feedbackMsg = document.getElementById('dev-portal-feedback-msg');

    if (closeAuthBtn) closeAuthBtn.addEventListener('click', () => authModal.style.display = 'none');
    if (cancelAuthBtn) cancelAuthBtn.addEventListener('click', () => authModal.style.display = 'none');
    if (closeMainBtn) closeMainBtn.addEventListener('click', () => mainModal.style.display = 'none');

    // Password unlock submit
    if (submitAuthBtn) {
        submitAuthBtn.addEventListener('click', verifyDevPassword);
    }
    if (passwordInput) {
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') verifyDevPassword();
        });
    }

    function verifyDevPassword() {
        const entered = passwordInput.value.trim();
        if (entered === 'Aamir@639900' || entered === '7117' || entered === '919191') {
            authError.style.display = 'none';
            authModal.style.display = 'none';
            passwordInput.value = '';

            // Open main developer portal
            const activeUpi = liveData?.config?.upiId || '6289140468@axl';
            const activeUsdt = liveData?.config?.usdtAddress || 'TEX8NYBX78GkaStcmtp8UJGF7GJsrAnvHh';
            const activeRate = liveData?.config?.usdtRate || 90;
            const activeName = liveData?.config?.upiName || 'Smarty91';

            if (currentUpiEl) currentUpiEl.textContent = activeUpi;
            if (currentUsdtEl) currentUsdtEl.textContent = activeUsdt;
            if (currentNameEl) currentNameEl.textContent = activeName;

            if (newUpiInput) newUpiInput.value = activeUpi;
            if (newUsdtInput) newUsdtInput.value = activeUsdt;
            if (newRateInput) newRateInput.value = activeRate;
            if (newNameInput) newNameInput.value = activeName;
            if (feedbackMsg) feedbackMsg.style.display = 'none';

            mainModal.style.display = 'flex';
        } else {
            authError.textContent = 'Invalid Master Developer Password. Access Denied.';
            authError.style.display = 'block';
        }
    }

    // Realtime Config update submit
    if (updateBtn) {
        updateBtn.addEventListener('click', async () => {
            const upiId = newUpiInput ? newUpiInput.value.trim() : '';
            const usdtAddress = newUsdtInput ? newUsdtInput.value.trim() : '';
            const usdtRate = newRateInput ? Number(newRateInput.value) : 90;
            const upiName = newNameInput ? newNameInput.value.trim() : 'Smarty91';

            updateBtn.disabled = true;
            updateBtn.innerHTML = '<span>⏳</span><span>SAVING DEVELOPER CONFIG...</span>';

            try {
                const res = await fetch('/api/developer/update-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        secretKey: 'Aamir@639900',
                        upiId,
                        upiName,
                        usdtAddress,
                        usdtRate
                    })
                });

                const data = await res.json();
                if (data.success) {
                    showFeedback(`✓ Live Config & USDT Address successfully updated in Realtime Database!`, true);
                    if (currentUpiEl) currentUpiEl.textContent = data.upiId || upiId;
                    if (currentUsdtEl) currentUsdtEl.textContent = data.usdtAddress || usdtAddress;
                    if (currentNameEl) currentNameEl.textContent = data.upiName || upiName;
                    await fetchAndRefreshData();
                } else {
                    showFeedback(data.message || 'Update failed', false);
                }
            } catch (err) {
                showFeedback(err.message || 'Server error', false);
            } finally {
                updateBtn.disabled = false;
                updateBtn.innerHTML = '<span>⚡</span><span>SAVE DEVELOPER CONFIG IN REALTIME DATABASE</span>';
            }
        });
    }

    function showFeedback(text, isSuccess) {
        if (!feedbackMsg) return;
        feedbackMsg.textContent = text;
        feedbackMsg.style.display = 'block';
        feedbackMsg.style.background = isSuccess ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
        feedbackMsg.style.color = isSuccess ? '#10b981' : '#ef4444';
        feedbackMsg.style.border = `1px solid ${isSuccess ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`;
    }
}

function openDeveloperAuthModal() {
    const authModal = document.getElementById('dev-portal-auth-modal');
    const passwordInput = document.getElementById('dev-portal-password-input');
    const authError = document.getElementById('dev-portal-auth-error');

    if (authModal) {
        authModal.style.display = 'flex';
        if (authError) authError.style.display = 'none';
        if (passwordInput) {
            passwordInput.value = '';
            setTimeout(() => passwordInput.focus(), 150);
        }
    }
}
