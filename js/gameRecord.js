// gameRecord.js - Server-Authoritative Live Game Loop & Multi-Mode Orchestrator

import { period_time, period_number, tokenParent } from "./elements.js";
import { normalizeMode } from "./offlineTimer.js";
import {
    gameModes,
    SUPPORTED_MODES,
    getActiveModeKey,
    getActiveModeState,
    setActiveModeKey,
    loadPersistedState,
    evaluateModeBets,
    renderGameHistory,
    renderChartTrend,
    renderMyHistory,
    updateModeHistoryFromServer
} from "./gameEngine.js";
import { showEvaluationDialog } from "./updateWin.js";
import { playTickSound, stopCountdownAudio } from "./audio.js";
import { gameService } from "./services/gameService.js";
import { syncServerBalance } from "./wallet.js";

let masterTimerId = null;
let serverSyncTimerId = null;
let serverClockOffset = 0;

export function getCurrentGameType() {
    const state = getActiveModeState();
    return state ? state.displayName : "Smarty91 30s";
}

export function getCurrentIssueNumber() {
    const state = getActiveModeState();
    return state ? state.currentIssueNumber : "";
}

export function isBettingLocked() {
    const state = getActiveModeState();
    return state ? state.isLockoutActive : false;
}

export function getRemainingSeconds() {
    const state = getActiveModeState();
    return state ? state.remainingSeconds : 0;
}

// Render top-right winning number tokens for active mode
export function renderWinningTokensForActiveMode() {
    if (!tokenParent) return;
    const state = getActiveModeState();
    tokenParent.innerHTML = '';
    const tokens = state.tokens && state.tokens.length > 0 ? state.tokens.slice(0, 5) : [1, 5, 8, 3, 0];
    tokens.forEach(number => {
        const newDiv = document.createElement('div');
        newDiv.setAttribute("data-v-3e4c6499", "");
        newDiv.className = `n${number}`;
        tokenParent.appendChild(newDiv);
    });
}

// Format and update 5-box digital stopwatch display
function updateTimeDisplay(minutes, seconds) {
    if (!period_time) return;
    const timeDivs = period_time.querySelectorAll("div");
    if (timeDivs.length === 5) {
        timeDivs[0].textContent = Math.floor(minutes / 10);
        timeDivs[1].textContent = minutes % 10;
        timeDivs[3].textContent = Math.floor(seconds / 10);
        timeDivs[4].textContent = seconds % 10;
    }
}

// ----------------- SERVER SYNCHRONIZER -----------------

export async function syncServerGameState() {
    try {
        const res = await gameService.getGameStatus();
        if (res && res.success && res.modes) {
            if (res.serverTime) {
                serverClockOffset = res.serverTime - Date.now();
            }

            const activeKey = getActiveModeKey();

            for (const mode of SUPPORTED_MODES) {
                const serverMode = res.modes[mode];
                const state = gameModes[mode];
                if (!serverMode || !state) continue;

                const prevPeriod = state.currentIssueNumber;
                state.currentIssueNumber = serverMode.periodId;
                state.currentEndTimeMs = serverMode.endTimeMs;
                state.remainingSeconds = serverMode.remainingSeconds;
                state.isLockoutActive = serverMode.isLocked;

                // Detect period transition from server
                if (prevPeriod && prevPeriod !== serverMode.periodId) {
                    await handlePeriodSettledFromServer(mode, prevPeriod);
                }
            }

            // Sync active view UI
            const activeState = gameModes[activeKey];
            if (activeState && period_number) {
                period_number.textContent = activeState.currentIssueNumber;
            }
        }
    } catch (err) {
        console.warn('Server game state poll note:', err.message);
    }
}

async function handlePeriodSettledFromServer(mode, settledPeriodId) {
    try {
        const historyRes = await gameService.getGameHistory(mode, 1, 20);
        if (historyRes && historyRes.success && historyRes.items) {
            updateModeHistoryFromServer(mode, historyRes.items);

            const state = gameModes[mode];
            const latestResult = state.history[0];

            if (latestResult) {
                const evaluation = evaluateModeBets(mode, latestResult);
                syncServerBalance();

                if (mode === getActiveModeKey()) {
                    renderWinningTokensForActiveMode();
                    renderGameHistory(mode);
                    renderChartTrend(mode);
                    renderMyHistory(mode);

                    if (evaluation && evaluation.evaluatedBets && evaluation.evaluatedBets.length > 0) {
                        showEvaluationDialog(evaluation);
                    }
                }
            }
        }
    } catch (e) {
        console.warn('History fetch error on settlement:', e);
    }
}

// Initial fetch of histories for all 4 modes
export async function initializeServerHistories() {
    for (const mode of SUPPORTED_MODES) {
        try {
            const res = await gameService.getGameHistory(mode, 1, 30);
            if (res && res.success && res.items && res.items.length > 0) {
                updateModeHistoryFromServer(mode, res.items);
            }
        } catch (e) {
            console.warn(`Could not seed history for ${mode}:`, e);
        }
    }
    const activeMode = getActiveModeKey();
    renderWinningTokensForActiveMode();
    renderGameHistory(activeMode);
    renderChartTrend(activeMode);
    renderMyHistory(activeMode);
}

