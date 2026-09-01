// gameEngine.js - Multi-Mode Lottery Engine, Statistics, Trends & Bet Ledger

import { getBalance, formatCurrency, showToast, setBalanceLocally, addBalance, deductBalance, syncServerBalance } from './wallet.js';
import { playWinChime } from './audio.js';
import { normalizeMode, getGameInterval, generateOfflinePeriodData, calculateTotalPeriods, formatIssueNumber, MODE_DISPLAY_NAMES } from './offlineTimer.js';
import { gameService } from './services/gameService.js';

// Number property lookup
export const NUMBER_PROPERTIES = {
    0: { num: 0, color: 'violet-red', primaryColor: 'red', secondaryColor: 'violet', isBig: false, colorName: 'Red + Violet' },
    1: { num: 1, color: 'green', primaryColor: 'green', secondaryColor: null, isBig: false, colorName: 'Green' },
    2: { num: 2, color: 'red', primaryColor: 'red', secondaryColor: null, isBig: false, colorName: 'Red' },
    3: { num: 3, color: 'green', primaryColor: 'green', secondaryColor: null, isBig: false, colorName: 'Green' },
    4: { num: 4, color: 'red', primaryColor: 'red', secondaryColor: null, isBig: false, colorName: 'Red' },
    5: { num: 5, color: 'violet-green', primaryColor: 'green', secondaryColor: 'violet', isBig: true, colorName: 'Green + Violet' },
    6: { num: 6, color: 'red', primaryColor: 'red', secondaryColor: null, isBig: true, colorName: 'Red' },
    7: { num: 7, color: 'green', primaryColor: 'green', secondaryColor: null, isBig: true, colorName: 'Green' },
    8: { num: 8, color: 'red', primaryColor: 'red', secondaryColor: null, isBig: true, colorName: 'Red' },
    9: { num: 9, color: 'green', primaryColor: 'green', secondaryColor: null, isBig: true, colorName: 'Green' },
};

export const SUPPORTED_MODES = ["30s", "1m", "3m", "5m"];
const ITEMS_PER_PAGE = 10;
const STORAGE_KEY_STATE = 'smarty91_multi_game_state';

// Create independent initial state for a single mode with clean real data
function createModeState(mode) {
    const periodData = generateOfflinePeriodData(mode);

    return {
        mode,
        displayName: MODE_DISPLAY_NAMES[mode] || `Smarty91 ${mode}`,
        interval: getGameInterval(mode),
        currentIssueNumber: periodData.issueNumber,
        currentEndTimeMs: periodData.endTimeMs,
        remainingSeconds: periodData.remainingSeconds,
        isLockoutActive: false,
        lastTickSecond: -1,
        tokens: [],
        history: [], // Pure real history from server/firestore
        activeBets: [],
        userBets: [],
        historyPage: 1,
        chartPage: 1,
        myHistoryPage: 1,
        latestResult: null,
        settledRounds: new Set()
    };
}

// ----------------- MULTI-MODE STATE STORE -----------------

export const gameModes = {
    "30s": createModeState("30s"),
    "1m": createModeState("1m"),
    "3m": createModeState("3m"),
    "5m": createModeState("5m")
};

let activeModeKey = "30s";

// Load persisted state (Direct cloud / server integration - no stale local mock data)
export function loadPersistedState() {
    // Clear any legacy localStorage keys to ensure zero stale local state reliance
    try {
        localStorage.removeItem(STORAGE_KEY_STATE);
        localStorage.removeItem('smarty91_user_bets');
    } catch (err) {
        // Ignore in restricted environments
    }
}

export function saveMultiModeState() {
    // Zero localStorage reliance for game state - All persisted directly in Firebase Firestore / server
}

// ----------------- ACCESSORS -----------------

export function getActiveModeKey() {
    return activeModeKey;
}

export function getActiveModeState() {
    return gameModes[activeModeKey];
}

export function getModeState(modeInput) {
    const mode = normalizeMode(modeInput);
    return gameModes[mode] || gameModes["30s"];
}

export function setActiveModeKey(modeInput) {
    const mode = normalizeMode(modeInput);
    if (gameModes[mode]) {
        activeModeKey = mode;
    }
    return activeModeKey;
}

// ----------------- RESULT GENERATION & SETTLEMENT PER MODE -----------------

// Server-Authoritative Result Sync Handler
export function drawNextResult(modeInput, periodId) {
    // Official results are generated strictly by the server.
    // Client receives official settled outcomes via Server APIs and Firestore real-time subscriptions.
    const mode = normalizeMode(modeInput);
    return gameModes[mode] ? gameModes[mode].latestResult : null;
}

