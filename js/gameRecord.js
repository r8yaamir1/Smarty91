// gameRecord.js - Game Loop, Countdown Timer & Multi-Mode Orchestrator

import { period_time, period_number, tokenParent } from "./elements.js";
import { generateOfflinePeriodData, normalizeMode, MODE_DISPLAY_NAMES } from "./offlineTimer.js";
import {
    gameModes,
    SUPPORTED_MODES,
    getActiveModeKey,
    getActiveModeState,
    getModeState,
    setActiveModeKey,
    loadPersistedState,
    drawNextResult,
    evaluateModeBets,
    renderGameHistory,
    renderChartTrend,
    renderMyHistory
} from "./gameEngine.js";
import { showEvaluationDialog } from "./updateWin.js";
import { playTickSound } from "./audio.js";

let masterTimerId = null;

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

// ----------------- MULTI-MODE MASTER SCHEDULER -----------------

function processMasterTick() {
    const now = Date.now();
    const activeKey = getActiveModeKey();
    const bettingMark = document.querySelector(".Betting__C-mark");

    SUPPORTED_MODES.forEach(mode => {
        const state = gameModes[mode];
        if (!state) return;

        const timeLeftMs = Math.max(0, state.currentEndTimeMs - now);
        const totalSeconds = Math.floor(timeLeftMs / 1000);
        state.remainingSeconds = totalSeconds;

        const isCurrentActive = mode === activeKey;

        // 1. Check for Round Finish & Settlement
        if (timeLeftMs <= 0) {
            const finishedIssue = state.currentIssueNumber;
            const settlementKey = `${mode}:${finishedIssue}`;

            // Idempotent settlement guard
            if (!state.settledRounds.has(settlementKey)) {
                state.settledRounds.add(settlementKey);

                // Draw next result for this specific mode
                const result = drawNextResult(mode, finishedIssue);

                // Evaluate any active bets for this mode
                const evaluation = evaluateModeBets(mode, result);

                // Calculate next period data for this mode
                const nextData = generateOfflinePeriodData(mode, new Date(now));
                state.currentIssueNumber = nextData.issueNumber;
                state.currentEndTimeMs = nextData.endTimeMs;
                state.remainingSeconds = nextData.remainingSeconds;
                state.isLockoutActive = false;
                state.lastTickSecond = -1;

                // Update UI if this mode is currently active
                if (isCurrentActive) {
                    if (bettingMark) bettingMark.style.display = "none";
                    if (period_number) period_number.textContent = state.currentIssueNumber;

                    renderWinningTokensForActiveMode();
                    renderGameHistory(activeKey);
                    renderChartTrend(activeKey);
                    renderMyHistory(activeKey);

                    // Show win/loss dialog if user played in this round
                    if (evaluation && evaluation.evaluatedBets && evaluation.evaluatedBets.length > 0) {
                        showEvaluationDialog(evaluation);
                    }
                }
            }
            return;
        }

        // 2. Check for 5-Second Betting Lockout
        if (totalSeconds <= 5 && totalSeconds > 0) {
            state.isLockoutActive = true;

            if (isCurrentActive) {
                // Close betting popup on lockout
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
    if (masterTimerId) {
        clearInterval(masterTimerId);
        masterTimerId = null;
    }
    // Run tick every 250ms for responsive timekeeping without high CPU usage
    masterTimerId = setInterval(processMasterTick, 250);
}

// Switch game mode (30s, 1Min, 3Min, 5Min)
export function switchGameMode(newGameType) {
    const targetMode = normalizeMode(newGameType);
    setActiveModeKey(targetMode);

    const state = getActiveModeState();
    const bettingMark = document.querySelector(".Betting__C-mark");

    // Update Period number
    if (period_number) {
        period_number.textContent = state.currentIssueNumber;
    }

    // Update Time display
    const totalSeconds = state.remainingSeconds;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    updateTimeDisplay(minutes, seconds);

    // Update Lockout overlay state
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

    // Update header name display
    const timeLeftName = document.querySelector('.TimeLeft__C .TimeLeft__C-name');
    if (timeLeftName) {
        timeLeftName.textContent = state.displayName;
    }

    const popupHeadTitle = document.querySelector('.Betting__Popup-head-title');
    if (popupHeadTitle) {
        popupHeadTitle.textContent = state.displayName;
    }

    // Refresh UI tokens and subtabs for newly selected mode
    renderWinningTokensForActiveMode();
    renderGameHistory(targetMode);
    renderChartTrend(targetMode);
    renderMyHistory(targetMode);
}

// Initialize on page load
export function initGameRecord() {
    // 1. Load persisted multi-mode state
    loadPersistedState();

    // 2. Render initial view for default active mode (30s)
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

    // 3. Start master scheduler
    startMasterScheduler();
}
