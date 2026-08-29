import crypto from 'crypto';

// Number Properties mapping (0-9)
export const NUMBER_PROPERTIES = {
    0: { color: 'violet-red', number: 0, size: 'small', label: '0 (Red+Violet)' },
    1: { color: 'green', number: 1, size: 'small', label: '1 (Green)' },
    2: { color: 'red', number: 2, size: 'small', label: '2 (Red)' },
    3: { color: 'green', number: 3, size: 'small', label: '3 (Green)' },
    4: { color: 'red', number: 4, size: 'small', label: '4 (Red)' },
    5: { color: 'violet-green', number: 5, size: 'big', label: '5 (Green+Violet)' },
    6: { color: 'red', number: 6, size: 'big', label: '6 (Red)' },
    7: { color: 'green', number: 7, size: 'big', label: '7 (Green)' },
    8: { color: 'red', number: 8, size: 'big', label: '8 (Red)' },
    9: { color: 'green', number: 9, size: 'big', label: '9 (Green)' }
};

// Mode Interval Definitions (ms)
export const MODE_INTERVALS = {
    '30s': 30 * 1000,
    '1m': 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000
};

export const MODE_DISPLAY_NAMES = {
    '30s': 'Smarty91 30s',
    '1m': 'Smarty91 1Min',
    '3m': 'Smarty91 3Min',
    '5m': 'Smarty91 5Min'
};

class Smarty91ServerEngine {
    constructor() {
        this.masterPin = process.env.ADMIN_MASTER_PIN || '919191';
        
        // Payout Multipliers & Settings
        this.config = {
            serviceFeePercent: 2, // 2% platform fee (Contract Amount = 98%)
            minBetAmount: 1,
            maxBetAmount: 100000,
            multipliers: {
                number: 9,          // 9x
                pureColor: 2,       // 2x (Green or Red pure win)
                violet: 4.5,        // 4.5x (Violet win on 0 or 5)
                halfColor: 1.5,     // 1.5x (Red win on 0 or Green win on 5)
                bigSmall: 2         // 2x (Big or Small)
            },
            modes: {
                '30s': { enabled: true, paused: false, lockoutSeconds: 5 },
                '1m': { enabled: true, paused: false, lockoutSeconds: 5 },
                '3m': { enabled: true, paused: false, lockoutSeconds: 5 },
                '5m': { enabled: true, paused: false, lockoutSeconds: 5 }
            }
        };

        // Admin Overrides for Next Outcome: { '30s': 7, '1m': null, ... }
        this.adminOverrides = {
            '30s': null,
            '1m': null,
            '3m': null,
            '5m': null
        };

        // Independent 4 Game Mode States
        this.modes = {
            '30s': this._createInitialModeState('30s'),
            '1m': this._createInitialModeState('1m'),
            '3m': this._createInitialModeState('3m'),
            '5m': this._createInitialModeState('5m')
        };

        // User Accounts & Wallets Store
        this.users = new Map();
        
        // Transaction Ledger: Array of { id, userId, type, amount, balanceBefore, balanceAfter, referenceId, timestamp, description }
        this.ledger = [];

        // All Bet Orders: Map<id, BetOrder>
        this.bets = new Map();

        // Admin Audit Logs: Array of { id, action, details, timestamp, adminIp }
        this.auditLogs = [];

        // Seed default VIP demo user
        this._ensureDefaultUser('default_user', 25679.96);

        // Populate initial mock history for clean startup
        this._seedInitialHistory();

        // Start Server Clock Daemon Loop (100ms high-precision interval)
        this.intervalId = setInterval(() => this._tick(), 100);
    }

    _createInitialModeState(mode) {
        return {
            mode,
            displayName: MODE_DISPLAY_NAMES[mode],
            currentPeriodId: '',
            currentEndTimeMs: 0,
            remainingSeconds: 0,
            isLocked: false,
            settledRounds: new Set(),
            history: [], // Array of settled round records
            activeBets: [] // Array of bet IDs in current round
        };
    }

