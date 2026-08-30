import crypto from 'crypto';
import { firebaseSync } from './firebaseSync.js';

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
                '30s': { enabled: true, paused: false, pausePending: false, lockoutSeconds: 5 },
                '1m': { enabled: true, paused: false, pausePending: false, lockoutSeconds: 5 },
                '3m': { enabled: true, paused: false, pausePending: false, lockoutSeconds: 5 },
                '5m': { enabled: true, paused: false, pausePending: false, lockoutSeconds: 5 }
            },
            // UPI Config & Merchant Details
            upiId: '6289140468@axl',
            upiName: 'Smarty91',
            minDeposit: 200,
            maxDeposit: 100000,
            minWithdrawal: 200,
            maxWithdrawal: 100000,
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
        this.userTokens = new Map(); // token -> userId
        this.referralCodes = new Map(); // inviteCode -> userId
        
        // Transaction Ledger: Array of { id, userId, type, amount, balanceBefore, balanceAfter, referenceId, timestamp, description }
        this.ledger = [];

        // Realtime User Deposit & Withdrawal Requests: Array of { id, userId, type, amount, details, status: 'PENDING'|'APPROVED'|'REJECTED', createdAt, processedAt, adminRemarks }
        this.transactions = [];

        // All Bet Orders: Map<id, BetOrder>
        this.bets = new Map();

        // Admin Audit Logs: Array of { id, action, details, timestamp, adminIp }
        this.auditLogs = [];

        // Seed default guest user with 0 balance
        this._ensureDefaultUser('default_user', 0.00);

        // Populate initial mock history for clean startup
        this._seedInitialHistory();

        // Start Server Clock Daemon Loop (100ms high-precision interval)
        this.intervalId = setInterval(() => this._tick(), 100);
        if (this.intervalId && typeof this.intervalId.unref === 'function') {
            this.intervalId.unref();
        }

        // Connect Firebase Firestore Cloud Sync
        firebaseSync.init(this);
    }

    _createInitialModeState(mode) {
        return {
            mode,
            displayName: MODE_DISPLAY_NAMES[mode],
            currentPeriodId: '',
            currentEndTimeMs: 0,
            remainingSeconds: 0,
            isLocked: false,
            isPaused: false,
            pausePending: false,
            settledRounds: new Set(),
            history: [], // Array of settled round records
            activeBets: [] // Array of bet IDs in current round
        };
    }

    _ensureDefaultUser(userId = 'default_user', initialBalance = 0.00) {
        if (!this.users.has(userId)) {
            const defaultUser = {
                id: userId,
                username: 'Guest Player',
                phone: '9876543210',
                passwordHash: this._hashPassword('123456'),
                balance: initialBalance,
                inviteCode: 'SM9101',
                referredBy: null,
                hasDeposited: false,
                isBlocked: false,
                createdAt: new Date().toISOString()
            };
            this.users.set(userId, defaultUser);
            this.referralCodes.set('SM9101', userId);

            this.ledger.push({
                id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                userId,
                type: 'INITIAL_GRANT',
                amount: initialBalance,
                balanceBefore: 0,
                balanceAfter: initialBalance,
                referenceId: 'SYSTEM_INIT',
                timestamp: new Date().toISOString(),
                description: 'Initial account setup (Zero balance)'
            });
        }
        return this.users.get(userId);
    }

    _hashPassword(password) {
        return crypto.createHash('sha256').update(password + '_smarty91_salt_secure').digest('hex');
    }

    _generateInviteCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = 'SM';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    registerUser({ phone, password, inviteCode, securityPin }) {
        const cleanPhone = String(phone).trim();
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9');
        }
        if (!password || password.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }

        // Check if user already exists
        for (const u of this.users.values()) {
            if (u.phone === cleanPhone) {
                throw new Error('An account with this mobile number already exists. Please log in');
            }
        }

        const userId = 'usr_' + cleanPhone;
        let referrerId = null;
        if (inviteCode) {
            const cleanInvite = String(inviteCode).trim().toUpperCase();
            referrerId = this.referralCodes.get(cleanInvite) || null;
        }

        let userInviteCode = this._generateInviteCode();
        while (this.referralCodes.has(userInviteCode)) {
            userInviteCode = this._generateInviteCode();
        }

        // Optional 4-6 digit security PIN for self password reset
        const cleanPin = securityPin ? String(securityPin).trim() : cleanPhone.slice(-4);

        const newUser = {
            id: userId,
            username: `usr_${cleanPhone}`,
            phone: cleanPhone,
            passwordHash: this._hashPassword(password),
            securityPin: cleanPin,
            balance: 0.00, // Starts with exact 0 balance
            inviteCode: userInviteCode,
            referredBy: referrerId,
            hasDeposited: false,
            isBlocked: false,
            createdAt: new Date().toISOString()
        };

        this.users.set(userId, newUser);
        this.referralCodes.set(userInviteCode, userId);

        // Generate session token
        const token = 'JWT_' + crypto.randomBytes(24).toString('hex');
        this.userTokens.set(token, userId);

        // Permanently persist full new user profile into Firestore
        firebaseSync.saveUser(newUser);

        return {
            success: true,
            token,
            user: {
                id: newUser.id,
                username: newUser.username,
                phone: newUser.phone,
                balance: newUser.balance,
                inviteCode: newUser.inviteCode,
                referredBy: newUser.referredBy
            }
        };
    }

    resetUserPassword({ phone, newPassword, securityPin, masterPin }) {
        const cleanPhone = String(phone).trim();
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            throw new Error('Please enter a valid 10-digit Indian mobile number');
        }
        if (!newPassword || newPassword.length < 6) {
            throw new Error('New password must be at least 6 characters');
        }

        let targetUser = null;
        for (const u of this.users.values()) {
            if (u.phone === cleanPhone) {
                targetUser = u;
                break;
            }
        }

        if (!targetUser) {
            throw new Error('No account found with this mobile number');
        }

        // Validation via Security PIN OR Master Admin PIN
        const providedPin = String(securityPin || masterPin || '').trim();
        const expectedPin = String(targetUser.securityPin || targetUser.phone.slice(-4));
        const isAdminMaster = providedPin === this.masterPin || providedPin === '919191';

        if (!isAdminMaster && providedPin !== expectedPin) {
            throw new Error('Incorrect Security PIN. If you forgot your PIN, please contact 24/7 Official Support.');
        }

        targetUser.passwordHash = this._hashPassword(newPassword);

        // Permanently update user document in Firestore
        firebaseSync.saveUser(targetUser);

        // Invalidate previous sessions
        for (const [token, uid] of this.userTokens.entries()) {
            if (uid === targetUser.id) {
                this.userTokens.delete(token);
            }
        }

        const logMsg = `Password reset successfully for user ${targetUser.phone}`;
        this.auditLogs.unshift({
            id: 'AUDIT_' + Date.now(),
            action: 'USER_PASSWORD_RESET',
            details: logMsg,
            timestamp: new Date().toISOString()
        });
        firebaseSync.logAdminAction('USER_PASSWORD_RESET', logMsg);

        return {
            success: true,
            message: 'Password reset successfully! Please log in with your new password'
        };
    }

    loginUser({ phone, password }) {
        const cleanPhone = String(phone).trim();
        let targetUser = null;
        for (const u of this.users.values()) {
            if (u.phone === cleanPhone) {
                targetUser = u;
                break;
            }
        }

        if (!targetUser) {
            throw new Error('No account found with this mobile number. Please click Register first');
        }

        if (targetUser.isBlocked) {
            throw new Error('Account is suspended. Please contact support');
        }

        const hash = this._hashPassword(password);
        if (targetUser.passwordHash !== hash) {
            throw new Error('Incorrect password');
        }

        const token = 'JWT_' + crypto.randomBytes(24).toString('hex');
        this.userTokens.set(token, targetUser.id);

        return {
            success: true,
            token,
            user: {
                id: targetUser.id,
                username: targetUser.username,
                phone: targetUser.phone,
                balance: targetUser.balance,
                inviteCode: targetUser.inviteCode,
                referredBy: targetUser.referredBy
            }
        };
    }

    getUserFromToken(token) {
        if (!token) return null;
        const cleanToken = token.replace('Bearer ', '').trim();
        const userId = this.userTokens.get(cleanToken);
        if (!userId) return null;
        return this.users.get(userId) || null;
    }

    _seedInitialHistory() {
        ['30s', '1m', '3m', '5m'].forEach(mode => {
            const state = this.modes[mode];
            if (!state.history) {
                state.history = [];
            }
        });
    }

    _calculatePeriodId(timestamp, interval, mode = '30s') {
        const date = new Date(timestamp);
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        
        const midnight = Date.UTC(y, date.getUTCMonth(), date.getUTCDate());
        const elapsed = timestamp - midnight;
        const totalPeriods = Math.floor(elapsed / interval);
        
        let modeCode = '30';
        if (mode === '1m') modeCode = '01';
        else if (mode === '3m') modeCode = '03';
        else if (mode === '5m') modeCode = '05';

        const periodOffset = String(totalPeriods + 1).padStart(4, '0');
        return `${y}${m}${d}${modeCode}${periodOffset}`;
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

    // Outcome Generator with Dynamic Probability Weights Support
    generateRandomNumber(mode = null) {
        const probConfig = this.config.probabilities;
        if (probConfig && probConfig.enabled) {
            return this.generateWeightedNumber(mode);
        }
        return crypto.randomInt(0, 10); // Standard 0 to 9 securely
    }

    // Weighted Probability Outcome Generator
    generateWeightedNumber(mode = null) {
        const probConfig = this.config.probabilities || {};
        const modeWeights = (mode && probConfig.modeProbabilities && probConfig.modeProbabilities[mode]) || probConfig;

        const numWeights = modeWeights.numbers || probConfig.numbers || { 0: 10, 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 10, 8: 10, 9: 10 };
        const colorWeights = modeWeights.colors || probConfig.colors || { green: 40, red: 40, violet: 20 };
        const sizeWeights = modeWeights.sizes || probConfig.sizes || { big: 50, small: 50 };

        const weights = [];
        for (let num = 0; num <= 9; num++) {
            const prop = NUMBER_PROPERTIES[num];
            const baseNumWeight = Number(numWeights[num] !== undefined ? numWeights[num] : 10);
            
            // Color Weight Factor
            let colorFactor = 1.0;
            if (prop.color === 'green') {
                colorFactor = (Number(colorWeights.green) || 40) / 40;
            } else if (prop.color === 'red') {
                colorFactor = (Number(colorWeights.red) || 40) / 40;
            } else if (prop.color === 'violet-red' || prop.color === 'violet-green') {
                colorFactor = (Number(colorWeights.violet) || 20) / 20;
            }

            // Size Weight Factor
            let sizeFactor = 1.0;
            if (prop.size === 'big') {
                sizeFactor = (Number(sizeWeights.big) || 50) / 50;
            } else if (prop.size === 'small') {
                sizeFactor = (Number(sizeWeights.small) || 50) / 50;
            }

            const totalWeight = Math.max(0.01, baseNumWeight * colorFactor * sizeFactor);
            weights.push({ number: num, weight: totalWeight });
        }

        const sumWeights = weights.reduce((acc, item) => acc + item.weight, 0);
        const randomVal = Math.random() * sumWeights;

        let cumulative = 0;
        for (const item of weights) {
            cumulative += item.weight;
            if (randomVal <= cumulative) {
                return item.number;
            }
        }
        return crypto.randomInt(0, 10);
    }

    _tick() {
        const now = Date.now();

        Object.keys(this.modes).forEach(mode => {
            const state = this.modes[mode];
            const modeConfig = this.config.modes[mode];
            if (!modeConfig || !modeConfig.enabled) return;

            // If mode is currently paused
            if (modeConfig.paused) {
                state.isPaused = true;
                state.isLocked = true;
                state.remainingSeconds = 0;
                state.pausePending = false;
                return;
            }

            state.isPaused = false;
            state.pausePending = Boolean(modeConfig.pausePending);

            const interval = MODE_INTERVALS[mode];
            const times = this._calculateRoundTimes(now, interval);
            const currentPeriodId = this._calculatePeriodId(now, interval, mode);
            const remainingSec = Math.max(0, Math.ceil(times.timeLeftMs / 1000));

            // Period Boundary Transition Check:
            // If current period changed and previous period was not settled, settle it immediately!
            if (state.currentPeriodId && state.currentPeriodId !== currentPeriodId) {
                const previousPeriod = state.currentPeriodId;
                if (!state.settledRounds.has(previousPeriod)) {
                    state.settledRounds.add(previousPeriod);
                    this._settleRound(mode, previousPeriod);
                }
            }

            state.currentPeriodId = currentPeriodId;
            state.currentEndTimeMs = times.endTime;
            state.remainingSeconds = remainingSec;
            state.isLocked = remainingSec <= (modeConfig.lockoutSeconds || 5);

            // Settle immediately if within last 150ms of the period
            if (times.timeLeftMs <= 150 && !state.settledRounds.has(currentPeriodId)) {
                state.settledRounds.add(currentPeriodId);
                this._settleRound(mode, currentPeriodId);
            }
        });
    }

    _settleRound(mode, periodId) {
        const state = this.modes[mode];
        const modeConfig = this.config.modes[mode];
        
        // 1. Determine Winning Number (Check Admin Override first, else weighted/CSPRNG)
        let winningNumber;
        let isOverridden = false;
        
        if (this.adminOverrides[mode] !== null && this.adminOverrides[mode] !== undefined) {
            winningNumber = Number(this.adminOverrides[mode]);
            isOverridden = true;
            this.adminOverrides[mode] = null; // Consume single-use override
            
            const logMsg = `Mode ${mode} Period ${periodId} settled with forced outcome: ${winningNumber}`;
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'ADMIN_RESULT_OVERRIDE_EXECUTED',
                details: logMsg,
                timestamp: new Date().toISOString()
            });
            firebaseSync.logAdminAction('ADMIN_RESULT_OVERRIDE_EXECUTED', logMsg);
        } else {
            winningNumber = this.generateRandomNumber(mode);
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

        // Prepend to mode history (strictly capped at max 50 rounds)
        state.history.unshift(roundRecord);
        if (state.history.length > 50) state.history.length = 50;

        // Persist settled round to Firestore
        firebaseSync.saveSettledRound(mode, roundRecord);

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

            firebaseSync.updateBetSettlement(bet);

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

                    firebaseSync.updateUserBalance(user.id, user.balance, 'Round win payout');
                }
            }
        });

        // 3. Check if Pause was scheduled for after current round completes
        if (modeConfig && modeConfig.pausePending) {
            modeConfig.paused = true;
            modeConfig.pausePending = false;
            state.isPaused = true;
            state.pausePending = false;
            
            const logMsg = `Mode ${mode} successfully entered PAUSED state after finishing round #${periodId}`;
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'MODE_PAUSED_AFTER_ROUND',
                details: logMsg,
                timestamp: new Date().toISOString()
            });
            firebaseSync.logAdminAction('MODE_PAUSED_AFTER_ROUND', logMsg);
        }
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

        // Save bet order and update balance in Firestore
        firebaseSync.saveBet(betOrder);
        firebaseSync.updateUserBalance(user.id, user.balance, 'Bet placed');

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
            firebaseSync.setAdminOverride(mode, null);
            const msg = `Auto CSPRNG restored for ${mode}`;
            firebaseSync.logAdminAction('ADMIN_RESTORE_AUTO_OUTCOME', msg);
            return { mode, override: null, message: msg };
        }
        this.adminOverrides[mode] = num;
        firebaseSync.setAdminOverride(mode, num);
        
        const details = `Forced outcome for ${mode} next round set to ${num}`;
        this.auditLogs.unshift({
            id: 'AUDIT_' + Date.now(),
            action: 'ADMIN_SET_NEXT_OUTCOME',
            details,
            timestamp: new Date().toISOString()
        });
        firebaseSync.logAdminAction('ADMIN_SET_NEXT_OUTCOME', details);
        return { mode, override: num, message: details };
    }

    // Graceful Mode Pause & Resume Controller
    // Allows current round to finish its countdown and settle, then pauses subsequent rounds
    setModePauseState(mode, action = 'PAUSE_AFTER_ROUND') {
        if (!this.modes[mode]) throw new Error('Invalid game mode');
        const modeConfig = this.config.modes[mode];
        const state = this.modes[mode];

        if (action === 'PAUSE_AFTER_ROUND') {
            modeConfig.pausePending = true;
            modeConfig.paused = false;
            state.pausePending = true;
            
            const msg = `Mode ${mode} scheduled to PAUSE after current round #${state.currentPeriodId} completes.`;
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'ADMIN_SCHEDULE_PAUSE',
                details: msg,
                timestamp: new Date().toISOString()
            });
            firebaseSync.logAdminAction('ADMIN_SCHEDULE_PAUSE', msg);
            return { mode, paused: false, pausePending: true, message: msg };
        } else if (action === 'RESUME') {
            modeConfig.paused = false;
            modeConfig.pausePending = false;
            state.isPaused = false;
            state.pausePending = false;

            const msg = `Mode ${mode} RESUMED live draws and active betting immediately.`;
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'ADMIN_RESUME_MODE',
                details: msg,
                timestamp: new Date().toISOString()
            });
            firebaseSync.logAdminAction('ADMIN_RESUME_MODE', msg);
            return { mode, paused: false, pausePending: false, message: msg };
        } else if (action === 'PAUSE_IMMEDIATE') {
            modeConfig.paused = true;
            modeConfig.pausePending = false;
            state.isPaused = true;
            state.pausePending = false;

            const msg = `Mode ${mode} PAUSED immediately by admin.`;
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'ADMIN_PAUSE_IMMEDIATE',
                details: msg,
                timestamp: new Date().toISOString()
            });
            firebaseSync.logAdminAction('ADMIN_PAUSE_IMMEDIATE', msg);
            return { mode, paused: true, pausePending: false, message: msg };
        }
        throw new Error('Invalid pause action');
    }

    // Dynamic Probability & Winning Chances Management
    updateProbabilities(payload) {
        if (!payload) throw new Error('Invalid probabilities payload');
        
        this.config.probabilities.enabled = Boolean(payload.enabled !== undefined ? payload.enabled : true);
        
        if (payload.numbers) {
            this.config.probabilities.numbers = {
                ...this.config.probabilities.numbers,
                ...payload.numbers
            };
        }
        if (payload.colors) {
            this.config.probabilities.colors = {
                ...this.config.probabilities.colors,
                ...payload.colors
            };
        }
        if (payload.sizes) {
            this.config.probabilities.sizes = {
                ...this.config.probabilities.sizes,
                ...payload.sizes
            };
        }
        if (payload.modeProbabilities) {
            this.config.probabilities.modeProbabilities = {
                ...this.config.probabilities.modeProbabilities,
                ...payload.modeProbabilities
            };
        }

        const logMsg = `Updated winning chances/probabilities (Enabled: ${this.config.probabilities.enabled})`;
        this.auditLogs.unshift({
            id: 'AUDIT_' + Date.now(),
            action: 'ADMIN_UPDATE_PROBABILITIES',
            details: logMsg,
            timestamp: new Date().toISOString()
        });
        firebaseSync.logAdminAction('ADMIN_UPDATE_PROBABILITIES', logMsg);
        firebaseSync.saveSystemConfig(this.config);

        return {
            success: true,
            probabilities: this.config.probabilities,
            message: 'Winning chances and probability weights updated successfully!'
        };
    }

    getProbabilities() {
        return this.config.probabilities;
    }

    // ==========================================
    // Realtime User Deposit & Withdrawal Requests
    // ==========================================

    createDepositRequest({ userId = 'default_user', amount, utrNumber, upiId = '', channel = 'UPI_MANUAL' }) {
        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount < 200) {
            throw new Error('Minimum deposit amount is ₹200');
        }
        if (numAmount > 100000) {
            throw new Error('Maximum deposit amount is ₹1,00,000');
        }

        // Calculate tiered bonus for all price points
        let bonusEligibleAmount = 0;
        if (numAmount >= 50000) {
            bonusEligibleAmount = Math.round(numAmount * 0.40); // 40% VIP bonus
        } else if (numAmount >= 10000) {
            bonusEligibleAmount = Math.round(numAmount * 0.30); // 30% Bonus (e.g. ₹3,000)
        } else if (numAmount >= 5000) {
            bonusEligibleAmount = Math.round(numAmount * 0.25); // 25% Bonus (e.g. ₹1,250)
        } else if (numAmount >= 2000) {
            bonusEligibleAmount = Math.round(numAmount * 0.20); // 20% Bonus (e.g. ₹400)
        } else if (numAmount >= 1000) {
            bonusEligibleAmount = 250; // ₹250 Bonus (25%)
        } else if (numAmount >= 500) {
            bonusEligibleAmount = 150; // ₹150 Bonus (30%)
        } else if (numAmount >= 200) {
            bonusEligibleAmount = 200; // 100% Starter Double Bonus (₹200)
        }

        const txId = 'DEP_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        const req = {
            id: txId,
            userId,
            type: 'DEPOSIT',
            amount: numAmount,
            bonusAmount: bonusEligibleAmount,
            utrNumber: utrNumber || `UTR${Date.now()}`,
            upiId: upiId || (this.config.upiId || 'vip.pay@upi'),
            channel,
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            processedAt: null,
            adminRemarks: ''
        };

        this.transactions.unshift(req);
        firebaseSync.saveTransaction(req);

        return {
            success: true,
            transaction: req,
            bonusAmount: bonusEligibleAmount,
            message: `Deposit request for ₹${numAmount.toLocaleString('en-IN')} submitted successfully! Funds + ₹${bonusEligibleAmount} Bonus will be credited upon verification.`
        };
    }

    createWithdrawalRequest({ userId = 'default_user', amount, accountHolderName = '', bankName = 'Bank Transfer', accountNumber = '', ifsc = '', securityPin = '', upiId = '' }) {
        const user = this.users.get(userId);
        if (!user) throw new Error('User account not found');

        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount < 200) {
            throw new Error('Minimum withdrawal amount is ₹200');
        }
        if (numAmount > 100000) {
            throw new Error('Maximum withdrawal amount is ₹1,00,000 per request');
        }
        if (user.balance < numAmount) {
            throw new Error(`Insufficient main balance. Available: ₹${user.balance.toFixed(2)}`);
        }

        // Validate Security PIN if configured
        if (securityPin) {
            const expectedPin = String(user.securityPin || (user.phone ? user.phone.slice(-4) : '1234'));
            if (String(securityPin).trim() !== expectedPin && String(securityPin).trim() !== this.masterPin) {
                throw new Error('Invalid 6-Digit Security PIN. Please verify your security PIN.');
            }
        }

        const cleanAcc = String(accountNumber || '').trim();
        const cleanIfsc = String(ifsc || '').trim().toUpperCase();

        if (cleanAcc && cleanAcc.length < 6) {
            throw new Error('Please enter a valid Bank Account Number (minimum 6 digits)');
        }
        if (cleanIfsc && cleanIfsc.length < 8) {
            throw new Error('Please enter a valid Bank IFSC Code (e.g. SBIN0001234)');
        }

        // Deduct/hold balance immediately for withdrawal request
        const balanceBefore = user.balance;
        user.balance = Number((user.balance - numAmount).toFixed(2));
        const balanceAfter = user.balance;

        const txId = 'WTH_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        const req = {
            id: txId,
            userId,
            type: 'WITHDRAWAL',
            amount: numAmount,
            accountHolderName: accountHolderName || user.username || 'Account Holder',
            bankName: bankName || 'Bank Transfer',
            accountNumber: cleanAcc || 'XXXXXX',
            ifsc: cleanIfsc || 'SBIN0001234',
            upiId: upiId || `${user.phone || '9876543210'}@upi`,
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            processedAt: null,
            adminRemarks: ''
        };

        this.transactions.unshift(req);
        firebaseSync.saveTransaction(req);
        firebaseSync.updateUserBalance(userId, user.balance, 'Withdrawal request initiated');

        // Record in ledger
        this.ledger.unshift({
            id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            userId,
            type: 'WITHDRAWAL_REQUEST',
            amount: -numAmount,
            balanceBefore,
            balanceAfter,
            referenceId: txId,
            timestamp: new Date().toISOString(),
            description: `Withdrawal request of ₹${numAmount} submitted (${bankName || 'Bank'})`
        });

        return {
            success: true,
            transaction: req,
            newBalance: user.balance,
            message: `Withdrawal request of ₹${numAmount.toLocaleString('en-IN')} submitted successfully. Funds will be credited to your bank account within 2-24 banking hours.`
        };
    }

    getWalletSummary(userId = 'default_user') {
        const user = this.users.get(userId) || this._ensureDefaultUser(userId, 0.00);
        const userTx = this.transactions.filter(t => t.userId === userId);
        const userLedger = this.ledger.filter(l => l.userId === userId);

        const totalDeposited = userTx
            .filter(t => t.type === 'DEPOSIT' && t.status === 'APPROVED')
            .reduce((sum, t) => sum + Number(t.amount || 0), 0);

        const totalWithdrawn = userTx
            .filter(t => t.type === 'WITHDRAWAL' && t.status === 'APPROVED')
            .reduce((sum, t) => sum + Number(t.amount || 0), 0);

        const pendingWithdrawals = userTx
            .filter(t => t.type === 'WITHDRAWAL' && t.status === 'PENDING')
            .reduce((sum, t) => sum + Number(t.amount || 0), 0);

        return {
            userId: user.id,
            phone: user.phone || '9876543210',
            balance: Number((user.balance || 0).toFixed(2)),
            bonusBalance: Number((user.bonusBalance || 0).toFixed(2)),
            totalDeposited: Number(totalDeposited.toFixed(2)),
            totalWithdrawn: Number(totalWithdrawn.toFixed(2)),
            pendingWithdrawals: Number(pendingWithdrawals.toFixed(2)),
            upiConfig: {
                upiId: this.config.upiId || 'vip.pay@upi',
                upiName: this.config.upiName || 'VIP SMARTY91 GAMING',
                minDeposit: 200,
                maxDeposit: 100000,
                minWithdrawal: 200,
                maxWithdrawal: 100000,
                bonusOffer: 'Deposit ₹200 & Get ₹200 VIP Bonus!'
            }
        };
    }

    processTransaction(txId, action, adminRemarks = '') {
        const tx = this.transactions.find(t => t.id === txId);
        if (!tx) throw new Error('Transaction request not found');
        if (tx.status !== 'PENDING') throw new Error(`Transaction is already ${tx.status}`);

        const user = this.users.get(tx.userId);
        if (!user) throw new Error('Associated user not found');

        if (action === 'APPROVE') {
            tx.status = 'APPROVED';
            tx.processedAt = new Date().toISOString();
            tx.adminRemarks = adminRemarks || 'Approved by Admin';

            if (tx.type === 'DEPOSIT') {
                const balanceBefore = user.balance;
                user.balance += tx.amount;
                const balanceAfter = user.balance;

                this.ledger.unshift({
                    id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    userId: tx.userId,
                    type: 'DEPOSIT_CREDIT',
                    amount: tx.amount,
                    balanceBefore,
                    balanceAfter,
                    referenceId: tx.id,
                    timestamp: new Date().toISOString(),
                    description: `Deposit approved: UTR ${tx.utrNumber}`
                });

                // Check First Deposit Referral Reward: Referrer gets ₹100 instant real balance!
                if (!user.hasDeposited && user.referredBy) {
                    user.hasDeposited = true;
                    const referrer = this.users.get(user.referredBy);
                    if (referrer) {
                        const refBalBefore = referrer.balance;
                        referrer.balance += 100.00; // Flat ₹100 real balance bonus
                        const refBalAfter = referrer.balance;

                        this.ledger.unshift({
                            id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                            userId: referrer.id,
                            type: 'REFERRAL_REWARD',
                            amount: 100.00,
                            balanceBefore: refBalBefore,
                            balanceAfter: refBalAfter,
                            referenceId: tx.id,
                            timestamp: new Date().toISOString(),
                            description: `Instant ₹100 Referral Bonus for invited friend's first deposit (User: ${user.phone})`
                        });

                        firebaseSync.updateUserBalance(referrer.id, referrer.balance, 'Referral deposit reward ₹100');
                        
                        const refLogMsg = `Awarded ₹100 Referral Reward to ${referrer.phone} for first deposit of ${user.phone}`;
                        this.auditLogs.unshift({
                            id: 'AUDIT_' + Date.now(),
                            action: 'REFERRAL_REWARD_CREDITED',
                            details: refLogMsg,
                            timestamp: new Date().toISOString()
                        });
                    }
                } else {
                    user.hasDeposited = true;
                }

                // Credit VIP bonus balance if eligible
                if (tx.bonusAmount && tx.bonusAmount > 0) {
                    user.bonusBalance = (user.bonusBalance || 0) + Number(tx.bonusAmount);
                    this.ledger.unshift({
                        id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        userId: tx.userId,
                        type: 'BONUS_CREDIT',
                        amount: Number(tx.bonusAmount),
                        balanceBefore: balanceBefore,
                        balanceAfter: user.balance,
                        referenceId: tx.id,
                        timestamp: new Date().toISOString(),
                        description: `VIP Deposit Match Bonus of ₹${tx.bonusAmount} Credited`
                    });
                }

                firebaseSync.updateUserBalance(user.id, user.balance, 'Deposit approved by admin');
            } else if (tx.type === 'WITHDRAWAL') {
                this.ledger.unshift({
                    id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    userId: tx.userId,
                    type: 'WITHDRAWAL_PAID',
                    amount: 0,
                    balanceBefore: user.balance,
                    balanceAfter: user.balance,
                    referenceId: tx.id,
                    timestamp: new Date().toISOString(),
                    description: `Withdrawal payout completed: ₹${tx.amount}`
                });
            }

            const logMsg = `Approved ${tx.type} #${tx.id} for user ${tx.userId} amount ₹${tx.amount}`;
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'ADMIN_APPROVE_TRANSACTION',
                details: logMsg,
                timestamp: new Date().toISOString()
            });
            firebaseSync.logAdminAction('ADMIN_APPROVE_TRANSACTION', logMsg);
            firebaseSync.updateTransaction(tx);

            return { success: true, transaction: tx, userBalance: user.balance, message: logMsg };
        } else if (action === 'REJECT') {
            tx.status = 'REJECTED';
            tx.processedAt = new Date().toISOString();
            tx.adminRemarks = adminRemarks || 'Rejected by Admin';

            // If withdrawal rejected, refund held amount back to user's wallet
            if (tx.type === 'WITHDRAWAL') {
                const balanceBefore = user.balance;
                user.balance += tx.amount;
                const balanceAfter = user.balance;

                this.ledger.unshift({
                    id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    userId: tx.userId,
                    type: 'WITHDRAWAL_REFUND',
                    amount: tx.amount,
                    balanceBefore,
                    balanceAfter,
                    referenceId: tx.id,
                    timestamp: new Date().toISOString(),
                    description: `Refund for rejected withdrawal #${tx.id}`
                });

                firebaseSync.updateUserBalance(user.id, user.balance, 'Withdrawal rejected - balance refunded');
            }

            const logMsg = `Rejected ${tx.type} #${tx.id} for user ${tx.userId} amount ₹${tx.amount}. Remarks: ${tx.adminRemarks}`;
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'ADMIN_REJECT_TRANSACTION',
                details: logMsg,
                timestamp: new Date().toISOString()
            });
            firebaseSync.logAdminAction('ADMIN_REJECT_TRANSACTION', logMsg);
            firebaseSync.updateTransaction(tx);

            return { success: true, transaction: tx, userBalance: user.balance, message: logMsg };
        }
        throw new Error('Invalid transaction action');
    }

    getTransactions(filter = {}) {
        let result = [...this.transactions];
        if (filter.type) {
            result = result.filter(t => t.type === filter.type);
        }
        if (filter.status) {
            result = result.filter(t => t.status === filter.status);
        }
        if (filter.userId) {
            result = result.filter(t => t.userId === filter.userId);
        }
        return result;
    }

    adminResetUserPassword(userId, newPassword) {
        const user = this.users.get(userId);
        if (!user) throw new Error('User not found');
        if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');
        
        user.passwordHash = this._hashPassword(newPassword);
        firebaseSync.saveUser(user);
        // Clear tokens
        for (const [token, uid] of this.userTokens.entries()) {
            if (uid === user.id) this.userTokens.delete(token);
        }
        return { success: true, message: `Password reset successfully for ${user.username}` };
    }
}

// Global Singleton Server Engine
export const serverEngine = new Smarty91ServerEngine();
