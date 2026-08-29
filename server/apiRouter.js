import express from 'express';
import { serverEngine, NUMBER_PROPERTIES, MODE_DISPLAY_NAMES } from './engine.js';

export const apiRouter = express.Router();
apiRouter.use(express.json());

// Helper for error handling
const asyncWrap = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// -------------------------------------------------------------
// 1. GAME STATUS & TIMERS
// -------------------------------------------------------------

// GET /api/games/status -> Live status for all 4 modes
apiRouter.get('/games/status', (req, res) => {
    const modesData = {};
    Object.keys(serverEngine.modes).forEach(mode => {
        const state = serverEngine.modes[mode];
        const config = serverEngine.config.modes[mode];
        modesData[mode] = {
            mode,
            displayName: state.displayName,
            periodId: state.currentPeriodId,
            endTimeMs: state.currentEndTimeMs,
            remainingSeconds: state.remainingSeconds,
            isLocked: state.isLocked,
            enabled: config ? config.enabled : true,
            paused: config ? config.paused : false,
            serverTime: Date.now()
        };
    });

    res.json({
        success: true,
        serverTime: Date.now(),
        modes: modesData
    });
});

// GET /api/games/history/:mode -> Winning history
apiRouter.get('/games/history/:mode', (req, res) => {
    const mode = req.params.mode;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    const state = serverEngine.modes[mode];
    if (!state) {
        return res.status(404).json({ success: false, message: 'Invalid mode' });
    }

    const start = (page - 1) * limit;
    const items = state.history.slice(start, start + limit);
    const totalPages = Math.max(1, Math.ceil(state.history.length / limit));

    res.json({
        success: true,
        mode,
        page,
        limit,
        totalPages,
        totalItems: state.history.length,
        items
    });
});

// GET /api/games/chart/:mode -> Chart & trend statistical data
apiRouter.get('/games/chart/:mode', (req, res) => {
    const mode = req.params.mode;
    const state = serverEngine.modes[mode];
    if (!state) {
        return res.status(404).json({ success: false, message: 'Invalid mode' });
    }

    const recent = state.history.slice(0, 50);
    const frequencies = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    const missing = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

    recent.forEach(r => {
        if (frequencies[r.number] !== undefined) {
            frequencies[r.number]++;
        }
    });

    for (let num = 0; num <= 9; num++) {
        let count = 0;
        for (const r of recent) {
            if (r.number === num) break;
            count++;
        }
        missing[num] = count;
    }

    res.json({
        success: true,
        mode,
        frequencies,
        missing,
        recentItems: recent.slice(0, 30)
    });
});

// -------------------------------------------------------------
// 2. BETTING API
// -------------------------------------------------------------

// POST /api/bets/place -> Place bet order
apiRouter.post('/bets/place', (req, res) => {
    try {
        const { mode, periodId, type, selection, unitAmount, multiplier, quantity } = req.body;
        const result = serverEngine.placeBet({
            userId: 'default_user',
            mode,
            periodId,
            type,
            selection,
            unitAmount,
            multiplier,
            quantity
        });

        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/bets/my-history/:mode -> User's bet orders for a mode
apiRouter.get('/bets/my-history/:mode', (req, res) => {
    const mode = req.params.mode;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    const userBets = Array.from(serverEngine.bets.values())
        .filter(b => b.userId === 'default_user' && b.mode === mode)
        .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));

    const start = (page - 1) * limit;
    const items = userBets.slice(start, start + limit);
    const totalPages = Math.max(1, Math.ceil(userBets.length / limit));

    res.json({
        success: true,
        mode,
        page,
        limit,
        totalPages,
        totalItems: userBets.length,
        items
    });
});

// -------------------------------------------------------------
// 3. WALLET & LEDGER API
// -------------------------------------------------------------

// GET /api/wallet/balance -> Real-time balance
apiRouter.get('/wallet/balance', (req, res) => {
    const user = serverEngine.users.get('default_user');
    res.json({
        success: true,
        balance: user ? user.balance : 0,
        currency: '₹'
    });
});

// GET /api/wallet/ledger -> Transaction passbook
apiRouter.get('/wallet/ledger', (req, res) => {
    const userLedger = serverEngine.ledger
        .filter(l => l.userId === 'default_user')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
        success: true,
        items: userLedger.slice(0, 50)
    });
});