    _ensureDefaultUser(userId = 'default_user', initialBalance = 25679.96) {
        if (!this.users.has(userId)) {
            this.users.set(userId, {
                id: userId,
                username: 'VIP Player',
                phone: '9876543210',
                balance: initialBalance,
                isBlocked: false,
                createdAt: new Date().toISOString()
            });

            this.ledger.push({
                id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                userId,
                type: 'INITIAL_GRANT',
                amount: initialBalance,
                balanceBefore: 0,
                balanceAfter: initialBalance,
                referenceId: 'SYSTEM_INIT',
                timestamp: new Date().toISOString(),
                description: 'Initial VIP balance allocation'
            });
        }
        return this.users.get(userId);
    }

    _seedInitialHistory() {
        const now = Date.now();
        ['30s', '1m', '3m', '5m'].forEach(mode => {
            const interval = MODE_INTERVALS[mode];
            const state = this.modes[mode];
            state.history = [];

            for (let i = 25; i >= 1; i--) {
                const roundTime = now - (i * interval);
                const periodId = this._calculatePeriodId(roundTime, interval);
                const number = Math.floor(Math.random() * 10);
                const props = NUMBER_PROPERTIES[number];
                
                state.history.unshift({
                    period: periodId,
                    number,
                    color: props.color,
                    size: props.size,
                    colorLabel: props.label,
                    settledAt: new Date(roundTime).toISOString()
                });
            }
        });
    }

    _calculatePeriodId(timestamp, interval) {
        const date = new Date(timestamp);
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        
        const midnight = Date.UTC(y, date.getUTCMonth(), date.getUTCDate());
        const elapsed = timestamp - midnight;
        const totalPeriods = Math.floor(elapsed / interval);
        const periodOffset = 50001 + totalPeriods;
        
        return `${y}${m}${d}1000${periodOffset}`;
    }

    _calculateRoundTimes(timestamp, interval) {
        const date = new Date(timestamp);
        const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
        const elapsed = timestamp - midnight;
        const currentPeriodIndex = Math.floor(elapsed / interval);
        const currentPeriodStart = midnight + (currentPeriodIndex * interval);
        const currentPeriodEnd = currentPeriodStart + interval;
        
        return {
            startTime: currentPeriodStart,
            endTime: currentPeriodEnd,
            timeLeftMs: Math.max(0, currentPeriodEnd - timestamp)
        };
    }

    // Server-Authoritative CSPRNG Result Generator
    generateRandomNumber() {
        return crypto.randomInt(0, 10); // 0 to 9 securely
    }

    _tick() {
        const now = Date.now();

        Object.keys(this.modes).forEach(mode => {
            const state = this.modes[mode];
            const modeConfig = this.config.modes[mode];
            if (!modeConfig || !modeConfig.enabled || modeConfig.paused) return;

            const interval = MODE_INTERVALS[mode];
            const times = this._calculateRoundTimes(now, interval);
            const periodId = this._calculatePeriodId(now, interval);
            const remainingSec = Math.floor(times.timeLeftMs / 1000);

            state.currentPeriodId = periodId;
            state.currentEndTimeMs = times.endTime;
            state.remainingSeconds = remainingSec;
            state.isLocked = remainingSec <= (modeConfig.lockoutSeconds || 5);

            // Round Settlement when time reaches 0
            if (times.timeLeftMs <= 200 && !state.settledRounds.has(periodId)) {
                state.settledRounds.add(periodId);
                this._settleRound(mode, periodId);
            }
        });
    }