export function evaluateModeBets(modeInput, result) {
    if (!result) return null;
    const mode = normalizeMode(modeInput);
    const state = gameModes[mode];

    if (!state.activeBets || state.activeBets.length === 0) {
        return null;
    }

    const resultPeriod = String(result.periodId || result.period || '').trim();
    if (!resultPeriod) return null;

    // Filter active bets strictly matching mode and period
    const betsToEvaluate = state.activeBets.filter(b => b.mode === mode && String(b.periodId).trim() === resultPeriod);
    if (betsToEvaluate.length === 0) {
        return null;
    }

    let totalWon = 0;
    let totalBet = 0;
    let lastBetDetails = null;
    const evaluatedList = [];

    const rawNum = result.number !== undefined && result.number !== null ? result.number : (result.winningNumber !== undefined && result.winningNumber !== null ? result.winningNumber : 0);
    const winNum = Number(rawNum);
    const isBigRes = winNum >= 5;

    betsToEvaluate.forEach(bet => {
        totalBet += (Number(bet.betAmount) || 0);
        const contractAmount = Number(bet.contractAmount || (bet.betAmount * 0.98));
        let multiplier = 0;

        const sel = String(bet.selection || '').toLowerCase().trim();
        const betType = String(bet.type || '').toLowerCase().trim();

        // 1. Number Bets (0-9) -> 9x
        if (betType === 'number' || (!isNaN(parseInt(sel, 10)) && betType !== 'color' && betType !== 'size')) {
            if (parseInt(sel, 10) === winNum) multiplier = 9.0;
        } 
        // 2. Color Bets (Green, Red, Violet)
        else if (betType === 'color' || ['green', 'red', 'violet'].includes(sel)) {
            if (sel === 'green') {
                if ([1, 3, 7, 9].includes(winNum)) multiplier = 2.0; // Pure Green
                else if (winNum === 5) multiplier = 1.5; // Half Green on 5
            } else if (sel === 'red') {
                if ([2, 4, 6, 8].includes(winNum)) multiplier = 2.0; // Pure Red
                else if (winNum === 0) multiplier = 1.5; // Half Red on 0
            } else if (sel === 'violet') {
                if (winNum === 0 || winNum === 5) multiplier = 4.5; // Violet
            }
        } 
        // 3. Size Bets (Big: 5-9, Small: 0-4) -> 2x
        else if (betType === 'size' || sel === 'big' || sel === 'small' || sel === 'b' || sel === 's') {
            if ((sel === 'big' || sel === 'b') && isBigRes) multiplier = 2.0;
            else if ((sel === 'small' || sel === 's') && !isBigRes) multiplier = 2.0;
        }

        const winAmount = multiplier > 0 ? Number((contractAmount * multiplier).toFixed(2)) : 0;
        totalWon += winAmount;

        const evaluatedBet = {
            ...bet,
            mode,
            resultNumber: winNum,
            resultColor: NUMBER_PROPERTIES[winNum]?.colorName || (winNum === 0 ? 'Red+Violet' : winNum === 5 ? 'Green+Violet' : [1,3,7,9].includes(winNum) ? 'Green' : 'Red'),
            resultBig: isBigRes,
            multiplier,
            winAmount,
            status: winAmount > 0 ? 'win' : 'lose',
            evaluatedAt: Date.now()
        };

        state.userBets.unshift(evaluatedBet);
        evaluatedList.push(evaluatedBet);
        lastBetDetails = evaluatedBet;
    });

    // Remove evaluated bets from active bets
    state.activeBets = state.activeBets.filter(b => !(b.mode === mode && String(b.periodId).trim() === resultPeriod));
    saveMultiModeState();

    if (totalWon > 0) {
        playWinChime();
    }

    const evaluationSummary = {
        mode,
        isWin: totalWon > 0,
        totalBet,
        totalWon,
        netProfit: Number((totalWon - totalBet).toFixed(2)),
        result: {
            ...result,
            periodId: resultPeriod,
            number: winNum,
            isBig: isBigRes,
            colorName: NUMBER_PROPERTIES[winNum]?.colorName || (winNum === 0 ? 'Red+Violet' : winNum === 5 ? 'Green+Violet' : [1,3,7,9].includes(winNum) ? 'Green' : 'Red')
        },
        lastBet: lastBetDetails,
        evaluatedBets: evaluatedList
    };

    return evaluationSummary;
}

