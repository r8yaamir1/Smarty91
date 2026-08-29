// gameEngine.js - Multi-Mode Lottery Engine, Statistics, Trends & Bet Ledger

import { getBalance, addBalance, deductBalance, formatCurrency, showToast } from './wallet.js';
import { playWinChime } from './audio.js';
import { normalizeMode, getGameInterval, generateOfflinePeriodData, calculateTotalPeriods, formatIssueNumber, MODE_DISPLAY_NAMES } from './offlineTimer.js';

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

// Generate realistic deterministic seed history for a given mode
function generateModeSeedHistory(mode, count = 50) {
    const history = [];
    const interval = getGameInterval(mode);
    const now = Date.now();

    for (let i = 0; i < count; i++) {
        const itemTime = new Date(now - ((i + 1) * interval));
        const totalPeriods = calculateTotalPeriods(itemTime, interval);
        const periodId = formatIssueNumber(itemTime, totalPeriods);
        const num = Math.floor(Math.random() * 10);
        const prop = NUMBER_PROPERTIES[num];

        history.push({
            mode,
            periodId,
            number: num,
            isBig: prop.isBig,
            primaryColor: prop.primaryColor,
            secondaryColor: prop.secondaryColor,
            colorName: prop.colorName,
            timestamp: itemTime.getTime()
        });
    }
    return history;
}