    _settleRound(mode, periodId) {
        const state = this.modes[mode];
        
        // 1. Determine Winning Number (Check Admin Override first, else CSPRNG)
        let winningNumber;
        let isOverridden = false;
        
        if (this.adminOverrides[mode] !== null && this.adminOverrides[mode] !== undefined) {
            winningNumber = Number(this.adminOverrides[mode]);
            isOverridden = true;
            this.adminOverrides[mode] = null; // Consume single-use override
            
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'ADMIN_RESULT_OVERRIDE_EXECUTED',
                details: `Mode ${mode} Period ${periodId} settled with forced outcome: ${winningNumber}`,
                timestamp: new Date().toISOString()
            });
        } else {
            winningNumber = this.generateRandomNumber();
        }

        const props = NUMBER_PROPERTIES[winningNumber];
        const roundRecord = {
            period: periodId,
            number: winningNumber,
            color: props.color,
            size: props.size,
            colorLabel: props.label,
            settledAt: new Date().toISOString(),
            isOverridden
        };

        // Prepend to mode history
        state.history.unshift(roundRecord);
        if (state.history.length > 200) state.history.pop();

        // 2. Settle all pending bets for this mode and periodId
        const pendingBetsForRound = Array.from(this.bets.values()).filter(
            b => b.mode === mode && b.periodId === periodId && b.status === 'PENDING'
        );

        pendingBetsForRound.forEach(bet => {
            const settlement = this._evaluateBet(bet, winningNumber);
            bet.status = settlement.isWin ? 'WON' : 'LOST';
            bet.resultNumber = winningNumber;
            bet.resultColor = props.color;
            bet.resultSize = props.size;
            bet.payoutAmount = settlement.payoutAmount;
            bet.settledAt = new Date().toISOString();

            if (settlement.isWin && settlement.payoutAmount > 0) {
                const user = this.users.get(bet.userId);
                if (user) {
                    const balanceBefore = user.balance;
                    user.balance += settlement.payoutAmount;
                    const balanceAfter = user.balance;

                    this.ledger.unshift({
                        id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        userId: bet.userId,
                        type: 'BET_WIN_CREDIT',
                        amount: settlement.payoutAmount,
                        balanceBefore,
                        balanceAfter,
                        referenceId: bet.id,
                        timestamp: new Date().toISOString(),
                        description: `Won bet on ${mode} round ${periodId} (${bet.selectionLabel})`
                    });
                }
            }
        });
    }

    _evaluateBet(bet, winningNumber) {
        const props = NUMBER_PROPERTIES[winningNumber];
        const multConfig = this.config.multipliers;
        const contractAmount = bet.contractAmount; // Amount after 2% fee

        let isWin = false;
        let payoutMultiplier = 0;

        const sel = String(bet.selection).toLowerCase().trim();

        // 1. Number Bets (0-9) -> 9x
        if (!isNaN(parseInt(sel, 10))) {
            const betNum = parseInt(sel, 10);
            if (betNum === winningNumber) {
                isWin = true;
                payoutMultiplier = multConfig.number;
            }
        }
        // 2. Color Bets (Green, Red, Violet)
        else if (sel === 'green') {
            if (props.color === 'green') {
                isWin = true;
                payoutMultiplier = multConfig.pureColor; // 2x
            } else if (props.color === 'violet-green') {
                isWin = true;
                payoutMultiplier = multConfig.halfColor; // 1.5x
            }
        } else if (sel === 'red') {
            if (props.color === 'red') {
                isWin = true;
                payoutMultiplier = multConfig.pureColor; // 2x
            } else if (props.color === 'violet-red') {
                isWin = true;
                payoutMultiplier = multConfig.halfColor; // 1.5x
            }
        } else if (sel === 'violet') {
            if (winningNumber === 0 || winningNumber === 5) {
                isWin = true;
                payoutMultiplier = multConfig.violet; // 4.5x
            }
        }
        // 3. Big / Small Bets (Big: 5-9, Small: 0-4) -> 2x
        else if (sel === 'big' && props.size === 'big') {
            isWin = true;
            payoutMultiplier = multConfig.bigSmall; // 2x
        } else if (sel === 'small' && props.size === 'small') {
            isWin = true;
            payoutMultiplier = multConfig.bigSmall; // 2x
        }

        const payoutAmount = isWin ? Number((contractAmount * payoutMultiplier).toFixed(2)) : 0;
        return { isWin, payoutMultiplier, payoutAmount };
    }

    // Place Bet (Server-Authoritative Validation)
    placeBet({ userId = 'default_user', mode, periodId, type, selection, unitAmount, multiplier, quantity = 1 }) {
        const modeState = this.modes[mode];
        const modeConfig = this.config.modes[mode];

        if (!modeState || !modeConfig || !modeConfig.enabled || modeConfig.paused) {
            throw new Error(`Game mode ${mode} is currently unavailable`);
        }

        if (modeState.isLocked) {
            throw new Error('Betting window is locked for the final 5 seconds');
        }

        if (periodId !== modeState.currentPeriodId) {
            throw new Error('Period expired or mismatch. Please refresh');
        }

        const totalAmount = Number(unitAmount) * Number(multiplier) * Number(quantity);
        if (isNaN(totalAmount) || totalAmount < this.config.minBetAmount) {
            throw new Error(`Minimum bet amount is ₹${this.config.minBetAmount}`);
        }
        if (totalAmount > this.config.maxBetAmount) {
            throw new Error(`Maximum bet amount is ₹${this.config.maxBetAmount}`);
        }

        const user = this._ensureDefaultUser(userId);
        if (user.isBlocked) {
            throw new Error('Account is restricted. Contact support');
        }

        if (user.balance < totalAmount) {
            throw new Error('Insufficient wallet balance');
        }

        // Atomic Wallet Deduction
        const balanceBefore = user.balance;
        user.balance = Number((user.balance - totalAmount).toFixed(2));
        const balanceAfter = user.balance;

        const feePercent = this.config.serviceFeePercent;
        const serviceFee = Number((totalAmount * (feePercent / 100)).toFixed(2));
        const contractAmount = Number((totalAmount - serviceFee).toFixed(2));

        const betId = 'BET_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        
        let selectionLabel = selection;
        if (!isNaN(parseInt(selection, 10))) {
            selectionLabel = `Number ${selection}`;
        } else {
            selectionLabel = selection.toUpperCase();
        }

        const betOrder = {
            id: betId,
            userId,
            mode,
            periodId,
            type,
            selection: String(selection),
            selectionLabel,
            unitAmount: Number(unitAmount),
            multiplier: Number(multiplier),
            quantity: Number(quantity),
            totalAmount,
            contractAmount,
            serviceFee,
            status: 'PENDING',
            payoutAmount: 0,
            placedAt: new Date().toISOString(),
            settledAt: null
        };

        this.bets.set(betId, betOrder);

        // Record in Ledger
        this.ledger.unshift({
            id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            userId,
            type: 'BET_DEBIT',
            amount: -totalAmount,
            balanceBefore,
            balanceAfter,
            referenceId: betId,
            timestamp: new Date().toISOString(),
            description: `Bet on ${mode} round ${periodId} (${selectionLabel})`
        });

        return {
            success: true,
            bet: betOrder,
            newBalance: user.balance
        };
    }

    // Fetch Live Exposure Heatmap for Admin
    getLiveExposure(mode) {
        const state = this.modes[mode];
        if (!state) return null;

        const activeBets = Array.from(this.bets.values()).filter(
            b => b.mode === mode && b.periodId === state.currentPeriodId && b.status === 'PENDING'
        );

        const summary = {
            mode,
            periodId: state.currentPeriodId,
            remainingSeconds: state.remainingSeconds,
            isLocked: state.isLocked,
            totalBetsCount: activeBets.length,
            totalBetVolume: 0,
            numbers: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 },
            colors: { green: 0, red: 0, violet: 0 },
            sizes: { big: 0, small: 0 }
        };

        activeBets.forEach(bet => {
            summary.totalBetVolume += bet.totalAmount;
            const sel = String(bet.selection).toLowerCase();
            if (summary.numbers[sel] !== undefined) {
                summary.numbers[sel] += bet.totalAmount;
            } else if (summary.colors[sel] !== undefined) {
                summary.colors[sel] += bet.totalAmount;
            } else if (summary.sizes[sel] !== undefined) {
                summary.sizes[sel] += bet.totalAmount;
            }
        });

        return summary;
    }

    // Admin Outcome Override
    setAdminOverride(mode, targetNumber) {
        if (!this.modes[mode]) throw new Error('Invalid game mode');
        const num = Number(targetNumber);
        if (isNaN(num) || num < 0 || num > 9) {
            this.adminOverrides[mode] = null;
            return { mode, override: null, message: `Auto CSPRNG restored for ${mode}` };
        }
        this.adminOverrides[mode] = num;
        this.auditLogs.unshift({
            id: 'AUDIT_' + Date.now(),
            action: 'ADMIN_SET_NEXT_OUTCOME',
            details: `Forced outcome for ${mode} next round set to ${num}`,
            timestamp: new Date().toISOString()
        });
        return { mode, override: num, message: `Forced outcome for ${mode} set to ${num}` };
    }
}

// Global Singleton Server Engine
export const serverEngine = new Smarty91ServerEngine();
