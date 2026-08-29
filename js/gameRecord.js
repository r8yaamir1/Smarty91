// gameRecord.js - Game Loop, Countdown Timer & Draw Orchestrator

import { period_time, period_number, tokenParent } from "./elements.js";
import { generateOfflinePeriodData } from "./offlineTimer.js";
import { drawNextResult, evaluateBets, renderGameHistory, renderChartTrend, renderMyHistory } from "./gameEngine.js";
import { showEvaluationDialog } from "./updateWin.js";
import { playTickSound } from "./audio.js";

const GAME_INTERVALS = {
    "Smarty91 30s": 30000,
    "Smarty91 1Min": 60000,
    "Smarty91 3Min": 180000,
    "Smarty91 5Min": 300000,
    "Win Go 30s": 30000,
    "Win Go 1Min": 60000,
    "Win Go 3Min": 180000,
    "Win Go 5Min": 300000
};

let currentGameType = "Smarty91 30s";
let currentIssueNumber = "";
let countdownTimerId = null;
let currentEndTimeMs = 0;
let isLockoutActive = false;
let lastTickSecond = -1;

export function getCurrentGameType() {
    return currentGameType;
}

export function getCurrentIssueNumber() {
    return currentIssueNumber;
}

export function isBettingLocked() {
    return isLockoutActive;
}

export function getRemainingSeconds() {
    if (!currentEndTimeMs) return 0;
    return Math.max(0, Math.floor((currentEndTimeMs - Date.now()) / 1000));
}

// Update top-right winning number tokens under How to play
export function updateWinningTokens(number) {
    if (!tokenParent) return;

    const newDiv = document.createElement('div');
    newDiv.setAttribute("data-v-3e4c6499", "");
    newDiv.className = `n${number}`;

    tokenParent.insertBefore(newDiv, tokenParent.firstChild);

    while (tokenParent.children.length > 5) {
        tokenParent.removeChild(tokenParent.lastElementChild);
    }
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

// Start countdown loop for the current round
export function startCountdown(endTimeMs, gameType, issueNumber) {
    if (countdownTimerId) {
        clearTimeout(countdownTimerId);
        countdownTimerId = null;
    }

    currentGameType = gameType;
    currentIssueNumber = issueNumber;
    currentEndTimeMs = endTimeMs;

    if (period_number) {
        period_number.textContent = issueNumber;
    }

    const bettingMark = document.querySelector(".Betting__C-mark");
    lastTickSecond = -1;

    const tick = () => {
        const now = Date.now();
        const timeLeftMs = Math.max(0, endTimeMs - now);
        const totalSeconds = Math.floor(timeLeftMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        updateTimeDisplay(minutes, seconds);

        // 5-second countdown lock & overlay
        if (totalSeconds <= 5 && totalSeconds > 0) {
            isLockoutActive = true;

            // Close any open betting popup to prevent late betting
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

            if (totalSeconds !== lastTickSecond) {
                playTickSound(totalSeconds);
                lastTickSecond = totalSeconds;
            }
        } else {
            isLockoutActive = false;
            if (bettingMark) {
                bettingMark.style.display = "none";
            }
        }

        // When time expires
        if (timeLeftMs <= 0) {
            if (bettingMark) bettingMark.style.display = "none";
            isLockoutActive = false;
            updateTimeDisplay(0, 0);

            // Execute draw & settle round
            onRoundFinished(issueNumber);
            return;
        }

        const nextDelay = Math.min(250, Math.max(50, (timeLeftMs % 1000) || 250));
        countdownTimerId = setTimeout(tick, nextDelay);
    };

    tick();
}

function onRoundFinished(finishedIssueNumber) {
    // 1. Draw result
    const result = drawNextResult(finishedIssueNumber);

    // 2. Update token balls
    updateWinningTokens(result.number);

    // 3. Evaluate bets and settle
    const evaluation = evaluateBets(result);

    // 4. Update table, chart, and history
    renderGameHistory();
    renderChartTrend();
    renderMyHistory();

    // 5. Show win/loss dialog if user played
    if (evaluation) {
        showEvaluationDialog(evaluation);
    }

    // 6. Start next round
    startNextRound();
}

export function startNextRound() {
    const periodData = generateOfflinePeriodData(currentGameType);
    const endTime = new Date(periodData.endTime).getTime();
    startCountdown(endTime, currentGameType, periodData.issueNumber);
}

// Switch game mode (30s, 1Min, 3Min, 5Min)
export function switchGameMode(newGameType) {
    if (countdownTimerId) {
        clearTimeout(countdownTimerId);
        countdownTimerId = null;
    }

    const bettingMark = document.querySelector(".Betting__C-mark");
    if (bettingMark) bettingMark.style.display = "none";

    const periodData = generateOfflinePeriodData(newGameType);
    const endTime = new Date(periodData.endTime).getTime();
    startCountdown(endTime, newGameType, periodData.issueNumber);
}

// Initialize on page load
export function initGameRecord() {
    // Seed initial tokens
    for (let i = 0; i < 5; i++) {
        const rand = Math.floor(Math.random() * 10);
        updateWinningTokens(rand);
    }
    startNextRound();
}
