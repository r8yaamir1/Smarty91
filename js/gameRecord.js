// gameRecord.js - Server-Authoritative Live Game Loop & Multi-Mode Orchestrator

import { period_time, period_number, tokenParent } from "./elements.js";
import { normalizeMode, generateOfflinePeriodData } from "./offlineTimer.js";
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
    fetchUserBetsFromServer,
    updateModeHistoryFromServer
} from "./gameEngine.js";
import { showEvaluationDialog } from "./updateWin.js";
import { playTickSound, stopCountdownAudio, isGameViewActive } from "./audio.js";
import { gameService } from "./services/gameService.js";
import { syncServerBalance } from "./wallet.js";
import { subscribeToGamePeriod, subscribeToGameHistory } from "./services/firebaseClient.js";

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
    const tokens = state.tokens && state.tokens.length > 0 ? state.tokens.slice(0, 5) : [];
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
                    const settlementKey = `${mode}:${prevPeriod}`;
                    if (!state.settledRounds.has(settlementKey)) {
                        state.settledRounds.add(settlementKey);
                        await handlePeriodSettledFromServer(mode, prevPeriod);
                    }
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

async function handlePeriodSettledFromServer(mode, settledPeriodId, retryCount = 0) {
    try {
        const state = gameModes[mode];
        const targetPeriod = String(settledPeriodId).trim();

        // 1. Check if the outcome for targetPeriod is already in state.history
        if (state && Array.isArray(state.history)) {
            const existingOutcome = state.history.find(
                item => String(item.period || item.periodId).trim() === targetPeriod
            );
            if (existingOutcome) {
                const evaluation = evaluateModeBets(mode, existingOutcome);
                await syncServerBalance(true);
                fetchUserBetsFromServer(mode).catch(() => {});

                if (mode === getActiveModeKey()) {
                    renderWinningTokensForActiveMode();
                    renderGameHistory(mode);
                    renderChartTrend(mode);
                    renderMyHistory(mode);

                    if (evaluation && evaluation.evaluatedBets && evaluation.evaluatedBets.length > 0) {
                        showEvaluationDialog(evaluation);
                    }
                }
                return;
            }
        }

        // 2. Fetch fresh history from server API
        const historyRes = await gameService.getGameHistory(mode, 1, 50);
        if (historyRes && historyRes.success && Array.isArray(historyRes.items) && historyRes.items.length > 0) {
            const hasTargetPeriod = historyRes.items.some(
                item => String(item.period || item.periodId).trim() === targetPeriod
            );

            if (hasTargetPeriod) {
                processSettlementForPeriod(mode, historyRes.items, targetPeriod);
                return;
            }
        }

        // 3. If server hasn't finished writing outcome yet, retry up to 4 times
        if (retryCount < 4) {
            setTimeout(() => {
                handlePeriodSettledFromServer(mode, settledPeriodId, retryCount + 1);
            }, 450);
        } else if (historyRes && historyRes.success && Array.isArray(historyRes.items)) {
            // Fallback to latest available history
            processSettlementForPeriod(mode, historyRes.items, targetPeriod);
        }
    } catch (e) {
        console.warn('History fetch error on settlement:', e);
    }
}