// Place a bet in the specified (or active) mode (Server-Authoritative)
export async function placeBet(betData) {
    const targetMode = normalizeMode(betData.mode || betData.gameType || activeModeKey);
    const modeState = gameModes[targetMode];

    const totalAmount = Number(betData.betAmount) || 0;
    if (totalAmount <= 0) return { success: false, message: 'Invalid bet amount' };

    let currentBalance = getBalance();
    
    // If client balance appears insufficient, attempt a fast live sync
    if (totalAmount > currentBalance) {
        try {
            currentBalance = await syncServerBalance(false);
        } catch (e) {}
    }

    if (totalAmount > currentBalance) {
        return { success: false, message: `Insufficient wallet balance. Available: ₹${currentBalance.toFixed(2)}, Required: ₹${totalAmount.toFixed(2)}` };
    }

    try {
        // Call server betting endpoint
        const res = await gameService.placeBet({
            mode: targetMode,
            periodId: modeState.currentIssueNumber,
            type: betData.type,
            selection: betData.selection,
            unitAmount: betData.balanceUnit || 1,
            multiplier: betData.quantity || 1,
            quantity: 1
        });

        if (!res || !res.success) {
            return { success: false, message: res ? res.message : 'Failed to place bet on server' };
        }

        // Successfully placed and debited on server! Now sync local state instantly
        const contractAmount = parseFloat((totalAmount * 0.98).toFixed(2));
        const fee = parseFloat((totalAmount * 0.02).toFixed(2));
        
        const betId = res.bet ? res.bet.id : ('BET' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100));

        const betRecord = {
            id: betId,
            mode: targetMode,
            gameType: modeState.displayName,
            periodId: res.bet ? res.bet.periodId : modeState.currentIssueNumber,
            type: betData.type,
            selection: betData.selection,
            selectionLabel: betData.selectionLabel,
            betAmount: totalAmount,
            contractAmount,
            fee,
            quantity: betData.quantity || 1,
            balanceUnit: betData.balanceUnit || 1,
            placedAt: Date.now(),
            status: 'pending'
        };

        modeState.activeBets.push(betRecord);
        if (!modeState.userBets) modeState.userBets = [];
        modeState.userBets.unshift(betRecord);
        renderMyHistory(targetMode);
        fetchUserBetsFromServer(targetMode).catch(() => {});

        if (res.newBalance !== undefined) {
            setBalanceLocally(res.newBalance);
        } else {
            syncServerBalance(false).catch(() => {});
        }

        return { success: true, bet: betRecord };
    } catch (err) {
        console.warn('Bet placement failed:', err);
        return { success: false, message: err.message || 'Server error. Please try again.' };
    }
}

// ----------------- SUBTAB RENDERING (PER ACTIVE MODE) -----------------

// 1. Render Game History Table for Active Mode
let lastRenderedTopPeriod = {};

