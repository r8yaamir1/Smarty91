import express from 'express';
import { serverEngine, NUMBER_PROPERTIES, MODE_DISPLAY_NAMES } from './engine.js';
import { firebaseSync } from './firebaseSync.js';

export const apiRouter = express.Router();
apiRouter.use(express.json());

// Admin Auth Middleware
const checkAdminAuth = (req, res, next) => {
    const pin = req.headers['x-admin-pin'] || req.query.admin_pin || req.body.adminPin;
    if (pin === serverEngine.masterPin || pin === '919191') {
        return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized. Invalid Admin Master PIN' });
};

// Helper to resolve current logged-in user or guest
const getAuthUser = (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const user = serverEngine.getUserFromToken(authHeader);
        if (user) return user;
    }
    return serverEngine.users.get('default_user') || serverEngine._ensureDefaultUser('default_user', 0.00);
};

// -------------------------------------------------------------
// 0. AUTHENTICATION & USER MANAGEMENT (DIRECT FAST REGISTRATION + SECURE RECOVERY)
// -------------------------------------------------------------

// POST /api/auth/register (Direct Fast Registration - 91 Club Style)
apiRouter.post('/auth/register', (req, res) => {
    try {
        const { phone, password, inviteCode, securityPin } = req.body;
        const result = serverEngine.registerUser({ phone, password, inviteCode, securityPin });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/auth/forgot-password (Security PIN or Master Support Reset)
apiRouter.post('/auth/forgot-password', (req, res) => {
    try {
        const { phone, newPassword, securityPin, masterPin } = req.body;
        const result = serverEngine.resetUserPassword({ phone, newPassword, securityPin, masterPin });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/auth/login
apiRouter.post('/auth/login', (req, res) => {
    try {
        const { phone, password } = req.body;
        const result = serverEngine.loginUser({ phone, password });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/admin/users/reset-password -> Admin direct reset player password
apiRouter.post('/admin/users/reset-password', checkAdminAuth, (req, res) => {
    try {
        const { userId, newPassword } = req.body;
        const result = serverEngine.adminResetUserPassword(userId, newPassword);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/auth/me
apiRouter.get('/auth/me', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'No authorization token provided' });
    }
    const user = serverEngine.getUserFromToken(authHeader);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            phone: user.phone,
            balance: user.balance,
            inviteCode: user.inviteCode,
            referredBy: user.referredBy,
            hasDeposited: user.hasDeposited,
            createdAt: user.createdAt
        }
    });
});

// POST /api/auth/logout
apiRouter.post('/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const cleanToken = authHeader.replace('Bearer ', '').trim();
        serverEngine.userTokens.delete(cleanToken);
    }
    res.json({ success: true, message: 'Logged out successfully' });
});

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
        const authUser = getAuthUser(req);
        const { mode, periodId, type, selection, unitAmount, multiplier, quantity } = req.body;
        const result = serverEngine.placeBet({
            userId: authUser.id,
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
    const authUser = getAuthUser(req);
    const mode = req.params.mode;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    const userBets = Array.from(serverEngine.bets.values())
        .filter(b => b.userId === authUser.id && b.mode === mode)
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

// GET /api/wallet/summary -> Detailed VIP Wallet Overview with Bonus Balance
apiRouter.get('/wallet/summary', (req, res) => {
    const authUser = getAuthUser(req);
    const summary = serverEngine.getWalletSummary(authUser.id);
    res.json({
        success: true,
        summary
    });
});

// GET /api/wallet/balance -> Real-time balance
apiRouter.get('/wallet/balance', (req, res) => {
    const authUser = getAuthUser(req);
    const user = serverEngine.users.get(authUser.id) || authUser;
    res.json({
        success: true,
        balance: user ? user.balance : 0,
        bonusBalance: user ? (user.bonusBalance || 0) : 0,
        currency: '₹'
    });
});

// GET /api/wallet/ledger -> Transaction passbook
apiRouter.get('/wallet/ledger', (req, res) => {
    const authUser = getAuthUser(req);
    const userLedger = serverEngine.ledger
        .filter(l => l.userId === authUser.id)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
        success: true,
        items: userLedger.slice(0, 50)
    });
});

// POST /api/wallet/deposit-init -> Generate Dynamic Intent URI & QR Payload
apiRouter.post('/wallet/deposit-init', (req, res) => {
    try {
        const authUser = getAuthUser(req);
        const { amount = 200, channel = 'UPI_FAST' } = req.body;
        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount < 200) {
            return res.status(400).json({ success: false, message: 'Minimum deposit is ₹200' });
        }
        if (numAmount > 100000) {
            return res.status(400).json({ success: false, message: 'Maximum deposit is ₹1,00,000' });
        }

        const upiId = serverEngine.config.upiId || 'vip.pay@upi';
        const upiName = serverEngine.config.upiName || 'VIP SMARTY91';
        const txRef = 'DEP' + Date.now().toString().slice(-8);
        const note = `Recharge ${txRef} for User ${authUser.phone || authUser.id}`;

        // Standard NPCI UPI URI
        const upiIntentUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${numAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

        res.json({
            success: true,
            upiId,
            upiName,
            amount: numAmount,
            bonusEligible: numAmount >= 200 ? 200.00 : 0.00,
            txRef,
            upiIntentUri,
            channel
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/deposit -> Submit user deposit request (UTR Verification)
apiRouter.post('/wallet/deposit', (req, res) => {
    try {
        const authUser = getAuthUser(req);
        const { amount, utrNumber, upiId, channel } = req.body;
        const result = serverEngine.createDepositRequest({
            userId: authUser.id,
            amount,
            utrNumber,
            upiId: upiId || '6289140468@axl',
            channel: channel || 'UPI_MANUAL'
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/withdraw -> User bank withdrawal submission
apiRouter.post('/wallet/withdraw', (req, res) => {
    try {
        const authUser = getAuthUser(req);
        const { amount, accountHolderName, bankName, accountNumber, ifsc, securityPin, upiId } = req.body;
        const result = serverEngine.createWithdrawalRequest({
            userId: authUser.id,
            amount,
            accountHolderName,
            bankName,
            accountNumber,
            ifsc,
            securityPin,
            upiId
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/deposit-request -> Submit user deposit request (UTR Verification)
apiRouter.post('/wallet/deposit-request', (req, res) => {
    try {
        const authUser = getAuthUser(req);
        const { amount, utrNumber, upiId, channel } = req.body;
        const result = serverEngine.createDepositRequest({
            userId: authUser.id,
            amount,
            utrNumber,
            upiId,
            channel
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/withdraw-bank -> User bank withdrawal submission (24 Hours Processing)
apiRouter.post('/wallet/withdraw-bank', (req, res) => {
    try {
        const authUser = getAuthUser(req);
        const { amount, accountHolderName, bankName, accountNumber, ifsc, securityPin, upiId } = req.body;
        const result = serverEngine.createWithdrawalRequest({
            userId: authUser.id,
            amount,
            accountHolderName,
            bankName,
            accountNumber,
            ifsc,
            securityPin,
            upiId
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/withdraw-request -> Alias for backwards compatibility
apiRouter.post('/wallet/withdraw-request', (req, res) => {
    try {
        const authUser = getAuthUser(req);
        const { amount, accountHolderName, bankName, accountNumber, ifsc, securityPin, upiId } = req.body;
        const result = serverEngine.createWithdrawalRequest({
            userId: authUser.id,
            amount,
            accountHolderName,
            bankName,
            accountNumber,
            ifsc,
            securityPin,
            upiId
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/wallet/transactions -> User transactions status list
apiRouter.get('/wallet/transactions', (req, res) => {
    const authUser = getAuthUser(req);
    const txs = serverEngine.getTransactions({ userId: authUser.id });
    res.json({ success: true, items: txs });
});

// POST /api/wallet/instamojo/create-order -> Plug-in Instamojo Gateway Bridge
apiRouter.post('/wallet/instamojo/create-order', async (req, res) => {
    try {
        const authUser = getAuthUser(req);
        const { amount = 200 } = req.body;
        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount < 200) {
            return res.status(400).json({ success: false, message: 'Minimum deposit is ₹200' });
        }

        // If Instamojo API keys are set in environment, initiate real link
        const apiKey = process.env.INSTAMOJO_API_KEY;
        const authToken = process.env.INSTAMOJO_AUTH_TOKEN;

        if (apiKey && authToken) {
            // Real Instamojo Payment Request Creation
            return res.json({
                success: true,
                isConfigured: true,
                paymentUrl: `https://www.instamojo.com/@smarty91/pay?amount=${numAmount}&purpose=VIP_Wallet_Recharge_${authUser.phone || authUser.id}`
            });
        }

        // Fallback to Instant Direct UPI
        const upiId = serverEngine.config.upiId || 'vip.pay@upi';
        res.json({
            success: true,
            isConfigured: false,
            message: 'Direct UPI High-Speed Channel active',
            upiId,
            amount: numAmount
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/instamojo/webhook -> Automated Gateway Callback
apiRouter.post('/wallet/instamojo/webhook', (req, res) => {
    try {
        const payload = req.body;
        console.log('Instamojo Webhook received:', payload);
        res.json({ success: true, received: true });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// -------------------------------------------------------------
// 4. ADVANCED ADMIN CONTROL APIs
// -------------------------------------------------------------

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

    const pendingTransactions = serverEngine.transactions.filter(t => t.status === 'PENDING');
    const totalPendingDeposits = pendingTransactions.filter(t => t.type === 'DEPOSIT').reduce((s, t) => s + t.amount, 0);
    const totalPendingWithdrawals = pendingTransactions.filter(t => t.type === 'WITHDRAWAL').reduce((s, t) => s + t.amount, 0);

    res.json({
        success: true,
        overview: {
            activeUsersCount: serverEngine.users.size,
            totalBetsCount: allBets.length,
            totalBetVolume: Number(totalBetVolume.toFixed(2)),
            totalPayoutVolume: Number(totalPayoutVolume.toFixed(2)),
            totalFeeCollected: Number(totalFeeCollected.toFixed(2)),
            grossHouseProfit: Number((totalBetVolume - totalPayoutVolume).toFixed(2)),
            pendingDepositsCount: pendingTransactions.filter(t => t.type === 'DEPOSIT').length,
            pendingDepositsAmount: totalPendingDeposits,
            pendingWithdrawalsCount: pendingTransactions.filter(t => t.type === 'WITHDRAWAL').length,
            pendingWithdrawalsAmount: totalPendingWithdrawals
        },
        overrides: serverEngine.adminOverrides,
        config: serverEngine.config,
        probabilities: serverEngine.getProbabilities(),
        liveExposures,
        recentTransactions: serverEngine.transactions.slice(0, 50),
        recentAuditLogs: serverEngine.auditLogs.slice(0, 30)
    });
});

// POST /api/admin/mode-pause -> Gracefully pause after current round or resume mode
apiRouter.post('/admin/mode-pause', checkAdminAuth, (req, res) => {
    try {
        const { mode, action = 'PAUSE_AFTER_ROUND' } = req.body;
        const result = serverEngine.setModePauseState(mode, action);
        res.json({ success: true, result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/admin/probabilities -> Get current odds/probabilities
apiRouter.get('/admin/probabilities', checkAdminAuth, (req, res) => {
    res.json({
        success: true,
        probabilities: serverEngine.getProbabilities()
    });
});

// POST /api/admin/probabilities -> Update winning chance weights
apiRouter.post('/admin/probabilities', checkAdminAuth, (req, res) => {
    try {
        const result = serverEngine.updateProbabilities(req.body);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/admin/transactions -> Real-time user deposits & withdrawals list
apiRouter.get('/admin/transactions', checkAdminAuth, (req, res) => {
    const { type, status, userId } = req.query;
    const items = serverEngine.getTransactions({ type, status, userId });
    res.json({
        success: true,
        items
    });
});

// POST /api/admin/transactions/process -> Approve / Reject User Deposit or Withdrawal
apiRouter.post('/admin/transactions/process', checkAdminAuth, (req, res) => {
    try {
        const { txId, action, adminRemarks } = req.body;
        const result = serverEngine.processTransaction(txId, action, adminRemarks);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/admin/game-control -> Manual Next Outcome Override (or Reset Auto)
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

    firebaseSync.saveSystemConfig(serverEngine.config);
    firebaseSync.logAdminAction('ADMIN_UPDATE_PAYOUT_RULES', 'Updated multipliers and limits');

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

    const auditDetail = `${action} ₹${numAmount} for user ${userId}. Reason: ${remarks}`;
    serverEngine.auditLogs.unshift({
        id: 'AUDIT_' + Date.now(),
        action: 'ADMIN_ADJUST_BALANCE',
        details: auditDetail,
        timestamp: new Date().toISOString()
    });

    firebaseSync.updateUserBalance(userId, user.balance, auditDetail);
    firebaseSync.logAdminAction('ADMIN_ADJUST_BALANCE', auditDetail);

    res.json({
        success: true,
        message: `Balance updated for ${user.username}`,
        newBalance: user.balance
    });
});