// ----------------- LOCAL SMOOTH TICK LOOP -----------------

function processMasterTick() {
    const adjustedNow = Date.now() + serverClockOffset;
    const activeKey = getActiveModeKey();
    const bettingMark = document.querySelector(".Betting__C-mark");

    SUPPORTED_MODES.forEach(mode => {
        const state = gameModes[mode];
        if (!state) return;

        const timeLeftMs = Math.max(0, state.currentEndTimeMs - adjustedNow);
        const totalSeconds = Math.floor(timeLeftMs / 1000);
        state.remainingSeconds = totalSeconds;

        const isCurrentActive = mode === activeKey;

        // 1. Check for Round Finish & Request Server Settle
        if (timeLeftMs <= 0) {
            const finishedIssue = state.currentIssueNumber;
            const settlementKey = `${mode}:${finishedIssue}`;

            if (!state.settledRounds.has(settlementKey)) {
                state.settledRounds.add(settlementKey);
                // Trigger fast server sync on boundary
                setTimeout(() => syncServerGameState(), 300);
            }
            return;
        }

        // 2. Check for 5-Second Betting Lockout
        if (totalSeconds <= 5 && totalSeconds > 0) {
            state.isLockoutActive = true;

            if (isCurrentActive) {
                const bettingOverlay = document.querySelector('.van-overlay[data-v-7f36fe93]');
                const dialogDiv = document.querySelector('div[role="dialog"][data-v-7f36fe93]');
                if (bettingOverlay) bettingOverlay.style.display = 'none';
                if (dialogDiv) dialogDiv.style.display = 'none';
                document.body.classList.remove('van-overflow-hidden');

                if (bettingMark) {
                    bettingMark.style.display = "flex";
                    bettingMark.innerHTML = `
                        <div data-v-4aca9bd1>${Math.floor(totalSeconds / 10)}</div>
                        <div data-v-4aca9bd1>${totalSeconds % 10}</div>
                    `;
                }

                if (totalSeconds !== state.lastTickSecond) {
                    playTickSound(totalSeconds);
                    state.lastTickSecond = totalSeconds;
                }
            }
        } else {
            state.isLockoutActive = false;
            if (isCurrentActive && bettingMark) {
                bettingMark.style.display = "none";
            }
        }

        // 3. Update Active Digital Clock & Period Display
        if (isCurrentActive) {
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            updateTimeDisplay(minutes, seconds);

            if (period_number && period_number.textContent !== state.currentIssueNumber) {
                period_number.textContent = state.currentIssueNumber;
            }
        }
    });
}

export function startMasterScheduler() {
    if (masterTimerId) clearInterval(masterTimerId);
    masterTimerId = setInterval(processMasterTick, 250);

    if (serverSyncTimerId) clearInterval(serverSyncTimerId);
    // Poll server game state every 1000ms for continuous sync
    serverSyncTimerId = setInterval(syncServerGameState, 1000);
}

// Switch game mode (30s, 1Min, 3Min, 5Min)
export function switchGameMode(newGameType) {
    const targetMode = normalizeMode(newGameType);
    setActiveModeKey(targetMode);

    stopCountdownAudio();

    const state = getActiveModeState();
    const bettingMark = document.querySelector(".Betting__C-mark");

    if (period_number) {
        period_number.textContent = state.currentIssueNumber;
    }

    const totalSeconds = state.remainingSeconds;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    updateTimeDisplay(minutes, seconds);

    if (state.isLockoutActive && totalSeconds <= 5 && totalSeconds > 0) {
        if (bettingMark) {
            bettingMark.style.display = "flex";
            bettingMark.innerHTML = `
                <div data-v-4aca9bd1>${Math.floor(totalSeconds / 10)}</div>
                <div data-v-4aca9bd1>${totalSeconds % 10}</div>
            `;
        }
    } else {
        if (bettingMark) bettingMark.style.display = "none";
    }

    const timeLeftName = document.querySelector('.TimeLeft__C .TimeLeft__C-name');
    if (timeLeftName) {
        timeLeftName.textContent = state.displayName;
    }

    const popupHeadTitle = document.querySelector('.Betting__Popup-head-title');
    if (popupHeadTitle) {
        popupHeadTitle.textContent = state.displayName;
    }

    renderWinningTokensForActiveMode();
    renderGameHistory(targetMode);
    renderChartTrend(targetMode);
    renderMyHistory(targetMode);
}

// Initialize on page load
export async function initGameRecord() {
    loadPersistedState();

    const initialMode = getActiveModeKey();
    const state = getActiveModeState();

    if (period_number) {
        period_number.textContent = state.currentIssueNumber;
    }
    const timeLeftName = document.querySelector('.TimeLeft__C .TimeLeft__C-name');
    if (timeLeftName) {
        timeLeftName.textContent = state.displayName;
    }

    renderWinningTokensForActiveMode();
    renderGameHistory(initialMode);
    renderChartTrend(initialMode);
    renderMyHistory(initialMode);

    // Initial server sync
    await syncServerGameState();
    await initializeServerHistories();

    // Start local and server timers
    startMasterScheduler();
}