export function renderGameHistory(modeInput = activeModeKey) {
    const mode = normalizeMode(modeInput);
    const state = gameModes[mode];
    const container = document.querySelector('.GameRecord__C-body');
    const pageDisplay = document.querySelector('.GameRecord__C-foot-page');
    const prevBtn = document.querySelector('.GameRecord__C-foot-previous');
    const nextBtn = document.querySelector('.GameRecord__C-foot-next');

    if (!container) return;

    const totalPages = Math.ceil(state.history.length / ITEMS_PER_PAGE) || 1;
    if (state.historyPage > totalPages) state.historyPage = totalPages;
    if (state.historyPage < 1) state.historyPage = 1;

    if (state.history.length === 0) {
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem 0; color: var(--text_color_L2);">
                <div style="font-size: 1.2rem; margin-bottom: 0.2rem;">🎲</div>
                <div style="font-size: 0.38rem; font-weight: bold;">Syncing Live Rounds...</div>
                <div style="font-size: 0.3rem; margin-top: 0.1rem; color: var(--text_color_L3);">${state.displayName} rounds updating in real-time</div>
            </div>
        `;
        if (pageDisplay) pageDisplay.textContent = '1/1';
        if (prevBtn) prevBtn.classList.add('disabled');
        if (nextBtn) nextBtn.classList.add('disabled');
        return;
    }

    const startIndex = (state.historyPage - 1) * ITEMS_PER_PAGE;
    const items = state.history.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const topItem = items[0];
    const topPeriodId = topItem ? topItem.periodId : '';
    const isNewTopPeriod = lastRenderedTopPeriod[mode] !== topPeriodId;
    lastRenderedTopPeriod[mode] = topPeriodId;

    container.innerHTML = '';

    items.forEach((item, index) => {
        const row = document.createElement('div');
        const applyAnim = (index === 0 && state.historyPage === 1 && isNewTopPeriod);
        row.className = `van-row ${applyAnim ? 'fifo-new-item' : ''}`;
        row.setAttribute('data-v-481307ec', '');

        let numClass = 'greenColor';
        if (item.number === 0) numClass = 'mixedColor0';
        else if (item.number === 5) numClass = 'mixedColor5';
        else if ([2, 4, 6, 8].includes(item.number)) numClass = 'defaultColor';

        let colorBadges = '';
        if (item.secondaryColor) {
            colorBadges = `
                <div class="GameRecord__C-origin-I ${item.primaryColor}" data-v-481307ec></div>
                <div class="GameRecord__C-origin-I ${item.secondaryColor}" data-v-481307ec></div>
            `;
        } else {
            colorBadges = `
                <div class="GameRecord__C-origin-I ${item.primaryColor}" data-v-481307ec></div>
            `;
        }

        row.innerHTML = `
            <div class="van-col van-col--9" data-v-481307ec>
                ${item.periodId}
            </div>
            <div class="van-col van-col--5 numcenter" data-v-481307ec>
                <div class="GameRecord__C-body-num ${numClass}" data-v-481307ec>
                    ${item.number}
                </div>
            </div>
            <div class="van-col van-col--5" data-v-481307ec>
                <span data-v-481307ec>${item.isBig ? 'Big' : 'Small'}</span>
            </div>
            <div class="van-col van-col--5" data-v-481307ec>
                <div class="GameRecord__C-origin" data-v-481307ec>
                    ${colorBadges}
                </div>
            </div>
        `;
        container.appendChild(row);
    });

    if (pageDisplay) pageDisplay.textContent = `${state.historyPage}/${totalPages}`;
    if (prevBtn) prevBtn.classList.toggle('disabled', state.historyPage <= 1);
    if (nextBtn) nextBtn.classList.toggle('disabled', state.historyPage >= totalPages);
}

// 2. Render Chart Trend View for Active Mode
export function renderChartTrend(modeInput = activeModeKey) {
    const mode = normalizeMode(modeInput);
    const state = gameModes[mode];
    const chartView = document.getElementById('chart-view');
    if (!chartView) return;

    if (!state.history || state.history.length === 0) {
        chartView.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 0; color: var(--text_color_L2);">
                <div style="font-size: 1.2rem; margin-bottom: 0.2rem;">📈</div>
                <div style="font-size: 0.38rem; font-weight: bold;">No Trend Data Yet</div>
                <div style="font-size: 0.3rem; margin-top: 0.1rem; color: var(--text_color_L3);">${state.displayName} chart trends will appear after rounds complete</div>
            </div>
        `;
        return;
    }

    // Calculate statistics for digits 0-9 strictly for this mode
    const stats = Array.from({ length: 10 }, (_, i) => ({
        num: i,
        count: 0,
        missing: 0,
        avgMissing: 0,
        maxStreak: 0,
        currentStreak: 0
    }));

    let foundFirst = Array(10).fill(false);
    state.history.forEach((item, idx) => {
        stats[item.number].count++;
        if (!foundFirst[item.number]) {
            stats[item.number].missing = idx;
            foundFirst[item.number] = true;
        }
    });

    for (let n = 0; n < 10; n++) {
        stats[n].avgMissing = stats[n].count > 0 ? Math.round(state.history.length / stats[n].count) : state.history.length;
        let cur = 0;
        let max = 0;
        for (let k = 0; k < state.history.length; k++) {
            if (state.history[k].number === n) {
                cur++;
                if (cur > max) max = cur;
            } else {
                cur = 0;
            }
        }
        stats[n].maxStreak = max > 0 ? max : (stats[n].count > 0 ? 1 : 0);
    }

    const totalPages = Math.ceil(state.history.length / ITEMS_PER_PAGE) || 1;
    if (state.chartPage > totalPages) state.chartPage = totalPages;
    if (state.chartPage < 1) state.chartPage = 1;

    const startIndex = (state.chartPage - 1) * ITEMS_PER_PAGE;
    const items = state.history.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    let rowsHtml = '';
    items.forEach(item => {
        let cellsHtml = '';
        for (let n = 0; n < 10; n++) {
            const isMatch = item.number === n;
            cellsHtml += `
                <div class="Trend__C-body2-Num-item ${isMatch ? 'action' : ''}" data-v-9d93d892="">
                    ${n}
                </div>
            `;
        }
        rowsHtml += `
            <div class="van-row" data-v-9d93d892="" style="display: flex; align-items: center; justify-content: space-between; height: 1.33333rem; padding: .45333rem .13333rem; border-top: .01333rem solid var(--gray-color-1);">
                <div class="van-col van-col--8 Trend__C-body2-IssueNumber" data-v-9d93d892="">
                    ${item.periodId}
                </div>
                <div class="van-col van-col--16 Trend__C-body2-Num" data-v-9d93d892="">
                    ${cellsHtml}
                    <div class="Trend__C-body2-Num-BS ${item.isBig ? 'isB' : ''}" data-v-9d93d892="">${item.isBig ? 'B' : 'S'}</div>
                    <div class="Trend__C-body2-Num-OE ${item.number % 2 === 0 ? 'isE' : ''}" data-v-9d93d892="">${item.number % 2 === 0 ? 'E' : 'O'}</div>
                </div>
            </div>
        `;
    });

    chartView.innerHTML = `
        <div class="Trend__C" data-v-9d93d892="">
            <div class="Trend__C-head van-row" data-v-9d93d892="" style="display: flex; align-items: center; justify-content: space-between; padding: 0 .26667rem;">
                <div class="van-col van-col--8" data-v-9d93d892="" style="text-align: left;">Period</div>
                <div class="van-col van-col--16" data-v-9d93d892="" style="text-align: center;">Number</div>
            </div>
            <div class="Trend__C-body1" data-v-9d93d892="">
                <div class="Trend__C-body1-line lottery" data-v-9d93d892="">
                    <div data-v-9d93d892="">Winning number</div>
                    <div class="Trend__C-body1-line-num" data-v-9d93d892="">
                        ${Array.from({ length: 10 }, (_, i) => `<div data-v-9d93d892="">${i}</div>`).join('')}
                    </div>
                </div>
                <div class="Trend__C-body1-line" data-v-9d93d892="">
                    <div data-v-9d93d892="">Missing</div>
                    <div class="Trend__C-body1-line-num" data-v-9d93d892="">
                        ${stats.map(s => `<div data-v-9d93d892="">${s.missing}</div>`).join('')}
                    </div>
                </div>
                <div class="Trend__C-body1-line" data-v-9d93d892="">
                    <div data-v-9d93d892="">Avg missing</div>
                    <div class="Trend__C-body1-line-num" data-v-9d93d892="">
                        ${stats.map(s => `<div data-v-9d93d892="">${s.avgMissing}</div>`).join('')}
                    </div>
                </div>
                <div class="Trend__C-body1-line" data-v-9d93d892="">
                    <div data-v-9d93d892="">Frequency</div>
                    <div class="Trend__C-body1-line-num" data-v-9d93d892="">
                        ${stats.map(s => `<div data-v-9d93d892="">${s.count}</div>`).join('')}
                    </div>
                </div>
                <div class="Trend__C-body1-line" data-v-9d93d892="">
                    <div data-v-9d93d892="">Max consecutive</div>
                    <div class="Trend__C-body1-line-num" data-v-9d93d892="">
                        ${stats.map(s => `<div data-v-9d93d892="">${s.maxStreak}</div>`).join('')}
                    </div>
                </div>
            </div>
            <div class="Trend__C-body2" data-v-9d93d892="">
                ${rowsHtml}
            </div>
            <div class="Trend__C-foot GameRecord__C-foot" data-v-9d93d892="">
                <div class="Trend__C-foot-previous GameRecord__C-foot-previous ${state.chartPage <= 1 ? 'disabled' : ''}" data-v-9d93d892="" title="Previous Page">
                    <i class="van-badge__wrapper van-icon van-icon-arrow-left GameRecord__C-icon" data-v-9d93d892=""></i>
                </div>
                <div class="Trend__C-foot-page GameRecord__C-foot-page" data-v-9d93d892="">${state.chartPage}/${totalPages}</div>
                <div class="Trend__C-foot-next GameRecord__C-foot-next ${state.chartPage >= totalPages ? 'disabled' : ''}" data-v-9d93d892="" title="Next Page">
                    <i class="van-badge__wrapper van-icon van-icon-arrow GameRecord__C-icon" data-v-9d93d892=""></i>
                </div>
            </div>
        </div>
    `;

    // Bind pagination for Chart Trend
    const prevBtn = chartView.querySelector('.Trend__C-foot-previous');
    const nextBtn = chartView.querySelector('.Trend__C-foot-next');
    if (prevBtn) {
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            if (state.chartPage > 1) {
                state.chartPage--;
                renderChartTrend();
            }
        };
    }
    if (nextBtn) {
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            if (state.chartPage < totalPages) {
                state.chartPage++;
                renderChartTrend();
            }
        };
    }
}

