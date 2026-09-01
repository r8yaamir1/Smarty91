import express from 'express';
import { serverEngine, NUMBER_PROPERTIES, MODE_DISPLAY_NAMES } from './engine.js';
import { firebaseSync } from './firebaseSync.js';
import { sendTelegramMessage, editTelegramMessage, answerCallbackQuery, TELEGRAM_CONFIG } from './telegramAlert.js';

export const apiRouter = express.Router();
apiRouter.use(express.json());

// Admin Auth Middleware
const checkAdminAuth = (req, res, next) => {
    const pin = req.headers['x-admin-pin'] || req.query.admin_pin || req.body.adminPin;
    if (pin === serverEngine.masterPin || pin === 'Smarty071' || pin === '919191') {
        return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized. Invalid Admin Master PIN' });
};

// Helper to resolve current logged-in user or guest synchronously
const getAuthUser = (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const user = serverEngine.getUserFromToken(authHeader);
        if (user) return user;
    }
    return serverEngine.users.get('default_user') || serverEngine._ensureDefaultUser('default_user', 0.00);
};

// Helper to resolve current logged-in user asynchronously with fresh Firestore state
const getAuthUserAsync = async (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const user = await serverEngine.resolveUserFromToken(authHeader);
        if (user) return user;
    }
    return null;
};

// -------------------------------------------------------------
// 0. AUTHENTICATION & USER MANAGEMENT (DIRECT FAST REGISTRATION + SECURE RECOVERY)
// -------------------------------------------------------------

