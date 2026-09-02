// gameRecord.js - Server-Authoritative Live Game Loop & Multi-Mode Orchestrator

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
    updateModeHistoryFromServer,
    NUMBER_PROPERTIES
} from "./gameEngine.js";
import { showEvaluationDialog } from "./updateWin.js";
import { playTickSound, stopCountdownAudio, isGameViewActive, playWinChime } from "./audio.js";
import { gameService } from "./services/gameService.js";
import { syncServerBalance } from "./wallet.js";
import { subscribeToGamePeriod, subscribeToGameHistory } from "./services/firebaseClient.js";

let masterTimerId = null;
let serverSyncTimerId = null;
let userBetsSyncTimerId = null;
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
    const tokenParent = document.querySelector('.TimeLeft__C-num');
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
    const period_time = document.querySelector('.TimeLeft__C-time');
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

            // Self-Healing Client Sync & Background Sync Engine:
            // 1. Detect and instantly heal any stale pending bets older than current period ID across all modes (resolves tab focus sleep/minimize permanently)
            for (const mode of SUPPORTED_MODES) {
                const state = gameModes[mode];
                if (state && state.userBets && state.userBets.length > 0) {
                    const hasStalePendingBets = state.userBets.some(b => {
                        const isPending = b.status === 'pending' || b.status === 'PENDING';
                        return isPending && b.periodId < state.currentIssueNumber;
                    });
                    if (hasStalePendingBets) {
                        console.log(`[Self-Healing Sync] Found stale pending bet(s) in mode ${mode} older than current period ${state.currentIssueNumber}. Instantly updating...`);
                        fetchUserBetsFromServer(mode, 1).catch(() => {});
                    }
                }
            }

            // 2. Continuous silent background sync for the active mode's history, chart and balance
            const activeState = gameModes[activeKey];
            if (activeState) {
                // Fetch active mode's game history silently
                gameService.getGameHistory(activeKey, 1, 50).then(historyRes => {
                    if (historyRes && historyRes.success && Array.isArray(historyRes.items)) {
                        const hasChanged = updateModeHistoryFromServer(activeKey, historyRes.items);
                        if (hasChanged) {
                            renderGameHistory(activeKey);
                            renderChartTrend(activeKey);
                        }
                    }
                }).catch(() => {});

                // Fetch active mode's user bets silently
                fetchUserBetsFromServer(activeKey, 1).catch(() => {});

                // Fetch server wallet balance silently
                syncServerBalance(false).catch(() => {});
            }

            // Sync active view UI
            const periodEl = document.querySelector('.TimeLeft__C-id');
            if (activeState && periodEl) {
                periodEl.textContent = activeState.currentIssueNumber;
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

        // 1. Fetch official settled game history from server API
        const historyRes = await gameService.getGameHistory(mode, 1, 50);
        let foundSettledOutcome = null;

        if (historyRes && historyRes.success && Array.isArray(historyRes.items)) {
            foundSettledOutcome = historyRes.items.find(
                item => String(item.period || item.periodId).trim() === targetPeriod
            );
            if (foundSettledOutcome) {
                updateModeHistoryFromServer(mode, historyRes.items);
            }
        }

        // 2. If outcome for targetPeriod was settled and confirmed by server:
        if (foundSettledOutcome) {
            // Fetch official settled bets for user from server
            await fetchUserBetsFromServer(mode, 1);
            await syncServerBalance(true);

            // Check if user had any bet on targetPeriod
            const userSettledBets = (state.userBets || []).filter(
                b => String(b.periodId).trim() === targetPeriod
            );

            if (userSettledBets.length > 0) {
                const totalBet = userSettledBets.reduce((sum, b) => sum + (Number(b.totalAmount || b.betAmount || 0)), 0);
                const totalWon = userSettledBets.reduce((sum, b) => sum + (Number(b.winAmount || b.payoutAmount || 0)), 0);
                const isWin = totalWon > 0;

                const rawNum = foundSettledOutcome.number !== undefined && foundSettledOutcome.number !== null 
                    ? foundSettledOutcome.number 
                    : (foundSettledOutcome.winningNumber !== undefined ? foundSettledOutcome.winningNumber : 0);
                const winNum = Number(rawNum);
                const isBig = winNum >= 5;

                const summary = {
                    mode,
                    isWin,
                    totalBet,
                    totalWon,
                    netProfit: Number((totalWon - totalBet).toFixed(2)),
                    result: {
                        periodId: targetPeriod,
                        number: winNum,
                        isBig,
                        colorName: NUMBER_PROPERTIES[winNum]?.colorName || (winNum === 0 ? 'Red+Violet' : winNum === 5 ? 'Green+Violet' : [1,3,7,9].includes(winNum) ? 'Green' : 'Red')
                    },
                    lastBet: userSettledBets[0],
                    evaluatedBets: userSettledBets
                };

                if (isWin) {
                    playWinChime();
                    if (mode === getActiveModeKey()) {
                        showEvaluationDialog(summary);
                    }
                }
            }

            // Remove any pending local activeBets matching this settled period
            if (state.activeBets) {
                state.activeBets = state.activeBets.filter(b => String(b.periodId).trim() !== targetPeriod);
            }

            if (mode === getActiveModeKey()) {
                renderWinningTokensForActiveMode();
                renderGameHistory(mode);
                renderChartTrend(mode);
                renderMyHistory(mode);
            }
            return;
        }

        // 3. If server hasn't finished writing outcome yet, retry up to 5 times (total ~2.5s)
        if (retryCount < 5) {
            setTimeout(() => {
                handlePeriodSettledFromServer(mode, settledPeriodId, retryCount + 1);
            }, 500);
        } else if (historyRes && historyRes.success && Array.isArray(historyRes.items) && historyRes.items.length > 0) {
            // Fallback to latest available history
            updateModeHistoryFromServer(mode, historyRes.items);
            fetchUserBetsFromServer(mode, 1).catch(() => {});
            syncServerBalance(true).catch(() => {});
            if (mode === getActiveModeKey()) {
                renderWinningTokensForActiveMode();
                renderGameHistory(mode);
                renderChartTrend(mode);
                renderMyHistory(mode);
            }
        }
    } catch (e) {
        console.warn('handlePeriodSettledFromServer error:', e);
    }
}