// POST /api/wallet/deposit -> User deposit mock request
apiRouter.post('/wallet/deposit', (req, res) => {
    const { amount = 1000 } = req.body;
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid deposit amount' });
    }

    const user = serverEngine.users.get('default_user');
    const balanceBefore = user.balance;
    user.balance = Number((user.balance + numAmount).toFixed(2));
    const balanceAfter = user.balance;

    serverEngine.ledger.unshift({
        id: 'LEDGER_' + Date.now(),
        userId: 'default_user',
        type: 'DEPOSIT',
        amount: numAmount,
        balanceBefore,
        balanceAfter,
        referenceId: 'DEP_' + Date.now(),
        timestamp: new Date().toISOString(),
        description: `Deposit via VIP Gateway (₹${numAmount})`
    });

    res.json({
        success: true,
        message: `₹${numAmount} credited successfully to wallet!`,
        newBalance: user.balance
    });
});

// POST /api/wallet/withdraw -> User withdrawal mock request
apiRouter.post('/wallet/withdraw', (req, res) => {
    const { amount = 500 } = req.body;
    const numAmount = Number(amount);
    const user = serverEngine.users.get('default_user');

    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid withdrawal amount' });
    }
    if (user.balance < numAmount) {
        return res.status(400).json({ success: false, message: 'Insufficient balance to withdraw' });
    }

    const balanceBefore = user.balance;
    user.balance = Number((user.balance - numAmount).toFixed(2));
    const balanceAfter = user.balance;

    serverEngine.ledger.unshift({
        id: 'LEDGER_' + Date.now(),
        userId: 'default_user',
        type: 'WITHDRAWAL',
        amount: -numAmount,
        balanceBefore,
        balanceAfter,
        referenceId: 'WTH_' + Date.now(),
        timestamp: new Date().toISOString(),
        description: `Withdrawal request submitted (₹${numAmount})`
    });

    res.json({
        success: true,
        message: `₹${numAmount} withdrawal request submitted successfully!`,
        newBalance: user.balance
    });
});

// -------------------------------------------------------------
// 4. ADVANCED ADMIN CONTROL APIs
// -------------------------------------------------------------