function processSettlementForPeriod(mode, items, targetPeriod) {
    const hasChanged = updateModeHistoryFromServer(mode, items);
    const state = gameModes[mode];
    if (!state) return;

    // Find the specific outcome for targetPeriod, or fallback to history[0]
    let resultForPeriod = null;
    if (Array.isArray(state.history) && state.history.length > 0) {
        if (targetPeriod) {
            resultForPeriod = state.history.find(
                h => String(h.period || h.periodId).trim() === String(targetPeriod).trim()
            );
        }
        if (!resultForPeriod) {
            resultForPeriod = state.history[0];
        }
    }

    if (resultForPeriod) {
        const evaluation = evaluateModeBets(mode, resultForPeriod);
        syncServerBalance(true);
        fetchUserBetsFromServer(mode).catch(() => {});

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

// Initial fetch of histories for all 4 modes
export async function initializeServerHistories() {
    for (const mode of SUPPORTED_MODES) {
        try {
            const res = await gameService.getGameHistory(mode, 1, 50);
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
    fetchUserBetsFromServer(activeMode).catch(() => {});
}

// ----------------- LOCAL SMOOTH TICK LOOP -----------------

function processMasterTick() {
    const adjustedNow = Date.now() + serverClockOffset;
    const activeKey = getActiveModeKey();
    const bettingMark = document.querySelector(".Betting__C-mark");

    SUPPORTED_MODES.forEach(mode => {
        const state = gameModes[mode];
        if (!state) return;

        const periodData = generateOfflinePeriodData(mode, new Date(adjustedNow));
        const totalSeconds = periodData.remainingSeconds;
        state.remainingSeconds = totalSeconds;
        state.currentEndTimeMs = periodData.endTimeMs;

        const isCurrentActive = mode === activeKey;

        // 1. Detect if period transitioned (Round Finished)
        if (state.currentIssueNumber && state.currentIssueNumber !== periodData.issueNumber) {
            const finishedPeriod = state.currentIssueNumber;
            state.currentIssueNumber = periodData.issueNumber;

            const settlementKey = `${mode}:${finishedPeriod}`;
            if (!state.settledRounds.has(settlementKey)) {
                state.settledRounds.add(settlementKey);
                // Asynchronously fetch latest outcome & evaluate bets with exact 1000ms (1.0s) delay for smooth outcome registration
                setTimeout(() => handlePeriodSettledFromServer(mode, finishedPeriod), 1000);
            }
        } else if (!state.currentIssueNumber) {
            state.currentIssueNumber = periodData.issueNumber;
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

                if (totalSeconds !== state.lastTickSecond && isGameViewActive()) {
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
export async function switchGameMode(newGameType) {
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

    // Render target mode components IMMEDIATELY to prevent old mode history from flashing
    renderWinningTokensForActiveMode();
    renderGameHistory(targetMode);
    renderChartTrend(targetMode);
    renderMyHistory(targetMode);

    if (window.SmartyLoader) {
        window.SmartyLoader.show(`Loading ${state.displayName}...`);
    }

    try {
        // Fetch fresh history and state for newly active mode
        const res = await gameService.getGameHistory(targetMode, 1, 50);
        if (res && res.success && res.items) {
            updateModeHistoryFromServer(targetMode, res.items);
        }
    } catch (err) {
        console.warn('Mode history sync error:', err);
    } finally {
        renderWinningTokensForActiveMode();
        renderGameHistory(targetMode);
        renderChartTrend(targetMode);
        renderMyHistory(targetMode);
        fetchUserBetsFromServer(targetMode).catch(() => {});
        if (window.SmartyLoader) {
            window.SmartyLoader.hide();
        }
    }
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

    // Initial server sync for real history and period clock
    await syncServerGameState();
    await initializeServerHistories();

    renderWinningTokensForActiveMode();
    renderGameHistory(initialMode);
    renderChartTrend(initialMode);
    renderMyHistory(initialMode);

    // Eagerly fetch and render user's bet history for active mode & pre-fetch other modes
    fetchUserBetsFromServer(initialMode).then(() => {
        renderMyHistory(initialMode);
    }).catch(() => {});

    SUPPORTED_MODES.forEach(mode => {
        if (mode !== initialMode) {
            fetchUserBetsFromServer(mode).catch(() => {});
        }
    });

    // Setup Real-time Firebase Firestore Listeners for zero-latency sync
    try {
        SUPPORTED_MODES.forEach(mode => {
            // Real-time period timer and lockout state from Firestore
            subscribeToGamePeriod(mode, (periodData) => {
                if (!periodData) return;
                const state = gameModes[mode];
                if (!state) return;
                if (periodData.currentPeriodId) state.currentIssueNumber = periodData.currentPeriodId;
                if (periodData.remainingSeconds !== undefined) state.remainingSeconds = periodData.remainingSeconds;
                if (periodData.isLocked !== undefined) state.isLockoutActive = periodData.isLocked;
                if (periodData.currentEndTimeMs) state.currentEndTimeMs = periodData.currentEndTimeMs;
                
                if (mode === getActiveModeKey() && period_number && state.currentIssueNumber) {
                    period_number.textContent = state.currentIssueNumber;
                }
            });

            // Real-time history & result settlement from Firestore
            subscribeToGameHistory(mode, (historyItems) => {
                if (Array.isArray(historyItems) && historyItems.length > 0) {
                    const hasChanged = updateModeHistoryFromServer(mode, historyItems);
                    if (hasChanged && mode === getActiveModeKey()) {
                        renderWinningTokensForActiveMode();
                        renderGameHistory(mode);
                        renderChartTrend(mode);
                        fetchUserBetsFromServer(mode).catch(() => {});
                    }
                }
            });
        });
    } catch (firebaseErr) {
        console.warn('Firebase realtime subscription setup:', firebaseErr);
    }

    // Start local and server timers
    startMasterScheduler();
}