// 3. Fetch My Bet History from Server/Firestore
export async function fetchUserBetsFromServer(modeInput = activeModeKey, page = 1) {
    const mode = normalizeMode(modeInput);
    const state = gameModes[mode];
    if (!state) return;

    try {
        const token = localStorage.getItem('smarty91_auth_token');
        if (!token) {
            state.userBets = [];
            renderMyHistory(mode);
            return;
        }

        const res = await gameService.getMyBetHistory(mode, page, 50);
        if (res && res.success && Array.isArray(res.items)) {
            state.userBets = res.items.map(b => {
                const isWon = b.status === 'WON' || b.status === 'win' || (Number(b.payoutAmount || b.winAmount || 0) > 0);
                const isPending = b.status === 'PENDING' || b.status === 'pending';
                const isLost = b.status === 'LOST' || b.status === 'lost' || (!isWon && !isPending);
                const betAmt = Number(b.totalAmount !== undefined ? b.totalAmount : (b.betAmount || 0));
                const winAmt = Number(b.payoutAmount !== undefined ? b.payoutAmount : (b.winAmount || 0));
                const contractAmt = Number(b.contractAmount !== undefined ? b.contractAmount : (betAmt * 0.98));
                const feeAmt = Number(b.fee !== undefined ? b.fee : (b.serviceFee !== undefined ? b.serviceFee : (betAmt * 0.02)));

                const resNum = b.resultNumber !== undefined && b.resultNumber !== null ? b.resultNumber : (b.winningNumber !== undefined && b.winningNumber !== null ? b.winningNumber : undefined);

                return {
                    id: b.id,
                    mode: b.mode || mode,
                    periodId: b.periodId,
                    type: b.type,
                    selection: b.selection,
                    selectionLabel: b.selectionLabel || b.selection,
                    betAmount: betAmt,
                    totalAmount: betAmt,
                    contractAmount: contractAmt,
                    fee: feeAmt,
                    winAmount: winAmt,
                    payoutAmount: winAmt,
                    status: isWon ? 'win' : (isPending ? 'pending' : 'lose'),
                    resultNumber: resNum,
                    resultColor: b.resultColor,
                    resultSize: b.resultSize,
                    placedAt: b.placedAt || Date.now(),
                    settledAt: b.settledAt
                };
            });
            state.myHistoryPage = page;
            renderMyHistory(mode);
        }
    } catch (e) {
        console.warn('[GameEngine] fetchUserBetsFromServer note:', e.message);
        renderMyHistory(mode);
    }
}