function processSettlementForPeriod(mode, items, targetPeriod) {
    updateModeHistoryFromServer(mode, items);
    fetchUserBetsFromServer(mode, 1).catch(() => {});
    syncServerBalance(true).catch(() => {});

    if (mode === getActiveModeKey()) {
        renderWinningTokensForActiveMode();
        renderGameHistory(mode);
        renderChartTrend(mode);
        renderMyHistory(mode);
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

            const period_number = document.querySelector('.TimeLeft__C-id');
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

    if (userBetsSyncTimerId) clearInterval(userBetsSyncTimerId);
    // Continuous background sync of user bets every 5000ms to instantly update any pending/winning states
    userBetsSyncTimerId = setInterval(() => {
        const activeKey = getActiveModeKey();
        fetchUserBetsFromServer(activeKey).catch(() => {});
    }, 5000);
}

// Switch game mode (30s, 1Min, 3Min, 5Min)
export async function switchGameMode(newGameType) {
    const targetMode = normalizeMode(newGameType);
    setActiveModeKey(targetMode);

    stopCountdownAudio();

    const state = getActiveModeState();
    const bettingMark = document.querySelector(".Betting__C-mark");
    const period_number = document.querySelector('.TimeLeft__C-id');

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

    const periodEl = document.querySelector('.TimeLeft__C-id');
    if (periodEl) {
        periodEl.textContent = state.currentIssueNumber;
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
                
                if (mode === getActiveModeKey() && state.currentIssueNumber) {
                    const pNumEl = document.querySelector('.TimeLeft__C-id');
                    if (pNumEl) pNumEl.textContent = state.currentIssueNumber;
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

    // Recover instantly from background sleep/minimizing
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            syncServerGameState().then(() => {
                SUPPORTED_MODES.forEach(mode => {
                    fetchUserBetsFromServer(mode, 1).catch(() => {});
                });
            }).catch(() => {});
        }
    });
}