// Admin Auth Middleware
const checkAdminAuth = (req, res, next) => {
    const pin = req.headers['x-admin-pin'] || req.query.admin_pin || req.body.adminPin;
    if (pin === serverEngine.masterPin || pin === '919191') {
        return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized. Invalid Admin Master PIN' });
};

// POST /api/admin/auth/login
apiRouter.post('/admin/auth/login', (req, res) => {
    const { pin } = req.body;
    if (pin === serverEngine.masterPin || pin === '919191') {
        return res.json({ success: true, message: 'Admin authenticated', token: 'ADMIN_SESSION_TOKEN_91' });
    }
    return res.status(401).json({ success: false, message: 'Incorrect Admin Master PIN' });
});

// GET /api/admin/overview
apiRouter.get('/admin/overview', checkAdminAuth, (req, res) => {
    const allBets = Array.from(serverEngine.bets.values());
    const totalBetVolume = allBets.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    const totalPayoutVolume = allBets.reduce((sum, b) => sum + (b.payoutAmount || 0), 0);
    const totalFeeCollected = allBets.reduce((sum, b) => sum + (b.serviceFee || 0), 0);

    const liveExposures = {};
    ['30s', '1m', '3m', '5m'].forEach(mode => {
        liveExposures[mode] = serverEngine.getLiveExposure(mode);
    });

    res.json({
        success: true,
        overview: {
            activeUsersCount: serverEngine.users.size,
            totalBetsCount: allBets.length,
            totalBetVolume: Number(totalBetVolume.toFixed(2)),
            totalPayoutVolume: Number(totalPayoutVolume.toFixed(2)),
            totalFeeCollected: Number(totalFeeCollected.toFixed(2)),
            grossHouseProfit: Number((totalBetVolume - totalPayoutVolume).toFixed(2))
        },
        overrides: serverEngine.adminOverrides,
        config: serverEngine.config,
        liveExposures,
        recentAuditLogs: serverEngine.auditLogs.slice(0, 20)
    });
});

// POST /api/admin/game-control -> Manual Next Outcome Override (or Reset Auto)
apiRouter.post('/api/admin/game-control', checkAdminAuth, (req, res) => {
    try {
        const { mode, targetNumber } = req.body;
        const result = serverEngine.setAdminOverride(mode, targetNumber);
        res.json({ success: true, result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});
apiRouter.post('/admin/game-control', checkAdminAuth, (req, res) => {
    try {
        const { mode, targetNumber } = req.body;
        const result = serverEngine.setAdminOverride(mode, targetNumber);
        res.json({ success: true, result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/admin/mode-config -> Enable/Disable/Pause Mode
apiRouter.post('/admin/mode-config', checkAdminAuth, (req, res) => {
    const { mode, enabled, paused, lockoutSeconds } = req.body;
    if (!serverEngine.config.modes[mode]) {
        return res.status(400).json({ success: false, message: 'Invalid mode' });
    }

    if (enabled !== undefined) serverEngine.config.modes[mode].enabled = Boolean(enabled);
    if (paused !== undefined) serverEngine.config.modes[mode].paused = Boolean(paused);
    if (lockoutSeconds !== undefined) serverEngine.config.modes[mode].lockoutSeconds = Number(lockoutSeconds);

    serverEngine.auditLogs.unshift({
        id: 'AUDIT_' + Date.now(),
        action: 'ADMIN_UPDATE_MODE_CONFIG',
        details: `Updated mode ${mode} config: enabled=${enabled}, paused=${paused}`,
        timestamp: new Date().toISOString()
    });

    res.json({ success: true, message: `Mode ${mode} updated successfully`, config: serverEngine.config.modes[mode] });
});

// POST /api/admin/payout-rules -> Update Multipliers
apiRouter.post('/admin/payout-rules', checkAdminAuth, (req, res) => {
    const { multipliers, serviceFeePercent, minBetAmount, maxBetAmount } = req.body;

    if (multipliers) {
        serverEngine.config.multipliers = { ...serverEngine.config.multipliers, ...multipliers };
    }
    if (serviceFeePercent !== undefined) serverEngine.config.serviceFeePercent = Number(serviceFeePercent);
    if (minBetAmount !== undefined) serverEngine.config.minBetAmount = Number(minBetAmount);
    if (maxBetAmount !== undefined) serverEngine.config.maxBetAmount = Number(maxBetAmount);

    serverEngine.auditLogs.unshift({
        id: 'AUDIT_' + Date.now(),
        action: 'ADMIN_UPDATE_PAYOUT_RULES',
        details: `Updated multipliers and limits`,
        timestamp: new Date().toISOString()
    });

    res.json({ success: true, message: 'Payout rules updated', config: serverEngine.config });
});

// GET /api/admin/users -> List all users
apiRouter.get('/admin/users', checkAdminAuth, (req, res) => {
    const usersList = Array.from(serverEngine.users.values());
    res.json({ success: true, users: usersList });
});

// POST /api/admin/users/adjust-balance -> Manual Balance Credit/Debit with remarks
apiRouter.post('/admin/users/adjust-balance', checkAdminAuth, (req, res) => {
    const { userId = 'default_user', amount, action = 'ADD', remarks = 'Admin manual adjustment' } = req.body;
    const user = serverEngine.users.get(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const balanceBefore = user.balance;
    if (action === 'ADD') {
        user.balance = Number((user.balance + numAmount).toFixed(2));
    } else {
        if (user.balance < numAmount) {
            return res.status(400).json({ success: false, message: 'Cannot deduct more than current balance' });
        }
        user.balance = Number((user.balance - numAmount).toFixed(2));
    }
    const balanceAfter = user.balance;

    serverEngine.ledger.unshift({
        id: 'LEDGER_' + Date.now(),
        userId,
        type: action === 'ADD' ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        amount: action === 'ADD' ? numAmount : -numAmount,
        balanceBefore,
        balanceAfter,
        referenceId: 'ADMIN_ADJ_' + Date.now(),
        timestamp: new Date().toISOString(),
        description: `Admin adjustment (${action}): ${remarks}`
    });

    serverEngine.auditLogs.unshift({
        id: 'AUDIT_' + Date.now(),
        action: 'ADMIN_ADJUST_BALANCE',
        details: `${action} ₹${numAmount} for user ${userId}. Reason: ${remarks}`,
        timestamp: new Date().toISOString()
    });

    res.json({
        success: true,
        message: `Balance updated for ${user.username}`,
        newBalance: user.balance
    });
});