// 3. Render My History (User Bets for Active Mode)
export function renderMyHistory(modeInput = activeModeKey) {
    const mode = normalizeMode(modeInput);
    const state = gameModes[mode];
    const myHistoryView = document.getElementById('my-history-view');
    if (!myHistoryView) return;

    if (!state.userBets || state.userBets.length === 0) {
        myHistoryView.innerHTML = `
            <div class="MyGameRecordList__C" data-v-8bb41fd5="">
                <div class="MyGameRecordList__C-empty" data-v-8bb41fd5="" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem 0; color: var(--text_color_L2);">
                    <div style="font-size: 1.2rem; margin-bottom: 0.2rem;">📜</div>
                    <div style="font-size: 0.38rem; font-weight: bold;">No Betting Records Yet</div>
                    <div style="font-size: 0.3rem; margin-top: 0.1rem; color: var(--text_color_L3);">Place your prediction on ${state.displayName}!</div>
                </div>
            </div>
        `;
        return;
    }

    const totalPages = Math.ceil(state.userBets.length / ITEMS_PER_PAGE) || 1;
    if (state.myHistoryPage > totalPages) state.myHistoryPage = totalPages;
    if (state.myHistoryPage < 1) state.myHistoryPage = 1;

    const startIndex = (state.myHistoryPage - 1) * ITEMS_PER_PAGE;
    const items = state.userBets.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    let cardsHtml = '';
    items.forEach((bet) => {
        const isWin = bet.status === 'win' || bet.status === 'WON' || (Number(bet.winAmount || bet.payoutAmount || 0) > 0);
        const isPending = bet.status === 'pending' || bet.status === 'PENDING';
        const isNumber = bet.type === 'number' || (!isNaN(Number(bet.selection)) && bet.type !== 'color' && bet.type !== 'size');
        const betAmt = Number(bet.betAmount !== undefined ? bet.betAmount : (bet.totalAmount || 0));
        const winAmt = Number(bet.winAmount !== undefined ? bet.winAmount : (bet.payoutAmount || 0));
        const contractAmt = Number(bet.contractAmount !== undefined ? bet.contractAmount : (betAmt * 0.98));
        const feeAmt = Number(bet.fee !== undefined ? bet.fee : (betAmt * 0.02));

        let badgeClass = '';
        let badgeText = '';

        if (isNumber) {
            badgeClass = `MyGameRecordList__C-item-l-${bet.selection}`;
            badgeText = `${bet.selection}`;
        } else if (bet.selection === 'red' || bet.selection === 'green' || bet.selection === 'violet') {
            badgeClass = `MyGameRecordList__C-item-l-${bet.selection}`;
            badgeText = bet.selection.charAt(0).toUpperCase() + bet.selection.slice(1);
        } else if (bet.selection === 'big' || bet.selection === 'Big') {
            badgeClass = `MyGameRecordList__C-item-l-big`;
            badgeText = 'Big';
        } else if (bet.selection === 'small' || bet.selection === 'Small') {
            badgeClass = `MyGameRecordList__C-item-l-small`;
            badgeText = 'Small';
        } else {
            badgeClass = `MyGameRecordList__C-item-l-red`;
            badgeText = `${bet.selectionLabel || bet.selection}`;
        }

        const dateObj = new Date(bet.placedAt || Date.now());
        const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}:${String(dateObj.getSeconds()).padStart(2, '0')}`;

        cardsHtml += `
            <div class="MyGameRecordList__C-item-wrapper" data-v-8bb41fd5="" style="background: var(--darkBg, var(--bg_color_L2)); border-radius: .13333rem; margin-bottom: .26667rem; padding: 0 .26667rem;">
                <div class="MyGameRecordList__C-item" data-v-8bb41fd5="" style="cursor: pointer;">
                    <div class="MyGameRecordList__C-item-l ${badgeClass}" data-v-8bb41fd5="">${badgeText}</div>
                    <div class="MyGameRecordList__C-item-m" data-v-8bb41fd5="">
                        <div class="MyGameRecordList__C-item-m-top" data-v-8bb41fd5="">${bet.periodId}</div>
                        <div class="MyGameRecordList__C-item-m-bottom" data-v-8bb41fd5="">${dateStr}</div>
                    </div>
                    <div class="MyGameRecordList__C-item-r ${isWin ? 'success' : (isPending ? 'pending' : '')}" data-v-8bb41fd5="">
                        <div data-v-8bb41fd5="">${isWin ? 'Succeed' : (isPending ? 'Pending' : 'Failed')}</div>
                        <span data-v-8bb41fd5="">${isWin ? '+₹' + winAmt.toFixed(2) : (isPending ? '₹' + betAmt.toFixed(2) : '-₹' + betAmt.toFixed(2))}</span>
                    </div>
                </div>
                <div class="MyGameRecordList__C-detail" data-v-8bb41fd5="" style="display: none;">
                    <div class="MyGameRecordList__C-detail-text" data-v-8bb41fd5="">Detail</div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Order number</span>
                        <span data-v-8bb41fd5="">${bet.id}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Period</span>
                        <span data-v-8bb41fd5="">${bet.periodId}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Purchase amount</span>
                        <span data-v-8bb41fd5="">₹${betAmt.toFixed(2)}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Amount after tax</span>
                        <span data-v-8bb41fd5="">₹${contractAmt.toFixed(2)}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Tax</span>
                        <span data-v-8bb41fd5="">₹${feeAmt.toFixed(2)}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Result</span>
                        <span data-v-8bb41fd5="">${bet.resultNumber !== undefined ? `${bet.resultNumber} (${bet.resultNumber >= 5 ? 'Big' : 'Small'})` : 'Pending'}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Select</span>
                        <span data-v-8bb41fd5="">${bet.selectionLabel || bet.selection}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Status</span>
                        <span data-v-8bb41fd5="" class="${isWin ? 'green' : (isPending ? 'pending' : 'red')}" style="color: ${isWin ? 'var(--norm_green-color)' : (isPending ? 'var(--text_color_L2)' : 'var(--norm_red-color)')}; font-weight: bold;">${isWin ? 'Succeed' : (isPending ? 'Pending' : 'Failed')}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Win/Loss</span>
                        <span data-v-8bb41fd5="" class="${isWin ? 'green' : (isPending ? 'pending' : 'red')}" style="color: ${isWin ? 'var(--norm_green-color)' : (isPending ? 'var(--text_color_L2)' : 'var(--norm_red-color)')}; font-weight: bold;">${isWin ? '+₹' + winAmt.toFixed(2) : (isPending ? 'Pending' : '-₹' + betAmt.toFixed(2))}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Order time</span>
                        <span data-v-8bb41fd5="">${dateStr}</span>
                    </div>
                </div>
            </div>
        `;
    });

    myHistoryView.innerHTML = `
        <div class="MyGameRecordList__C" data-v-8bb41fd5="">
            ${cardsHtml}
            <div class="Trend__C-foot GameRecord__C-foot" data-v-8bb41fd5="" style="margin-top: .32rem;">
                <div class="Trend__C-foot-previous GameRecord__C-foot-previous ${state.myHistoryPage <= 1 ? 'disabled' : ''}" data-v-8bb41fd5="" title="Previous Page">
                    <i class="van-badge__wrapper van-icon van-icon-arrow-left GameRecord__C-icon" data-v-8bb41fd5=""></i>
                </div>
                <div class="Trend__C-foot-page GameRecord__C-foot-page" data-v-8bb41fd5="">${state.myHistoryPage}/${totalPages}</div>
                <div class="Trend__C-foot-next GameRecord__C-foot-next ${state.myHistoryPage >= totalPages ? 'disabled' : ''}" data-v-8bb41fd5="" title="Next Page">
                    <i class="van-badge__wrapper van-icon van-icon-arrow GameRecord__C-icon" data-v-8bb41fd5=""></i>
                </div>
            </div>
        </div>
    `;

    // Accordion toggle click handlers
    const recordWrappers = myHistoryView.querySelectorAll('.MyGameRecordList__C-item-wrapper');
    recordWrappers.forEach(wrapper => {
        const itemHeader = wrapper.querySelector('.MyGameRecordList__C-item');
        const detailSection = wrapper.querySelector('.MyGameRecordList__C-detail');
        if (itemHeader && detailSection) {
            itemHeader.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCurrentlyOpen = detailSection.style.display === 'block';
                recordWrappers.forEach(w => {
                    const d = w.querySelector('.MyGameRecordList__C-detail');
                    if (d) d.style.display = 'none';
                });
                if (!isCurrentlyOpen) {
                    detailSection.style.display = 'block';
                }
            });
        }
    });

    // Bind pagination for My History
    const prevBtn = myHistoryView.querySelector('.Trend__C-foot-previous');
    const nextBtn = myHistoryView.querySelector('.Trend__C-foot-next');
    if (prevBtn) {
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            if (state.myHistoryPage > 1) {
                state.myHistoryPage--;
                renderMyHistory();
            }
        };
    }
    if (nextBtn) {
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            if (state.myHistoryPage < totalPages) {
                state.myHistoryPage++;
                renderMyHistory();
            }
        };
    }
}

// Subtab switching logic
export function initSubtabs() {
    const tabHeaders = document.querySelectorAll('.RecordNav__C > div');
    const gameHistoryView = document.querySelector('.GameRecord__C.game-record');
    const chartView = document.getElementById('chart-view');
    const myHistoryView = document.getElementById('my-history-view');

    tabHeaders.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            tabHeaders.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            if (gameHistoryView) gameHistoryView.style.display = index === 0 ? '' : 'none';
            if (chartView) chartView.style.display = index === 1 ? 'block' : 'none';
            if (myHistoryView) myHistoryView.style.display = index === 2 ? 'block' : 'none';

            if (index === 0) renderGameHistory();
            else if (index === 1) renderChartTrend();
            else if (index === 2) {
                renderMyHistory();
                fetchUserBetsFromServer(getActiveModeKey());
            }
        });
    });

    // Pagination buttons for Game History
    const prevBtn = document.querySelector('.GameRecord__C-foot-previous');
    const nextBtn = document.querySelector('.GameRecord__C-foot-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            const state = getActiveModeState();
            if (state.historyPage > 1) {
                state.historyPage--;
                renderGameHistory();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const state = getActiveModeState();
            const totalPages = Math.ceil(state.history.length / ITEMS_PER_PAGE);
            if (state.historyPage < totalPages) {
                state.historyPage++;
                renderGameHistory();
            }
        });
    }

    renderGameHistory();
}

export function updateModeHistoryFromServer(modeInput, serverHistoryItems) {
    const mode = normalizeMode(modeInput);
    const state = gameModes[mode];
    if (!state || !Array.isArray(serverHistoryItems)) return false;

    const parseTime = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        const t = new Date(val).getTime();
        return isNaN(t) ? 0 : t;
    };

    const formatted = serverHistoryItems
        .filter(item => {
            if (!item) return false;
            // Exclude pending/unsettled items with no valid outcome number to prevent millisecond "0" flicker
            const rawNum = item.number !== undefined && item.number !== null ? item.number : (item.winningNumber !== undefined && item.winningNumber !== null ? item.winningNumber : null);
            if (rawNum === null || rawNum === undefined || rawNum === '' || rawNum === 'null' || rawNum === 'undefined') return false;
            
            const num = Number(rawNum);
            if (isNaN(num) || !isFinite(num) || num < 0 || num > 9) return false;
            
            if (item.status && (item.status === 'PENDING' || item.status === 'pending')) return false;
            return true;
        })
        .map(item => {
            const rawNum = item.number !== undefined && item.number !== null ? item.number : item.winningNumber;
            const num = Number(rawNum);
            const prop = NUMBER_PROPERTIES[num] || NUMBER_PROPERTIES[0];
            const rawTime = item.timestamp || item.settledAt;
            const periodIdStr = String(item.period || item.periodId || '');
            const isBig = num >= 5 || item.size === 'big' || item.isBig === true || prop.isBig === true;
            return {
                mode,
                periodId: periodIdStr,
                number: num,
                isBig,
                primaryColor: prop.primaryColor,
                secondaryColor: prop.secondaryColor,
                colorName: prop.colorName,
                timestamp: parseTime(rawTime)
            };
        })
        .filter(item => item.periodId !== '');

    // Deduplicate history items by unique periodId
    const uniqueMap = new Map();
    formatted.forEach(item => {
        if (!uniqueMap.has(item.periodId)) {
            uniqueMap.set(item.periodId, item);
        } else {
            const existing = uniqueMap.get(item.periodId);
            if (item.timestamp && item.timestamp > (existing.timestamp || 0)) {
                uniqueMap.set(item.periodId, item);
            }
        }
    });

    const deduplicated = Array.from(uniqueMap.values());

    deduplicated.sort((a, b) => {
        if (a.periodId !== b.periodId) {
            return b.periodId.localeCompare(a.periodId, undefined, { numeric: true });
        }
        return b.timestamp - a.timestamp;
    });

    const newSlice = deduplicated.slice(0, 50);
    if (newSlice.length === 0) {
        if (state.history.length > 0) {
            state.history = [];
            state.tokens = [];
            state.latestResult = null;
            saveMultiModeState();
            return true;
        }
        return false;
    }

    // Compare new slice with current state.history to check if anything actually changed
    let hasChanged = false;
    if (state.history.length !== newSlice.length) {
        hasChanged = true;
    } else {
        for (let i = 0; i < state.history.length; i++) {
            if (state.history[i].periodId !== newSlice[i].periodId || state.history[i].number !== newSlice[i].number) {
                hasChanged = true;
                break;
            }
        }
    }

    if (hasChanged) {
        state.history = newSlice;
        state.latestResult = newSlice[0];
        state.tokens = newSlice.slice(0, 5).map(h => h.number);
        saveMultiModeState();
        return true;
    }

    return false;
}