// POST /api/auth/register (Direct Fast Registration - 91 Club Style)
apiRouter.post('/auth/register', async (req, res) => {
    try {
        const { phone, password, inviteCode, securityPin } = req.body;
        const result = serverEngine.registerUser({ phone, password, inviteCode, securityPin });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/auth/forgot-password (Security PIN or Master Support Reset)
apiRouter.post('/auth/forgot-password', async (req, res) => {
    try {
        const { phone, newPassword, securityPin, masterPin } = req.body;
        const result = await serverEngine.resetUserPassword({ phone, newPassword, securityPin, masterPin });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/auth/login
apiRouter.post('/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const result = await serverEngine.loginUser({ phone, password });
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
apiRouter.get('/auth/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'No authorization token provided' });
    }
    const user = await serverEngine.resolveUserFromToken(authHeader);
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

// GET /api/game/profit-stars -> Today's Profit Stars (Public)
apiRouter.get('/game/profit-stars', (req, res) => {
    try {
        const stars = serverEngine.getProfitStars();
        res.json({ success: true, profitStars: stars });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/admin/profit-stars -> Update Today's Profit Stars (Admin Auth)
apiRouter.post('/admin/profit-stars', checkAdminAuth, (req, res) => {
    try {
        const result = serverEngine.updateProfitStars(req.body);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/game/referral-stars -> Top 3 Referral Stars (Public)
apiRouter.get('/game/referral-stars', (req, res) => {
    try {
        const stars = serverEngine.getReferralStars();
        res.json({ success: true, referralStars: stars });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/admin/referral-stars -> Update Top 3 Referral Stars (Admin Auth)
apiRouter.post('/admin/referral-stars', checkAdminAuth, (req, res) => {
    try {
        const result = serverEngine.updateReferralStars(req.body);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
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

// -------------------------------------------------------------
// 0.1. DAILY SIGN-IN & REFERRAL PROMOTIONS
// -------------------------------------------------------------

// GET /api/user/checkin/status -> Current streak, status & 7-day rewards
apiRouter.get('/user/checkin/status', async (req, res) => {
    try {
        const user = await getAuthUserAsync(req);
        const status = serverEngine.getDailyCheckInStatus(user.id);
        res.json(status);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/user/checkin/claim -> Claim today's bonus (Requires min 1 Deposit)
apiRouter.post('/user/checkin/claim', async (req, res) => {
    try {
        const user = await getAuthUserAsync(req);
        const result = serverEngine.claimDailyCheckIn(user.id);
        res.json(result);
    } catch (err) {
        res.status(400).json({
            success: false,
            code: err.code || 'CLAIM_ERROR',
            message: err.message
        });
    }
});

// GET /api/user/referral/stats -> User referral performance & invite history
apiRouter.get('/user/referral/stats', async (req, res) => {
    try {
        const user = await getAuthUserAsync(req);
        const summary = serverEngine.getReferralSummary(user.id);
        res.json(summary);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/user/referral/payout-window -> Check if 1st of month payout window is open
apiRouter.get('/user/referral/payout-window', async (req, res) => {
    try {
        const user = await getAuthUserAsync(req);
        const status = serverEngine.canWithdrawReferralIncome(user.id);
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/user/referral/withdraw -> Withdraw referral commissions (1st of month only)
apiRouter.post('/user/referral/withdraw', async (req, res) => {
    try {
        const user = await getAuthUserAsync(req);
        const { amount, accountHolderName, accountNumber, ifsc, bankName, channel, usdtAddress } = req.body;
        const result = serverEngine.createWithdrawalRequest({
            userId: user.id,
            amount,
            accountHolderName,
            accountNumber,
            ifsc,
            bankName,
            channel,
            usdtAddress,
            isReferralWithdrawal: true
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
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
apiRouter.post('/bets/place', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
        if (!authUser || !authUser.id) {
            return res.status(401).json({ success: false, message: 'Please log in to place bets.' });
        }
        const { mode, periodId, type, selection, unitAmount, multiplier, quantity } = req.body;
        const result = await serverEngine.placeBet({
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
apiRouter.get('/bets/my-history/:mode', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
        if (!authUser || !authUser.id) {
            return res.json({ success: true, mode: req.params.mode, page: 1, totalPages: 1, totalItems: 0, items: [] });
        }
        const mode = req.params.mode;
        const page = parseInt(req.query.page, 10) || 1;
        const limitAmount = parseInt(req.query.limit, 10) || 10;

        // Fetch user bets from Firestore and merge with any active in-memory bets
        const firestoreBets = await firebaseSync.getUserBets(authUser.id, mode);
        const betMap = new Map();

        // 1. Add Firestore historical bets
        if (Array.isArray(firestoreBets)) {
            firestoreBets.forEach(b => {
                if (b && b.id) betMap.set(b.id, b);
            });
        }

        // 2. Overlay disk/in-memory settled bets history
        if (serverEngine.settledBetsHistory && serverEngine.settledBetsHistory.size > 0) {
            const targetMode = String(mode).toLowerCase().replace('wingo', '').trim();
            for (const [, b] of serverEngine.settledBetsHistory) {
                if (b && b.userId === authUser.id) {
                    const betMode = String(b.mode || '').toLowerCase().replace('wingo', '').trim();
                    if (betMode === targetMode || b.mode === mode) {
                        betMap.set(b.id, b);
                    }
                }
            }
        }

        // 3. Overlay in-memory latest active bets
        if (serverEngine.bets && serverEngine.bets.size > 0) {
            const targetMode = String(mode).toLowerCase().replace('wingo', '').trim();
            for (const [, b] of serverEngine.bets) {
                if (b && b.userId === authUser.id) {
                    const betMode = String(b.mode || '').toLowerCase().replace('wingo', '').trim();
                    if (betMode === targetMode || b.mode === mode) {
                        betMap.set(b.id, b);
                    }
                }
            }
        }

        const userBets = Array.from(betMap.values());
        userBets.sort((a, b) => {
            const timeA = a.placedAt ? (typeof a.placedAt === 'string' ? new Date(a.placedAt).getTime() : a.placedAt) : 0;
            const timeB = b.placedAt ? (typeof b.placedAt === 'string' ? new Date(b.placedAt).getTime() : b.placedAt) : 0;
            return timeB - timeA;
        });

        const start = (page - 1) * limitAmount;
        const items = userBets.slice(start, start + limitAmount);
        const totalPages = Math.max(1, Math.ceil(userBets.length / limitAmount));

        res.json({
            success: true,
            mode,
            page,
            limit: limitAmount,
            totalPages,
            totalItems: userBets.length,
            items
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// -------------------------------------------------------------
// 3. WALLET & LEDGER API
// -------------------------------------------------------------

// GET /api/wallet/summary -> Detailed VIP Wallet Overview with Bonus Balance
apiRouter.get('/wallet/summary', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
        const summary = serverEngine.getWalletSummary(authUser.id);
        res.json({
            success: true,
            summary
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/wallet/balance -> Real-time balance
apiRouter.get('/wallet/balance', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
        if (!authUser) {
            return res.status(401).json({ success: false, message: 'Unauthorized. Please login again.' });
        }
        
        let freshUser = null;
        try {
            freshUser = await firebaseSync.fetchUserFromFirestore(authUser.id);
        } catch(e) {
            console.warn('[API] Could not fetch fresh balance:', e.message);
        }

        const balance = freshUser ? freshUser.balance : authUser.balance;
        const bonusBalance = freshUser ? (freshUser.bonusBalance || 0) : (authUser.bonusBalance || 0);

        res.json({
            success: true,
            balance: Number(balance) || 0,
            bonusBalance: Number(bonusBalance) || 0,
            currency: '₹'
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/wallet/ledger -> Transaction passbook
apiRouter.get('/wallet/ledger', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
        if (!authUser) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const ledgerItems = serverEngine.ledger.filter(l => l.userId === authUser.id);
        const txItems = serverEngine.transactions.filter(t => t.userId === authUser.id).map(t => ({
            id: t.id,
            userId: t.userId,
            type: t.type,
            amount: t.type === 'WITHDRAWAL' ? -Math.abs(t.amount) : Math.abs(t.amount),
            status: t.status,
            referenceId: t.utrNumber || t.id,
            timestamp: t.createdAt || t.timestamp || new Date().toISOString(),
            description: `${t.type} (${t.channel || 'System'}) - Status: ${t.status}`
        }));

        const combinedMap = new Map();
        ledgerItems.forEach(item => combinedMap.set(item.id, item));
        txItems.forEach(item => {
            if (!combinedMap.has(item.id)) {
                combinedMap.set(item.id, item);
            }
        });

        const sorted = Array.from(combinedMap.values()).sort((a, b) => {
            const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
            const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
            return timeB - timeA;
        });

        res.json({
            success: true,
            items: sorted.slice(0, 100)
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/deposit-init -> Generate Dynamic Intent URI & QR Payload
apiRouter.post('/wallet/deposit-init', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
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

// GET /api/wallet/config -> Live Merchant UPI & USDT Config
apiRouter.get('/wallet/config', (req, res) => {
    res.json({
        success: true,
        upiId: serverEngine.config.upiId || '6289140468@axl',
        upiName: serverEngine.config.upiName || 'Smarty91',
        upiQrImage: serverEngine.config.upiQrImage || '',
        usdtAddress: serverEngine.config.usdtAddress || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
        usdtQrImage: serverEngine.config.usdtQrImage || 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
        usdtUrl: serverEngine.config.usdtUrl || '',
        usdtBep20Address: serverEngine.config.usdtBep20Address || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
        usdtBep20QrImage: serverEngine.config.usdtBep20QrImage || 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
        usdtBep20Url: serverEngine.config.usdtBep20Url || '',
        usdtRate: serverEngine.config.usdtRate || 102,
        minDeposit: serverEngine.config.minDeposit || 200,
        maxDeposit: serverEngine.config.maxDeposit || 100000,
        minWithdrawal: serverEngine.config.minWithdrawal || 500,
        maxWithdrawal: serverEngine.config.maxWithdrawal || 100000
    });
});

// POST /api/admin/developer/update-upi -> Secret Developer Portal Live UPI Update (Password: Aamir@639900)
apiRouter.post('/admin/developer/update-upi', (req, res) => {
    try {
        const { secretKey, upiId, upiName } = req.body;
        if (!secretKey || secretKey !== 'Aamir@639900') {
            return res.status(403).json({ success: false, message: 'Access Denied: Invalid Developer Key' });
        }

        if (!upiId || !upiId.includes('@')) {
            return res.status(400).json({ success: false, message: 'Please enter a valid UPI ID (e.g. name@bank)' });
        }

        const cleanUpiId = upiId.trim();
        const cleanUpiName = (upiName || 'Smarty91').trim();

        // 1. Update in active server memory instantly
        serverEngine.config.upiId = cleanUpiId;
        serverEngine.config.upiName = cleanUpiName;

        const auditDetail = `Developer Portal live update Merchant UPI to: ${cleanUpiId} (${cleanUpiName})`;
        serverEngine.auditLogs.unshift({
            id: 'AUDIT_' + Date.now(),
            action: 'DEVELOPER_UPDATE_UPI',
            details: auditDetail,
            timestamp: new Date().toISOString()
        });

        // 2. Persist in Firebase Firestore in real-time
        firebaseSync.saveSystemConfig(serverEngine.config);
        firebaseSync.logAdminAction('DEVELOPER_UPDATE_UPI', auditDetail);

        res.json({
            success: true,
            message: 'Merchant UPI ID successfully updated in realtime database!',
            upiId: cleanUpiId,
            upiName: cleanUpiName
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/deposit-usdt -> Automatic Tron Blockchain USDT TRC-20 Verification & Credit
apiRouter.post('/wallet/deposit-usdt', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
        const { txid, amountUsdt } = req.body;
        const result = await serverEngine.verifyAndProcessUsdtDeposit({
            userId: authUser.id,
            txid,
            amountUsdt
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/deposit -> Submit user deposit request (UTR Verification)
apiRouter.post('/wallet/deposit', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
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

// POST /api/wallet/withdraw -> User bank or USDT withdrawal submission
apiRouter.post('/wallet/withdraw', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
        const { amount, accountHolderName, bankName, accountNumber, ifsc, securityPin, upiId, channel, usdtAddress } = req.body;
        const result = serverEngine.createWithdrawalRequest({
            userId: authUser.id,
            amount,
            accountHolderName,
            bankName,
            accountNumber,
            ifsc,
            securityPin,
            upiId,
            channel,
            usdtAddress
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/deposit-request -> Submit user deposit request (UTR Verification)
apiRouter.post('/wallet/deposit-request', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
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
apiRouter.post('/wallet/withdraw-bank', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
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
apiRouter.post('/wallet/withdraw-request', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
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
apiRouter.get('/wallet/transactions', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
        const txs = serverEngine.getTransactions({ userId: authUser.id });
        res.json({ success: true, items: txs });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/wallet/instamojo/create-order -> Plug-in Instamojo Gateway Bridge
apiRouter.post('/wallet/instamojo/create-order', async (req, res) => {
    try {
        const authUser = await getAuthUserAsync(req);
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
    if (pin === serverEngine.masterPin || pin === 'Smarty071' || pin === '919191') {
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

// GET /api/admin/risk-engine/status -> Get Risk Engine status & config
apiRouter.get('/admin/risk-engine/status', checkAdminAuth, (req, res) => {
    res.json(serverEngine.getRiskEngineStatus());
});

// POST /api/admin/risk-engine/config -> Update House Win Rate % & Strategy Presets
apiRouter.post('/admin/risk-engine/config', checkAdminAuth, (req, res) => {
    try {
        const result = serverEngine.updateRiskEngineConfig(req.body);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/admin/risk-engine/targeted-users -> Add/Remove Targeted User Override (Always Win / Lose)
apiRouter.post('/admin/risk-engine/targeted-users', checkAdminAuth, (req, res) => {
    try {
        const result = serverEngine.updateTargetedUser(req.body);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
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

// POST /api/admin/telegram/test -> Send Test Notification to Admin Telegram
apiRouter.post('/admin/telegram/test', checkAdminAuth, async (req, res) => {
    try {
        const testMsg = `🔔 <b>Smarty91 Master Admin Alert Test</b>
━━━━━━━━━━━━━━━━━━━━
✅ <i>Telegram Notification Channel is 100% ONLINE!</i>
⏰ <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
📱 <b>Status:</b> Ready for real-time Deposit & Withdrawal Alerts!
━━━━━━━━━━━━━━━━━━━━
👉 <a href="${TELEGRAM_CONFIG.adminUrl}">Open Admin Cashier</a>`;

        // Attempt webhook registration during test to auto-fix missing setup
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.get('host');
        const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;
        
        let webhookResult = '';
        if (TELEGRAM_CONFIG.botToken) {
            try {
                const registerUrl = `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
                const regRes = await fetch(registerUrl);
                const regData = await regRes.json();
                if (regData.ok) {
                    webhookResult = ' (Auto-registered Telegram Webhook!)';
                    console.log(`[Telegram Webhook] Webhook auto-set to ${webhookUrl}`);
                } else {
                    webhookResult = ` (Webhook registration warning: ${regData.description})`;
                    console.warn(`[Telegram Webhook] Failed auto-set:`, regData.description);
                }
            } catch (webhookErr) {
                webhookResult = ` (Webhook error: ${webhookErr.message})`;
                console.warn(`[Telegram Webhook] Error during setWebhook:`, webhookErr.message);
            }
        }

        const result = await sendTelegramMessage(testMsg);
        if (result && result.ok) {
            return res.json({ success: true, message: `Test message sent successfully to your Telegram!${webhookResult}` });
        } else {
            return res.status(400).json({
                success: false,
                message: (result?.description || 'Could not send message. Please make sure you have started the bot by clicking Start on @smarty91_alert_bot in Telegram.') + webhookResult
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/admin/telegram/config -> Update Bot Token or Chat ID
apiRouter.post('/admin/telegram/config', checkAdminAuth, async (req, res) => {
    try {
        const { botToken, chatId } = req.body;
        if (botToken) TELEGRAM_CONFIG.botToken = botToken.trim();
        if (chatId) TELEGRAM_CONFIG.chatId = chatId.trim();
        
        // Auto register/set webhook on Telegram so inline buttons work!
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.get('host');
        const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;
        
        let webhookStatus = '';
        if (TELEGRAM_CONFIG.botToken) {
            try {
                const registerUrl = `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
                const regRes = await fetch(registerUrl);
                const regData = await regRes.json();
                if (regData.ok) {
                    webhookStatus = ' and Inline Button Webhook registered successfully!';
                    console.log(`[Telegram Webhook] Webhook set to ${webhookUrl}`);
                } else {
                    webhookStatus = ` but Inline Webhook registration failed: ${regData.description}`;
                    console.warn(`[Telegram Webhook] Failed to set webhook:`, regData.description);
                }
            } catch (webhookErr) {
                webhookStatus = ` but Inline Webhook setup errored: ${webhookErr.message}`;
                console.warn(`[Telegram Webhook] Error during setWebhook:`, webhookErr.message);
            }
        }

        res.json({
            success: true,
            message: `Telegram settings updated${webhookStatus}`,
            chatId: TELEGRAM_CONFIG.chatId,
            botTokenMasked: TELEGRAM_CONFIG.botToken ? `${TELEGRAM_CONFIG.botToken.slice(0, 8)}...` : ''
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/admin/telegram/register-webhook -> Explicit Webhook Registration
apiRouter.post('/admin/telegram/register-webhook', checkAdminAuth, async (req, res) => {
    try {
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.get('host');
        const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;
        
        if (!TELEGRAM_CONFIG.botToken) {
            return res.status(400).json({ success: false, message: 'Bot Token is not configured! Please configure Telegram Bot first.' });
        }
        
        const registerUrl = `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
        const regRes = await fetch(registerUrl);
        const regData = await regRes.json();
        
        if (regData.ok) {
            return res.json({ 
                success: true, 
                message: 'Telegram Webhook registered successfully! Live integration active.', 
                url: webhookUrl 
            });
        } else {
            return res.status(400).json({ 
                success: false, 
                message: `Telegram rejected webhook: ${regData.description}` 
            });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: `Webhook registration error: ${err.message}` });
    }
});

// POST /api/telegram/webhook -> Handle Inline Buttons (Approve/Reject) click from Telegram
apiRouter.post('/telegram/webhook', async (req, res) => {
    try {
        const { callback_query } = req.body;
        if (!callback_query) {
            return res.sendStatus(200);
        }

        const senderChatId = callback_query.from.id.toString();
        const callbackData = callback_query.data;
        const messageId = callback_query.message.message_id;
        const chatId = callback_query.message.chat.id;
        const originalText = callback_query.message.text || '';

        // Security check: Only allow the configured admin chat ID
        if (senderChatId !== TELEGRAM_CONFIG.chatId) {
            console.warn(`[Telegram Webhook] Unauthorized click by ${senderChatId}. Configured Admin: ${TELEGRAM_CONFIG.chatId}`);
            await answerCallbackQuery(
                callback_query.id, 
                `❌ Unauthorized! Your Chat ID (${senderChatId}) does not match configured Admin Chat ID (${TELEGRAM_CONFIG.chatId}). Please update it in the Admin Panel!`
            );
            return res.sendStatus(200);
        }

        let txId = '';
        let action = '';
        let typeLabel = '';

        if (callbackData.startsWith('approve_dep_')) {
            txId = callbackData.replace('approve_dep_', '');
            action = 'APPROVE';
            typeLabel = 'DEPOSIT';
        } else if (callbackData.startsWith('reject_dep_')) {
            txId = callbackData.replace('reject_dep_', '');
            action = 'REJECT';
            typeLabel = 'DEPOSIT';
        } else if (callbackData.startsWith('approve_wd_')) {
            txId = callbackData.replace('approve_wd_', '');
            action = 'APPROVE';
            typeLabel = 'WITHDRAWAL';
        } else if (callbackData.startsWith('reject_wd_')) {
            txId = callbackData.replace('reject_wd_', '');
            action = 'REJECT';
            typeLabel = 'WITHDRAWAL';
        } else {
            await answerCallbackQuery(callback_query.id, "⚠️ Invalid or unknown callback action.");
            return res.sendStatus(200);
        }

        // Process the transaction in the engine with robust try-catch
        const remarks = `Processed via Telegram Bot by Admin ${senderChatId}`;
        let result;
        try {
            result = serverEngine.processTransaction(txId, action, remarks);
        } catch (txErr) {
            console.error('[Telegram Webhook Tx Error]:', txErr.message);
            await answerCallbackQuery(callback_query.id, `⚠️ Error: ${txErr.message}`);
            return res.sendStatus(200);
        }

        if (result && result.success) {
            const statusLabel = action === 'APPROVE' ? 'APPROVED ✅' : 'REJECTED ❌';
            const actionText = action === 'APPROVE' ? 'Approved' : 'Rejected';
            
            // Format updated message text keeping original details but updating status
            const separator = '━━━━━━━━━━━━━━━━━━━━';
            const parts = originalText.split(separator);
            let updatedMessage = '';
            
            if (parts.length >= 2) {
                updatedMessage = `<b>[TELEGRAM PROCESSED]</b>\n${parts[0].trim()}\n${separator}\n${parts[1].trim()}\n${separator}\n📢 <b>Status:</b> <b>${statusLabel}</b>\n👤 <b>Admin remarks:</b> <i>${remarks}</i>`;
            } else {
                updatedMessage = `🎰 <b>Smarty91 Transaction Action Updated</b>\n━━━━━━━━━━━━━━━━━━━━\n🆔 <b>Tx ID:</b> <code>${txId}</code>\n📝 <b>Type:</b> ${typeLabel}\n📢 <b>Status:</b> <b>${statusLabel}</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <i>Processed directly via Telegram Inline Buttons.</i>`;
            }

            // Dismiss the telegram button spinner & display toast
            await answerCallbackQuery(callback_query.id, `🎉 Tx ${actionText} Successfully!`);
            
            // Edit message to remove inline keyboard so it can't be clicked again
            await editTelegramMessage(chatId, messageId, updatedMessage, null);
        } else {
            const failMsg = result ? (result.message || 'Could not process') : 'Failed to process';
            await answerCallbackQuery(callback_query.id, `⚠️ Error: ${failMsg}`);
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('[Telegram Webhook Error]:', err.message);
        if (req.body && req.body.callback_query && req.body.callback_query.id) {
            try {
                await answerCallbackQuery(req.body.callback_query.id, `⚠️ Webhook Error: ${err.message}`);
            } catch (ansErr) {
                // ignore double failure
            }
        }
        res.sendStatus(200);
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

// -------------------------------------------------------------
// 5. DEVELOPER SECRET PORTAL APIs
// -------------------------------------------------------------

// POST /api/developer/get-config -> Read USDT & Merchant Config
apiRouter.post('/developer/get-config', (req, res) => {
    const { pin, secretKey } = req.body;
    const authKey = pin || secretKey;
    if (authKey !== 'Smarty071' && authKey !== '7117' && authKey !== 'Aamir@639900' && authKey !== serverEngine.masterPin && authKey !== '919191') {
        return res.status(401).json({ success: false, message: 'Invalid Developer Secret Key' });
    }
    res.json({
        success: true,
        usdtAddress: serverEngine.config.usdtAddress || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
        usdtQrImage: serverEngine.config.usdtQrImage || 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
        usdtUrl: serverEngine.config.usdtUrl || '',
        usdtBep20Address: serverEngine.config.usdtBep20Address || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
        usdtBep20QrImage: serverEngine.config.usdtBep20QrImage || 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
        usdtBep20Url: serverEngine.config.usdtBep20Url || '',
        usdtRate: serverEngine.config.usdtRate || 102,
        upiId: serverEngine.config.upiId || '6289140468@axl',
        upiName: serverEngine.config.upiName || 'Smarty91',
        upiQrImage: serverEngine.config.upiQrImage || '',
        minDeposit: serverEngine.config.minDeposit || 200,
        maxDeposit: serverEngine.config.maxDeposit || 100000,
        minWithdrawal: serverEngine.config.minWithdrawal || 200,
        maxWithdrawal: serverEngine.config.maxWithdrawal || 100000,
        masterPin: serverEngine.masterPin || 'Smarty071'
    });
});

// POST /api/developer/update-config -> Save USDT Wallet, Rate & Merchant Details
apiRouter.post('/developer/update-config', (req, res) => {
    const { 
        pin, secretKey, 
        usdtAddress, usdtQrImage, usdtUrl,
        usdtBep20Address, usdtBep20QrImage, usdtBep20Url,
        usdtRate, 
        upiId, upiName, upiQrImage,
        masterPin, minDeposit, maxDeposit, minWithdrawal, maxWithdrawal 
    } = req.body;
    const authKey = pin || secretKey;
    if (authKey !== 'Smarty071' && authKey !== '7117' && authKey !== 'Aamir@639900' && authKey !== serverEngine.masterPin && authKey !== '919191') {
        return res.status(401).json({ success: false, message: 'Invalid Developer Secret Key' });
    }

    if (usdtAddress !== undefined) serverEngine.config.usdtAddress = usdtAddress.trim();
    if (usdtQrImage !== undefined) serverEngine.config.usdtQrImage = usdtQrImage.trim();
    if (usdtUrl !== undefined) serverEngine.config.usdtUrl = usdtUrl.trim();
    if (usdtBep20Address !== undefined) serverEngine.config.usdtBep20Address = usdtBep20Address.trim();
    if (usdtBep20QrImage !== undefined) serverEngine.config.usdtBep20QrImage = usdtBep20QrImage.trim();
    if (usdtBep20Url !== undefined) serverEngine.config.usdtBep20Url = usdtBep20Url.trim();
    if (usdtRate !== undefined && !isNaN(Number(usdtRate))) serverEngine.config.usdtRate = Number(usdtRate);
    if (upiId !== undefined) serverEngine.config.upiId = upiId.trim();
    if (upiName !== undefined) serverEngine.config.upiName = upiName.trim();
    if (upiQrImage !== undefined) serverEngine.config.upiQrImage = upiQrImage.trim();
    if (masterPin) serverEngine.masterPin = masterPin.trim();
    if (minDeposit !== undefined) serverEngine.config.minDeposit = Number(minDeposit);
    if (maxDeposit !== undefined) serverEngine.config.maxDeposit = Number(maxDeposit);
    if (minWithdrawal !== undefined) serverEngine.config.minWithdrawal = Number(minWithdrawal);
    if (maxWithdrawal !== undefined) serverEngine.config.maxWithdrawal = Number(maxWithdrawal);

    firebaseSync.saveSystemConfig(serverEngine.config);
    firebaseSync.logAdminAction('DEVELOPER_UPDATE_CONFIG', 'Updated USDT TRC20/BEP20 and merchant parameters');

    res.json({
        success: true,
        message: '⚡ USDT TRC-20, USDT BEP-20 & Merchant Config Updated Successfully!',
        usdtAddress: serverEngine.config.usdtAddress,
        usdtQrImage: serverEngine.config.usdtQrImage,
        usdtUrl: serverEngine.config.usdtUrl,
        usdtBep20Address: serverEngine.config.usdtBep20Address,
        usdtBep20QrImage: serverEngine.config.usdtBep20QrImage,
        usdtBep20Url: serverEngine.config.usdtBep20Url,
        usdtRate: serverEngine.config.usdtRate,
        upiId: serverEngine.config.upiId,
        upiName: serverEngine.config.upiName,
        upiQrImage: serverEngine.config.upiQrImage,
        masterPin: serverEngine.masterPin
    });
});

// Alias for backwards compatibility
apiRouter.post('/admin/developer/update-upi', (req, res) => {
    const { secretKey, upiId, upiName, usdtAddress, usdtQrImage, usdtUrl, usdtBep20Address, usdtBep20QrImage, usdtBep20Url, usdtRate } = req.body;
    if (secretKey !== 'Smarty071' && secretKey !== 'Aamir@639900' && secretKey !== '7117' && secretKey !== serverEngine.masterPin) {
        return res.status(401).json({ success: false, message: 'Invalid Developer Key' });
    }

    if (upiId) serverEngine.config.upiId = upiId.trim();
    if (upiName) serverEngine.config.upiName = upiName.trim();
    if (usdtAddress) serverEngine.config.usdtAddress = usdtAddress.trim();
    if (usdtQrImage !== undefined) serverEngine.config.usdtQrImage = usdtQrImage.trim();
    if (usdtUrl !== undefined) serverEngine.config.usdtUrl = usdtUrl.trim();
    if (usdtBep20Address) serverEngine.config.usdtBep20Address = usdtBep20Address.trim();
    if (usdtBep20QrImage !== undefined) serverEngine.config.usdtBep20QrImage = usdtBep20QrImage.trim();
    if (usdtBep20Url !== undefined) serverEngine.config.usdtBep20Url = usdtBep20Url.trim();
    if (usdtRate !== undefined && !isNaN(Number(usdtRate))) serverEngine.config.usdtRate = Number(usdtRate);

    firebaseSync.saveSystemConfig(serverEngine.config);
    firebaseSync.logAdminAction('DEVELOPER_UPDATE_CONFIG', 'Updated live config parameters');

    res.json({
        success: true,
        message: 'Config updated successfully',
        upiId: serverEngine.config.upiId,
        upiName: serverEngine.config.upiName,
        usdtAddress: serverEngine.config.usdtAddress,
        usdtQrImage: serverEngine.config.usdtQrImage,
        usdtUrl: serverEngine.config.usdtUrl,
        usdtBep20Address: serverEngine.config.usdtBep20Address,
        usdtBep20QrImage: serverEngine.config.usdtBep20QrImage,
        usdtBep20Url: serverEngine.config.usdtBep20Url,
        usdtRate: serverEngine.config.usdtRate
    });
});

// --- DEVELOPER USER MANAGEMENT & CONTROL ENDPOINTS ---

const validateDevKey = (key) => {
    return key === 'Smarty071' || key === '7117' || key === 'Aamir@639900' || key === serverEngine.masterPin || key === '919191';
};

// 1. Search User by Phone
apiRouter.post('/developer/user/search', async (req, res) => {
    const { secretKey, phone } = req.body;
    if (!validateDevKey(secretKey)) {
        return res.status(401).json({ success: false, message: 'Invalid Developer Secret Key' });
    }
    const cleanPhone = String(phone || '').trim();
    if (!cleanPhone) {
        return res.status(400).json({ success: false, message: 'Please specify a phone number' });
    }

    let targetUser = null;
    for (const u of serverEngine.users.values()) {
        if (u.phone === cleanPhone) {
            targetUser = u;
            break;
        }
    }

    if (!targetUser) {
        try {
            targetUser = await firebaseSync.fetchUserByPhoneFromFirestore(cleanPhone);
        } catch (e) {
            console.warn('[Dev API] Firestore fetch user error:', e.message);
        }
    }

    if (!targetUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
        success: true,
        user: {
            id: targetUser.id,
            username: targetUser.username,
            phone: targetUser.phone,
            balance: targetUser.balance,
            requiredTurnover: targetUser.requiredTurnover,
            inviteCode: targetUser.inviteCode,
            referredBy: targetUser.referredBy,
            isBlocked: !!targetUser.isBlocked,
            createdAt: targetUser.createdAt
        }
    });
});

// 2. Adjust Balance
apiRouter.post('/developer/user/adjust-balance', async (req, res) => {
    const { secretKey, userId, amount } = req.body;
    if (!validateDevKey(secretKey)) {
        return res.status(401).json({ success: false, message: 'Invalid Developer Secret Key' });
    }
    const user = serverEngine.users.get(userId);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found in memory' });
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount)) {
        return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    user.balance = numAmount;
    serverEngine._saveUsersToDisk();
    await firebaseSync.saveUser(user);
    firebaseSync.logAdminAction('DEVELOPER_ADJUST_BALANCE', `Adjusted balance of user ${user.phone} to ₹${numAmount}`);

    res.json({
        success: true,
        message: `Successfully adjusted balance of ${user.phone} to ₹${numAmount}`,
        newBalance: user.balance
    });
});

// 3. Toggle Block Status
apiRouter.post('/developer/user/toggle-block', async (req, res) => {
    const { secretKey, userId, isBlocked } = req.body;
    if (!validateDevKey(secretKey)) {
        return res.status(401).json({ success: false, message: 'Invalid Developer Secret Key' });
    }
    const user = serverEngine.users.get(userId);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found in memory' });
    }

    user.isBlocked = !!isBlocked;
    serverEngine._saveUsersToDisk();
    await firebaseSync.saveUser(user);
    firebaseSync.logAdminAction('DEVELOPER_TOGGLE_BLOCK', `Set block state of user ${user.phone} to ${user.isBlocked}`);

    res.json({
        success: true,
        message: `Successfully ${user.isBlocked ? 'Blocked' : 'Unblocked'} user ${user.phone}`,
        isBlocked: user.isBlocked
    });
});

// 4. Permanent Delete User
apiRouter.post('/developer/user/delete', async (req, res) => {
    const { secretKey, userId } = req.body;
    if (!validateDevKey(secretKey)) {
        return res.status(401).json({ success: false, message: 'Invalid Developer Secret Key' });
    }
    const user = serverEngine.users.get(userId);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found in memory' });
    }

    const phone = user.phone;
    const inviteCode = user.inviteCode;

    // 1. Delete user from memory Map
    serverEngine.users.delete(userId);

    // 2. Delete referral mapping
    if (inviteCode) {
        serverEngine.referralCodes.delete(inviteCode);
    }

    // 3. Invalidate/remove all user session tokens
    for (const [token, uid] of serverEngine.userTokens.entries()) {
        if (uid === userId) {
            serverEngine.userTokens.delete(token);
        }
    }

    // 4. Remove all active bets from serverEngine.bets
    if (serverEngine.bets && serverEngine.bets.size > 0) {
        for (const [bId, b] of serverEngine.bets.entries()) {
            if (b && b.userId === userId) {
                serverEngine.bets.delete(bId);
            }
        }
    }

    // 5. Remove all historical settled bets from serverEngine.settledBetsHistory
    if (serverEngine.settledBetsHistory && serverEngine.settledBetsHistory.size > 0) {
        for (const [bId, b] of serverEngine.settledBetsHistory.entries()) {
            if (b && b.userId === userId) {
                serverEngine.settledBetsHistory.delete(bId);
            }
        }
        serverEngine._saveBetsToDisk();
    }

    // 6. Remove all transactions from serverEngine.transactions
    if (Array.isArray(serverEngine.transactions)) {
        serverEngine.transactions = serverEngine.transactions.filter(t => t.userId !== userId);
    }

    // 7. Remove all ledger entries from serverEngine.ledger
    if (Array.isArray(serverEngine.ledger)) {
        serverEngine.ledger = serverEngine.ledger.filter(l => l.userId !== userId);
    }

    // 8. Save updated users list to disk
    serverEngine._saveUsersToDisk();

    // 9. Delete from Firestore Cloud permanently (user profile, all bets, all transactions)
    try {
        await firebaseSync.deleteUserFromFirestore(userId);
    } catch (err) {
        console.warn('[Dev API] Firestore delete user error:', err.message);
    }

    firebaseSync.logAdminAction('DEVELOPER_DELETE_USER', `Permanently deleted user account ${phone} and all associated histories`);

    res.json({
        success: true,
        message: `Permanently deleted user account ${phone} and all bet/transaction histories successfully.`
    });
});

// 5. Permanent Delete ALL Users & Wipe Data
apiRouter.post('/developer/users/delete-all', async (req, res) => {
    const { secretKey } = req.body;
    if (!validateDevKey(secretKey)) {
        return res.status(401).json({ success: false, message: 'Invalid Developer Secret Key' });
    }

    try {
        const totalUsersDeleted = serverEngine.users.size;

        // 1. Wipe all users
        serverEngine.users.clear();

        // 2. Wipe user tokens & login sessions
        serverEngine.userTokens.clear();

        // 3. Wipe referral codes
        serverEngine.referralCodes.clear();

        // 4. Wipe active bets
        serverEngine.bets.clear();

        // 5. Wipe settled bets history
        serverEngine.settledBetsHistory.clear();

        // 6. Wipe transactions
        serverEngine.transactions = [];

        // 7. Wipe ledger
        serverEngine.ledger = [];

        // 8. Re-seed default demo user
        serverEngine._ensureDefaultUser('default_user', 0.00);

        // 9. Save empty states to disk files
        serverEngine._saveUsersToDisk();
        serverEngine._saveBetsToDisk();

        // 10. Wipe all Firestore users, bets, and transactions collections
        try {
            await firebaseSync.deleteAllUsersFromFirestore();
        } catch (err) {
            console.warn('[Dev API] Firestore delete all users error:', err.message);
        }

        firebaseSync.logAdminAction('DEVELOPER_DELETE_ALL_USERS', `Permanently wiped all ${totalUsersDeleted} user accounts, bets, and transaction histories`);

        res.json({
            success: true,
            message: `Successfully wiped and deleted ALL user accounts, bet histories, and transaction ledgers permanently. Total ${totalUsersDeleted} accounts wiped.`
        });
    } catch (error) {
        console.error('[Dev API] Delete all users error:', error);
        res.status(500).json({ success: false, message: error.message || 'Internal server error while wiping all accounts' });
    }
});