// Create independent initial state for a single mode
function createModeState(mode) {
    const periodData = generateOfflinePeriodData(mode);
    const seedHistory = generateModeSeedHistory(mode, 50);
    const initialTokens = seedHistory.slice(0, 5).map(h => h.number);

    return {
        mode,
        displayName: MODE_DISPLAY_NAMES[mode] || `Smarty91 ${mode}`,
        interval: getGameInterval(mode),
        currentIssueNumber: periodData.issueNumber,
        currentEndTimeMs: periodData.endTimeMs,
        remainingSeconds: periodData.remainingSeconds,
        isLockoutActive: false,
        lastTickSecond: -1,
        tokens: initialTokens.length === 5 ? initialTokens : [1, 5, 8, 3, 0],
        history: seedHistory,
        activeBets: [],
        userBets: [],
        historyPage: 1,
        chartPage: 1,
        myHistoryPage: 1,
        latestResult: seedHistory[0] || null,
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

// Load persisted state and migrate legacy single-mode storage safely
export function loadPersistedState() {
    try {
        const storedMulti = localStorage.getItem(STORAGE_KEY_STATE);
        if (storedMulti) {
            const parsed = JSON.parse(storedMulti);
            SUPPORTED_MODES.forEach(mode => {
                if (parsed[mode]) {
                    if (Array.isArray(parsed[mode].history) && parsed[mode].history.length > 0) {
                        gameModes[mode].history = parsed[mode].history;
                        gameModes[mode].latestResult = parsed[mode].history[0] || null;
                    }
                    if (Array.isArray(parsed[mode].userBets)) {
                        gameModes[mode].userBets = parsed[mode].userBets;
                    }
                    if (Array.isArray(parsed[mode].tokens) && parsed[mode].tokens.length > 0) {
                        gameModes[mode].tokens = parsed[mode].tokens.slice(0, 5);
                    }
                }
            });
        }

        // Migrate legacy single-mode bets from smarty91_user_bets if present
        const legacyBetsRaw = localStorage.getItem('smarty91_user_bets');
        if (legacyBetsRaw) {
            const legacyBets = JSON.parse(legacyBetsRaw);
            if (Array.isArray(legacyBets) && legacyBets.length > 0) {
                legacyBets.forEach(bet => {
                    const mode = normalizeMode(bet.mode || bet.gameType || "30s");
                    if (gameModes[mode] && !gameModes[mode].userBets.some(b => b.id === bet.id)) {
                        gameModes[mode].userBets.push({
                            ...bet,
                            mode
                        });
                    }
                });
                // Remove legacy flat key after successful migration to prevent duplicate confusion
                localStorage.removeItem('smarty91_user_bets');
                saveMultiModeState();
            }
        }
    } catch (err) {
        console.warn('Could not load stored game state, using defaults', err);
    }
}

export function saveMultiModeState() {
    try {
        const serializeData = {};
        SUPPORTED_MODES.forEach(mode => {
            serializeData[mode] = {
                history: gameModes[mode].history.slice(0, 100),
                userBets: gameModes[mode].userBets.slice(0, 100),
                tokens: gameModes[mode].tokens.slice(0, 5)
            };
        });
        localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(serializeData));
    } catch (err) {
        console.warn('Could not save multi mode state to localStorage', err);
    }
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

export function drawNextResult(modeInput, periodId) {
    const mode = normalizeMode(modeInput);
    const state = gameModes[mode];
    const num = Math.floor(Math.random() * 10);
    const prop = NUMBER_PROPERTIES[num];

    const result = {
        mode,
        periodId,
        number: num,
        isBig: prop.isBig,
        primaryColor: prop.primaryColor,
        secondaryColor: prop.secondaryColor,
        colorName: prop.colorName,
        timestamp: Date.now()
    };

    // Prepend exclusively to this mode's history
    state.history.unshift(result);
    if (state.history.length > 200) state.history.pop();
    state.latestResult = result;

    // Update this mode's winning tokens
    state.tokens.unshift(num);
    if (state.tokens.length > 5) state.tokens.pop();

    saveMultiModeState();
    return result;
}

export function evaluateModeBets(modeInput, result) {
    const mode = normalizeMode(modeInput);
    const state = gameModes[mode];

    if (!state.activeBets || state.activeBets.length === 0) {
        return null;
    }

    // Filter active bets matching mode and period
    const betsToEvaluate = state.activeBets.filter(b => b.mode === mode && b.periodId === result.periodId);
    if (betsToEvaluate.length === 0) {
        return null;
    }

    let totalWon = 0;
    let totalBet = 0;
    let lastBetDetails = null;
    const evaluatedList = [];

    betsToEvaluate.forEach(bet => {
        totalBet += bet.betAmount;
        const contractAmount = bet.contractAmount; // betAmount * 0.98
        let multiplier = 0;

        if (bet.type === 'number') {
            if (parseInt(bet.selection, 10) === result.number) {
                multiplier = 9;
            }
        } else if (bet.type === 'color') {
            if (bet.selection === 'green') {
                if ([1, 3, 7, 9].includes(result.number)) multiplier = 2;
                else if (result.number === 5) multiplier = 1.5;
            } else if (bet.selection === 'red') {
                if ([2, 4, 6, 8].includes(result.number)) multiplier = 2;
                else if (result.number === 0) multiplier = 1.5;
            } else if (bet.selection === 'violet') {
                if ([0, 5].includes(result.number)) multiplier = 4.5;
            }
        } else if (bet.type === 'size') {
            if (bet.selection === 'big' && result.isBig) multiplier = 2;
            else if (bet.selection === 'small' && !result.isBig) multiplier = 2;
        }

        const winAmount = multiplier > 0 ? (contractAmount * multiplier) : 0;
        totalWon += winAmount;

        const evaluatedBet = {
            ...bet,
            mode,
            resultNumber: result.number,
            resultColor: result.colorName,
            resultBig: result.isBig,
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
    state.activeBets = state.activeBets.filter(b => !(b.mode === mode && b.periodId === result.periodId));
    saveMultiModeState();

    if (totalWon > 0) {
        addBalance(totalWon);
        playWinChime();
    }

    const evaluationSummary = {
        mode,
        isWin: totalWon > 0,
        totalBet,
        totalWon,
        netProfit: totalWon - totalBet,
        result,
        lastBet: lastBetDetails,
        evaluatedBets: evaluatedList
    };

    return evaluationSummary;
}

// Place a bet in the specified (or active) mode
export function placeBet(betData) {
    const targetMode = normalizeMode(betData.mode || betData.gameType || activeModeKey);
    const modeState = gameModes[targetMode];

    const totalAmount = betData.betAmount;
    if (totalAmount <= 0) return { success: false, message: 'Invalid bet amount' };

    const currentBalance = getBalance();
    if (totalAmount > currentBalance) {
        return { success: false, message: 'Insufficient balance' };
    }

    const success = deductBalance(totalAmount);
    if (!success) {
        return { success: false, message: 'Transaction failed' };
    }

    const contractAmount = parseFloat((totalAmount * 0.98).toFixed(2));
    const fee = parseFloat((totalAmount * 0.02).toFixed(2));

    const betRecord = {
        id: 'BET' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100),
        mode: targetMode,
        gameType: modeState.displayName,
        periodId: modeState.currentIssueNumber,
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
    return { success: true, bet: betRecord };
}

// ----------------- SUBTAB RENDERING (PER ACTIVE MODE) -----------------

// 1. Render Game History Table for Active Mode
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

    const startIndex = (state.historyPage - 1) * ITEMS_PER_PAGE;
    const items = state.history.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    container.innerHTML = '';

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'van-row';
        row.setAttribute('data-v-481307ec', '');

        let numClass = 'greenColor';
        if (item.number === 0) numClass = 'defaultColor';
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
            <div class="Trend__C-foot" data-v-9d93d892="">
                <div class="Trend__C-foot-previous ${state.chartPage <= 1 ? 'disabled' : ''}" data-v-9d93d892="">
                    <svg class="Trend__C-icon svg-icon" style="width: 0.4rem; height: 0.4rem;"><use xlink:href="#icon-left"></use></svg>
                </div>
                <div class="Trend__C-foot-page" data-v-9d93d892="">${state.chartPage}/${totalPages}</div>
                <div class="Trend__C-foot-next ${state.chartPage >= totalPages ? 'disabled' : ''}" data-v-9d93d892="">
                    <svg class="Trend__C-icon svg-icon" style="width: 0.4rem; height: 0.4rem;"><use xlink:href="#icon-right"></use></svg>
                </div>
            </div>
        </div>
    `;

    // Bind pagination for Chart Trend
    const prevBtn = chartView.querySelector('.Trend__C-foot-previous');
    const nextBtn = chartView.querySelector('.Trend__C-foot-next');
    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.chartPage > 1) {
                state.chartPage--;
                renderChartTrend();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.chartPage < totalPages) {
                state.chartPage++;
                renderChartTrend();
            }
        });
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
        const isWin = bet.status === 'win';
        const isNumber = bet.type === 'number' || (!isNaN(Number(bet.selection)) && bet.type !== 'color' && bet.type !== 'size');

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
                    <div class="MyGameRecordList__C-item-r ${isWin ? 'success' : ''}" data-v-8bb41fd5="">
                        <div data-v-8bb41fd5="">${isWin ? 'Succeed' : 'Failed'}</div>
                        <span data-v-8bb41fd5="">${isWin ? '+₹' + Number(bet.winAmount || 0).toFixed(2) : '-₹' + Number(bet.betAmount || 0).toFixed(2)}</span>
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
                        <span data-v-8bb41fd5="">₹${Number(bet.betAmount || 0).toFixed(2)}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Amount after tax</span>
                        <span data-v-8bb41fd5="">₹${Number(bet.contractAmount || 0).toFixed(2)}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Tax</span>
                        <span data-v-8bb41fd5="">₹${Number(bet.fee || 0).toFixed(2)}</span>
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
                        <span data-v-8bb41fd5="" class="${isWin ? 'green' : 'red'}" style="color: ${isWin ? 'var(--norm_green-color)' : 'var(--norm_red-color)'}; font-weight: bold;">${isWin ? 'Succeed' : 'Failed'}</span>
                    </div>
                    <div class="MyGameRecordList__C-detail-line" data-v-8bb41fd5="">
                        <span data-v-8bb41fd5="">Win/Loss</span>
                        <span data-v-8bb41fd5="" class="${isWin ? 'green' : 'red'}" style="color: ${isWin ? 'var(--norm_green-color)' : 'var(--norm_red-color)'}; font-weight: bold;">${isWin ? '+₹' + Number(bet.winAmount || 0).toFixed(2) : '-₹' + Number(bet.betAmount || 0).toFixed(2)}</span>
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
            <div class="Trend__C-foot" data-v-9d93d892="" style="margin-top: .32rem;">
                <div class="Trend__C-foot-previous ${state.myHistoryPage <= 1 ? 'disabled' : ''}" data-v-9d93d892="">
                    <svg class="Trend__C-icon svg-icon" style="width: 0.4rem; height: 0.4rem;"><use xlink:href="#icon-left"></use></svg>
                </div>
                <div class="Trend__C-foot-page" data-v-9d93d892="">${state.myHistoryPage}/${totalPages}</div>
                <div class="Trend__C-foot-next ${state.myHistoryPage >= totalPages ? 'disabled' : ''}" data-v-9d93d892="">
                    <svg class="Trend__C-icon svg-icon" style="width: 0.4rem; height: 0.4rem;"><use xlink:href="#icon-right"></use></svg>
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
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.myHistoryPage > 1) {
                state.myHistoryPage--;
                renderMyHistory();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.myHistoryPage < totalPages) {
                state.myHistoryPage++;
                renderMyHistory();
            }
        });
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
            else if (index === 2) renderMyHistory();
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
