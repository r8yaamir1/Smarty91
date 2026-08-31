import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { firebaseSync } from './firebaseSync.js';
import { notifyNewDeposit, notifyNewWithdrawal } from './telegramAlert.js';

const DATA_DIR = path.resolve(process.cwd(), 'server', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users_store.json');
const TOKEN_SECRET = process.env.SESSION_SECRET || 'smarty91_vip_secure_master_session_secret_2026';

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
            // UPI & USDT Crypto Config
            upiId: '6289140468@axl',
            upiName: 'Smarty91',
            usdtAddress: 'TEX8NYBX78GkaStcmtp8UJGF7GJsrAnvHh',
            usdtQrImage: '',
            usdtRate: 90,
            minDeposit: 200,
            maxDeposit: 100000,
            minWithdrawal: 200,
            maxWithdrawal: 100000,
            profitStars: {
                rank1: { first2: '98', last2: '71', amount: '₹1,84,500' },
                rank2: { first2: '91', last2: '04', amount: '₹1,12,800' },
                rank3: { first2: '88', last2: '51', amount: '₹76,400' }
            },
            referralStars: {
                rank1: { first2: '98', last2: '12', amount: '₹1,48,500' },
                rank2: { first2: '91', last2: '88', amount: '₹92,400' },
                rank3: { first2: '88', last2: '45', amount: '₹64,200' }
            }
        };

        // Cache set to prevent duplicate USDT txhash processing
        this.processedUsdtTxids = new Set();

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
        
        // Ensure disk directory exists and load persistent users immediately
        this._ensureDataDir();
        this._loadUsersFromDisk();

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

    _ensureDataDir() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
        } catch (e) {
            console.warn('[Storage] Data dir creation error:', e.message);
        }
    }

    _loadUsersFromDisk() {
        try {
            if (fs.existsSync(USERS_FILE)) {
                const raw = fs.readFileSync(USERS_FILE, 'utf8');
                if (raw && raw.trim()) {
                    const data = JSON.parse(raw);
                    if (Array.isArray(data)) {
                        let count = 0;
                        data.forEach(u => {
                            if (u && u.id) {
                                this.users.set(u.id, u);
                                if (u.inviteCode) {
                                    this.referralCodes.set(u.inviteCode, u.id);
                                }
                                count++;
                            }
                        });
                        console.log(`[Storage] Loaded ${count} permanent user accounts from disk.`);
                    }
                }
            }
        } catch (e) {
            console.warn('[Storage] Load users from disk warning:', e.message);
        }
    }

    _saveUsersToDisk() {
        try {
            this._ensureDataDir();
            const usersArray = Array.from(this.users.values());
            const tempFile = USERS_FILE + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(usersArray, null, 2), 'utf8');
            fs.renameSync(tempFile, USERS_FILE);
        } catch (e) {
            console.warn('[Storage] Save users to disk warning:', e.message);
        }
    }

    _ensureDefaultUser(userId = 'default_user', initialBalance = 0.00) {
        if (!this.users.has(userId)) {
            if (userId !== 'default_user') {
                console.warn(`[Engine] Refusing to create dummy cached user for real account to prevent balance overwrite: ${userId}`);
                return {
                    id: userId,
                    username: `usr_${userId.replace('usr_', '')}`,
                    phone: userId.replace('usr_', ''),
                    passwordHash: '',
                    balance: 0.00,
                    inviteCode: '',
                    referredBy: null,
                    hasDeposited: false,
                    isBlocked: false,
                    isDummy: true,
                    createdAt: new Date().toISOString()
                };
            }

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
            this._saveUsersToDisk();

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

    _createSessionToken(userId, phone = '') {
        const payload = Buffer.from(JSON.stringify({
            uid: userId,
            p: phone || '',
            t: Date.now()
        })).toString('base64url');
        const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
        const token = `JWT_${payload}.${sig}`;
        this.userTokens.set(token, userId);
        return token;
    }

    registerUser({ phone, password, inviteCode, securityPin }) {
        const cleanPhone = String(phone).trim();
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9');
        }
        if (!password || password.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }

        // Check in memory and re-check disk store
        this._loadUsersFromDisk();
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

        // Permanently persist to local disk and Firestore Cloud
        this._saveUsersToDisk();
        firebaseSync.saveUser(newUser);

        // Generate persistent stateless HMAC session token
        const token = this._createSessionToken(userId, cleanPhone);

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

    getProfitStars() {
        if (!this.config.profitStars) {
            this.config.profitStars = {
                rank1: { first2: '98', last2: '71', amount: '₹1,84,500' },
                rank2: { first2: '91', last2: '04', amount: '₹1,12,800' },
                rank3: { first2: '88', last2: '51', amount: '₹76,400' }
            };
        }
        return this.config.profitStars;
    }

    updateProfitStars(stars) {
        if (!stars || typeof stars !== 'object') {
            throw new Error('Invalid profit stars data');
        }
        const current = this.getProfitStars();
        const updated = {
            rank1: {
                first2: String(stars.rank1?.first2 !== undefined ? stars.rank1.first2 : current.rank1.first2).trim().slice(0, 4),
                last2: String(stars.rank1?.last2 !== undefined ? stars.rank1.last2 : current.rank1.last2).trim().slice(0, 4),
                amount: String(stars.rank1?.amount !== undefined ? stars.rank1.amount : current.rank1.amount).trim()
            },
            rank2: {
                first2: String(stars.rank2?.first2 !== undefined ? stars.rank2.first2 : current.rank2.first2).trim().slice(0, 4),
                last2: String(stars.rank2?.last2 !== undefined ? stars.rank2.last2 : current.rank2.last2).trim().slice(0, 4),
                amount: String(stars.rank2?.amount !== undefined ? stars.rank2.amount : current.rank2.amount).trim()
            },
            rank3: {
                first2: String(stars.rank3?.first2 !== undefined ? stars.rank3.first2 : current.rank3.first2).trim().slice(0, 4),
                last2: String(stars.rank3?.last2 !== undefined ? stars.rank3.last2 : current.rank3.last2).trim().slice(0, 4),
                amount: String(stars.rank3?.amount !== undefined ? stars.rank3.amount : current.rank3.amount).trim()
            }
        };

        this.config.profitStars = updated;
        firebaseSync.saveProfitStars(updated);

        const logMsg = `Updated Today's Profit Stars (Rank 1: ${updated.rank1.first2}***${updated.rank1.last2} - ${updated.rank1.amount}, Rank 2: ${updated.rank2.first2}***${updated.rank2.last2} - ${updated.rank2.amount}, Rank 3: ${updated.rank3.first2}***${updated.rank3.last2} - ${updated.rank3.amount})`;
        this.auditLogs.unshift({
            id: 'AUDIT_' + Date.now(),
            action: 'ADMIN_UPDATE_PROFIT_STARS',
            details: logMsg,
            timestamp: new Date().toISOString()
        });
        firebaseSync.logAdminAction('ADMIN_UPDATE_PROFIT_STARS', logMsg);

        return {
            success: true,
            profitStars: updated,
            message: "Today's Profit Stars updated successfully!"
        };
    }

    async resetUserPassword({ phone, newPassword, securityPin, masterPin }) {
        const cleanPhone = String(phone).trim();
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            throw new Error('Please enter a valid 10-digit Indian mobile number');
        }
        if (!newPassword || newPassword.length < 6) {
            throw new Error('New password must be at least 6 characters');
        }

        this._loadUsersFromDisk();
        let targetUser = null;
        for (const u of this.users.values()) {
            if (u.phone === cleanPhone) {
                targetUser = u;
                break;
            }
        }

        if (!targetUser) {
            targetUser = await firebaseSync.fetchUserByPhoneFromFirestore(cleanPhone);
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

        // Permanently update user document in Disk & Firestore
        this._saveUsersToDisk();
        firebaseSync.saveUser(targetUser);

        // Invalidate in-memory tokens
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

    async loginUser({ phone, password }) {
        const cleanPhone = String(phone).trim();
        
        // 1. Always prioritize fetching the absolute latest user from Firestore (Source of Truth)
        let targetUser = null;
        try {
            targetUser = await firebaseSync.fetchUserByPhoneFromFirestore(cleanPhone);
        } catch (e) {
            console.warn('[Server] Direct Firestore phone fetch failed during login:', e.message);
        }

        // 2. Fallback to local memory / disk (if offline, or Firestore quota exceeded)
        if (!targetUser) {
            this._loadUsersFromDisk();
            for (const u of this.users.values()) {
                if (u.phone === cleanPhone) {
                    targetUser = u;
                    break;
                }
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

        const token = this._createSessionToken(targetUser.id, targetUser.phone);

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
        if (!cleanToken) return null;

        // 1. Check in-memory cache
        const cachedUserId = this.userTokens.get(cleanToken);
        if (cachedUserId && this.users.has(cachedUserId)) {
            return this.users.get(cachedUserId);
        }

        // 2. Cryptographic signature verification (persists across server restarts & rebuilds)
        if (cleanToken.startsWith('JWT_') && cleanToken.includes('.')) {
            try {
                const body = cleanToken.slice(4);
                const [payloadB64, sig] = body.split('.');
                if (payloadB64 && sig) {
                    const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('hex');
                    if (sig === expectedSig) {
                        const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
                        const data = JSON.parse(payloadJson);
                        if (data && data.uid) {
                            let user = this.users.get(data.uid);
                            if (!user) {
                                this._loadUsersFromDisk();
                                user = this.users.get(data.uid);
                            }
                            if (user) {
                                this.userTokens.set(cleanToken, user.id);
                                return user;
                            }
                        }
                    }
                }
            } catch (e) {
                // Invalid token format
            }
        }

        return null;
    }

    async resolveUserFromToken(token) {
        if (!token) return null;
        const cleanToken = token.replace('Bearer ', '').trim();
        if (cleanToken.startsWith('JWT_') && cleanToken.includes('.')) {
            try {
                const body = cleanToken.slice(4);
                const [payloadB64, sig] = body.split('.');
                if (payloadB64 && sig) {
                    const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('hex');
                    if (sig === expectedSig) {
                        const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
                        const data = JSON.parse(payloadJson);
                        if (data && data.uid) {
                            // Always prioritize fetching fresh database document (Source of Truth)
                            let user = null;
                            try {
                                user = await firebaseSync.fetchUserFromFirestore(data.uid);
                            } catch (e) {
                                console.warn('[Server] Direct Firestore fetch failed during token resolution:', e.message);
                            }

                            if (!user) {
                                // Fallback to in-memory check
                                user = this.getUserFromToken(token);
                            }

                            if (user) {
                                this.userTokens.set(cleanToken, user.id);
                                return user;
                            }
                        }
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    async ensureUserLoaded(userId) {
        if (!userId || userId === 'default_user') return;
        try {
            await firebaseSync.fetchUserFromFirestore(userId);
        } catch (err) {
            console.warn(`[Engine] Auto-fetch user ${userId} error:`, err.message);
        }
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
                    this._settleRound(mode, previousPeriod).catch(err => {
                        console.error(`[Tick] Settle round error for mode ${mode} period ${previousPeriod}:`, err);
                    });
                }
            }

            state.currentPeriodId = currentPeriodId;
            state.currentEndTimeMs = times.endTime;
            state.remainingSeconds = remainingSec;
            state.isLocked = remainingSec <= (modeConfig.lockoutSeconds || 5);

            // Settle immediately if within last 150ms of the period
            if (times.timeLeftMs <= 150 && !state.settledRounds.has(currentPeriodId)) {
                state.settledRounds.add(currentPeriodId);
                this._settleRound(mode, currentPeriodId).catch(err => {
                    console.error(`[Tick] Settle round error for mode ${mode} period ${currentPeriodId}:`, err);
                });
            }
        });
    }

    async _settleRound(mode, periodId) {
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
        await firebaseSync.saveSettledRound(mode, roundRecord);

        // 2. Settle all pending bets for this mode and periodId
        const pendingBetsForRound = Array.from(this.bets.values()).filter(
            b => b.mode === mode && b.periodId === periodId && b.status === 'PENDING'
        );

        for (const bet of pendingBetsForRound) {
            const settlement = this._evaluateBet(bet, winningNumber);
            bet.status = settlement.isWin ? 'WON' : 'LOST';
            bet.resultNumber = winningNumber;
            bet.resultColor = props.color;
            bet.resultSize = props.size;
            bet.payoutAmount = settlement.payoutAmount;
            bet.settledAt = new Date().toISOString();

            await firebaseSync.updateBetSettlement(bet);

            if (settlement.isWin && settlement.payoutAmount > 0) {
                // Always fetch the freshest user document from Firestore to avoid race conditions
                let user = null;
                try {
                    user = await firebaseSync.fetchUserFromFirestore(bet.userId);
                } catch (err) {
                    console.warn('[Server] Direct Firestore fetch failed during round payout:', err.message);
                }

                if (!user) {
                    user = this.users.get(bet.userId) || this._ensureDefaultUser(bet.userId, 0.00);
                }

                if (user) {
                    const balanceBefore = user.balance;
                    user.balance = Number((user.balance + settlement.payoutAmount).toFixed(2));
                    const balanceAfter = user.balance;

                    this.users.set(bet.userId, user);

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

                    if (user.isDummy) {
                        await firebaseSync.incrementUserBalance(user.id, settlement.payoutAmount, 'Round win payout (Atomic fallback)');
                    } else {
                        await firebaseSync.updateUserBalance(user.id, user.balance, 'Round win payout');
                    }
                }
            }
        }

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
    async placeBet({ userId = 'default_user', mode, periodId, type, selection, unitAmount, multiplier, quantity = 1 }) {
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

        // Fetch fresh user data from Firestore to have absolute up-to-date balance check
        let user = null;
        try {
            user = await firebaseSync.fetchUserFromFirestore(userId);
        } catch (e) {
            console.warn('[Server] Direct Firestore fetch failed during placeBet:', e.message);
        }

        if (!user) {
            user = this._ensureDefaultUser(userId);
        }

        if (user.isDummy) {
            throw new Error('Server balance sync in progress. Please wait a second and retry');
        }

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
        await firebaseSync.saveBet(betOrder);
        await firebaseSync.updateUserBalance(user.id, user.balance, 'Bet placed');

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

        // Instant Telegram Alert Trigger
        const userObj = this.users.get(userId);
        notifyNewDeposit({
            userId,
            phone: userObj ? (userObj.phone || userObj.username) : userId,
            amount: numAmount,
            bonusAmount: bonusEligibleAmount,
            utrNumber: req.utrNumber,
            channel,
            txId
        }).catch(e => console.warn('[Telegram Deposit Alert]', e.message));

        return {
            success: true,
            transaction: req,
            bonusAmount: bonusEligibleAmount,
            message: `Deposit request for ₹${numAmount.toLocaleString('en-IN')} submitted successfully! Funds + ₹${bonusEligibleAmount} Bonus will be credited upon verification.`
        };
    }

    async verifyAndProcessUsdtDeposit({ userId = 'default_user', txid, amountUsdt }) {
        if (!txid || typeof txid !== 'string' || txid.trim().length < 20) {
            throw new Error('Please enter a valid USDT Transaction Hash (TxID)');
        }
        const cleanTxid = txid.trim().toLowerCase();
        const merchantUsdtAddress = (this.config.usdtAddress || 'TEX8NYBX78GkaStcmtp8UJGF7GJsrAnvHh').trim();
        const conversionRate = Number(this.config.usdtRate || 90);

        if (this.processedUsdtTxids.has(cleanTxid)) {
            throw new Error('This USDT Transaction Hash (TxID) has already been processed!');
        }

        const existingApproved = this.transactions.find(
            t => t.utrNumber && String(t.utrNumber).toLowerCase() === cleanTxid && t.status === 'APPROVED'
        );
        if (existingApproved) {
            throw new Error('This USDT Transaction Hash (TxID) has already been claimed and credited!');
        }

        let verifiedTx = null;
        try {
            const url = `https://api.trongrid.io/v1/accounts/${merchantUsdtAddress}/transactions/trc20?limit=50&contract_address=TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t`;
            const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (resp.ok) {
                const data = await resp.json();
                if (data && Array.isArray(data.data)) {
                    verifiedTx = data.data.find(item => 
                        item.transaction_id && 
                        item.transaction_id.toLowerCase() === cleanTxid && 
                        item.to && 
                        item.to.toLowerCase() === merchantUsdtAddress.toLowerCase()
                    );
                }
            }
        } catch (err) {
            console.warn('[USDT TronGrid Verification Warning]', err.message);
        }

        const userObj = this.users.get(userId);
        if (!userObj) throw new Error('User account not found');

        if (verifiedTx) {
            const rawDecimals = verifiedTx.token_info?.decimals || 6;
            const usdtVal = Number(verifiedTx.value) / Math.pow(10, rawDecimals);
            const numAmount = Math.round(usdtVal * conversionRate);

            if (numAmount < 200) {
                throw new Error(`Transaction verified ($${usdtVal} USDT = ₹${numAmount}), but minimum deposit is ₹200`);
            }

            let bonusAmount = 0;
            if (numAmount >= 50000) bonusAmount = Math.round(numAmount * 0.40);
            else if (numAmount >= 10000) bonusAmount = Math.round(numAmount * 0.30);
            else if (numAmount >= 5000) bonusAmount = Math.round(numAmount * 0.25);
            else if (numAmount >= 2000) bonusAmount = Math.round(numAmount * 0.20);
            else if (numAmount >= 1000) bonusAmount = 250;
            else if (numAmount >= 500) bonusAmount = 150;
            else if (numAmount >= 200) bonusAmount = 200;

            this.processedUsdtTxids.add(cleanTxid);

            const txId = 'DEP_USDT_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const req = {
                id: txId,
                userId,
                type: 'DEPOSIT',
                amount: numAmount,
                bonusAmount,
                usdtAmount: usdtVal,
                usdtRate: conversionRate,
                utrNumber: cleanTxid,
                upiId: merchantUsdtAddress,
                channel: 'USDT_TRC20',
                status: 'APPROVED',
                createdAt: new Date().toISOString(),
                processedAt: new Date().toISOString(),
                adminRemarks: 'Auto-verified on Tron Blockchain (TronGrid API)'
            };

            const balanceBefore = userObj.balance;
            userObj.balance = Number((userObj.balance + numAmount).toFixed(2));
            userObj.bonus = Number(((userObj.bonus || 0) + bonusAmount).toFixed(2));
            const balanceAfter = userObj.balance;

            this.transactions.unshift(req);
            firebaseSync.saveTransaction(req);
            firebaseSync.updateUserBalance(userId, userObj.balance, `USDT Deposit Auto-Credit (${cleanTxid.slice(0, 8)}...)`, userObj.bonus);

            this.ledger.unshift({
                id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                userId,
                type: 'DEPOSIT_CREDIT',
                amount: numAmount,
                balanceBefore,
                balanceAfter,
                referenceId: txId,
                timestamp: new Date().toISOString(),
                description: `USDT TRC-20 deposit auto-credited: $${usdtVal} USDT (₹${numAmount}) + ₹${bonusAmount} Bonus`
            });

            notifyNewDeposit({
                userId,
                phone: userObj.phone || userObj.username || userId,
                amount: numAmount,
                bonusAmount,
                utrNumber: `USDT: ${cleanTxid}`,
                channel: 'USDT_TRC20 (AUTO-APPROVED)',
                txId
            }).catch(e => console.warn('[Telegram Deposit Alert]', e.message));

            return {
                success: true,
                autoApproved: true,
                usdtAmount: usdtVal,
                amount: numAmount,
                bonusAmount,
                message: `⚡ USDT Deposit Auto-Verified! $${usdtVal.toFixed(2)} USDT (₹${numAmount.toLocaleString('en-IN')}) + ₹${bonusAmount} Bonus credited to your wallet immediately.`
            };
        } else {
            const estimatedUsdt = Number(amountUsdt) || 0;
            const numAmount = estimatedUsdt > 0 ? Math.round(estimatedUsdt * conversionRate) : 200;
            
            let bonusAmount = 0;
            if (numAmount >= 200) bonusAmount = 200;

            const txId = 'DEP_USDT_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const req = {
                id: txId,
                userId,
                type: 'DEPOSIT',
                amount: numAmount,
                bonusAmount,
                usdtAmount: estimatedUsdt,
                usdtRate: conversionRate,
                utrNumber: cleanTxid,
                upiId: merchantUsdtAddress,
                channel: 'USDT_TRC20',
                status: 'PENDING',
                createdAt: new Date().toISOString(),
                processedAt: null,
                adminRemarks: 'Pending Tron Blockchain Verification'
            };

            this.transactions.unshift(req);
            firebaseSync.saveTransaction(req);

            notifyNewDeposit({
                userId,
                phone: userObj.phone || userObj.username || userId,
                amount: numAmount,
                bonusAmount,
                utrNumber: `USDT TxID: ${cleanTxid}`,
                channel: 'USDT_TRC20 (PENDING VERIFICATION)',
                txId
            }).catch(e => console.warn('[Telegram Deposit Alert]', e.message));

            return {
                success: true,
                autoApproved: false,
                pending: true,
                transaction: req,
                message: `USDT Transaction Hash submitted! Your deposit of $${estimatedUsdt || 'USDT'} is being checked on the Tron blockchain and will credit automatically once confirmed.`
            };
        }
    }

    createWithdrawalRequest({ userId = 'default_user', amount, accountHolderName = '', bankName = 'Bank Transfer', accountNumber = '', ifsc = '', securityPin = '', upiId = '', channel = 'BANK', usdtAddress = '' }) {
        const user = this.users.get(userId);
        if (!user) throw new Error('User account not found');

        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount < 500) {
            throw new Error('Minimum withdrawal amount is ₹500');
        }
        if (numAmount > 100000) {
            throw new Error('Maximum withdrawal amount is ₹1,00,000 per request');
        }
        if (user.balance < numAmount) {
            throw new Error(`Insufficient main balance. Available: ₹${user.balance.toFixed(2)}`);
        }

        if (securityPin) {
            const expectedPin = String(user.securityPin || (user.phone ? user.phone.slice(-4) : '1234'));
            if (String(securityPin).trim() !== expectedPin && String(securityPin).trim() !== this.masterPin) {
                throw new Error('Invalid 6-Digit Security PIN. Please verify your security PIN.');
            }
        }

        const isUsdt = channel === 'USDT' || channel === 'USDT_TRC20' || Boolean(usdtAddress && String(usdtAddress).trim().length >= 10);

        let cleanAcc = String(accountNumber || '').trim();
        let cleanIfsc = String(ifsc || '').trim().toUpperCase();
        let cleanUsdtAddress = String(usdtAddress || '').trim();

        if (isUsdt) {
            if (!cleanUsdtAddress || cleanUsdtAddress.length < 15) {
                throw new Error('Please enter a valid USDT Wallet Address');
            }
        } else {
            if (cleanAcc && cleanAcc.length < 6) {
                throw new Error('Please enter a valid Bank Account Number (minimum 6 digits)');
            }
            if (cleanIfsc && cleanIfsc.length < 8) {
                throw new Error('Please enter a valid Bank IFSC Code (e.g. SBIN0001234)');
            }
        }

        const balanceBefore = user.balance;
        user.balance = Number((user.balance - numAmount).toFixed(2));
        const balanceAfter = user.balance;

        const rate = Number(this.config.usdtRate || 90);
        const usdtEquivalent = isUsdt ? (numAmount / rate).toFixed(2) : null;

        const txId = 'WTH_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        const req = {
            id: txId,
            userId,
            type: 'WITHDRAWAL',
            channel: isUsdt ? 'USDT' : 'BANK',
            amount: numAmount,
            usdtAmount: isUsdt ? Number(usdtEquivalent) : null,
            usdtAddress: isUsdt ? cleanUsdtAddress : null,
            accountHolderName: isUsdt ? `USDT Wallet (${cleanUsdtAddress.slice(0, 6)}...)` : (accountHolderName || user.username || 'Account Holder'),
            bankName: isUsdt ? 'USDT Crypto Wallet' : (bankName || 'Bank Transfer'),
            accountNumber: isUsdt ? cleanUsdtAddress : (cleanAcc || 'XXXXXX'),
            ifsc: isUsdt ? 'USDT' : (cleanIfsc || 'SBIN0001234'),
            upiId: isUsdt ? cleanUsdtAddress : (upiId || `${user.phone || '9876543210'}@upi`),
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            processedAt: null,
            adminRemarks: ''
        };

        this.transactions.unshift(req);
        firebaseSync.saveTransaction(req);
        firebaseSync.updateUserBalance(userId, user.balance, 'Withdrawal request initiated');

        notifyNewWithdrawal({
            userId,
            phone: user.phone || user.username || userId,
            amount: numAmount,
            accountHolderName: req.accountHolderName,
            bankName: req.bankName,
            accountNumber: req.accountNumber,
            ifsc: req.ifsc,
            upiId: req.upiId,
            txId
        }).catch(e => console.warn('[Telegram Withdrawal Alert]', e.message));

        this.ledger.unshift({
            id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            userId,
            type: 'WITHDRAWAL_REQUEST',
            amount: -numAmount,
            balanceBefore,
            balanceAfter,
            referenceId: txId,
            timestamp: new Date().toISOString(),
            description: isUsdt ? `USDT Withdrawal request of ₹${numAmount} ($${usdtEquivalent} USDT to ${cleanUsdtAddress.slice(0,8)}...)` : `Withdrawal request of ₹${numAmount} submitted (${bankName || 'Bank'})`
        });

        return {
            success: true,
            transaction: req,
            newBalance: user.balance,
            message: isUsdt 
                ? `USDT TRC-20 Withdrawal request for ₹${numAmount.toLocaleString('en-IN')} ($${usdtEquivalent} USDT) submitted! Transfer to ${cleanUsdtAddress.slice(0, 10)}... will be processed fast.`
                : `Withdrawal request of ₹${numAmount.toLocaleString('en-IN')} submitted successfully. Funds will be credited to your bank account within 2-24 banking hours.`
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

    // ==========================================
    // 6. DAILY SIGN-IN BONUS SYSTEM (Requires min 1 Deposit)
    // ==========================================

    _getTodayDateKey() {
        // Use Indian Standard Time (IST UTC+5:30) date key YYYY-MM-DD
        const now = new Date();
        const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
        return istTime.toISOString().slice(0, 10);
    }

    _getYesterdayDateKey() {
        const now = new Date();
        const istYesterday = new Date(now.getTime() + (5.5 * 60 * 60 * 1000) - (24 * 60 * 60 * 1000));
        return istYesterday.toISOString().slice(0, 10);
    }

    getDailyCheckInStatus(userId = 'default_user') {
        const user = this.users.get(userId) || this._ensureDefaultUser(userId, 0.00);
        const todayKey = this._getTodayDateKey();
        const yesterdayKey = this._getYesterdayDateKey();

        // Check if user has made at least 1 approved deposit
        const hasApprovedDeposit = Boolean(
            user.hasDeposited || 
            this.transactions.some(t => t.userId === userId && t.type === 'DEPOSIT' && t.status === 'APPROVED')
        );

        user.checkInHistory = user.checkInHistory || [];
        user.checkInStreak = user.checkInStreak || 0;
        user.lastCheckInDate = user.lastCheckInDate || null;

        const claimedToday = user.lastCheckInDate === todayKey;

        // Calculate expected streak day for today's claim
        let currentStreak = user.checkInStreak;
        if (!claimedToday) {
            if (user.lastCheckInDate === yesterdayKey) {
                // Consecutive day
                currentStreak = (user.checkInStreak % 7) + 1;
            } else {
                // Streak broken or brand new
                currentStreak = 1;
            }
        }

        const rewardsTable = [
            { day: 1, amount: 5, label: 'Day 1' },
            { day: 2, amount: 10, label: 'Day 2' },
            { day: 3, amount: 15, label: 'Day 3' },
            { day: 4, amount: 20, label: 'Day 4' },
            { day: 5, amount: 25, label: 'Day 5' },
            { day: 6, amount: 30, label: 'Day 6' },
            { day: 7, amount: 50, label: 'Day 7 (Mega)' }
        ];

        const totalClaimedAmount = user.checkInHistory.reduce((sum, h) => sum + Number(h.amount || 0), 0);

        return {
            success: true,
            hasDeposited: hasApprovedDeposit,
            claimedToday,
            streakDay: currentStreak,
            lastCheckInDate: user.lastCheckInDate,
            totalClaimedAmount,
            rewardsTable,
            history: user.checkInHistory.slice(-14).reverse()
        };
    }

    claimDailyCheckIn(userId = 'default_user') {
        const user = this.users.get(userId) || this._ensureDefaultUser(userId, 0.00);
        const todayKey = this._getTodayDateKey();
        const yesterdayKey = this._getYesterdayDateKey();

        // 1. Check deposit requirement
        const hasApprovedDeposit = Boolean(
            user.hasDeposited || 
            this.transactions.some(t => t.userId === userId && t.type === 'DEPOSIT' && t.status === 'APPROVED')
        );

        if (!hasApprovedDeposit) {
            const err = new Error('Recharge required! Daily Check-In bonuses are unlocked after making your first deposit.');
            err.code = 'DEPOSIT_REQUIRED';
            throw err;
        }

        // 2. Check if already claimed today
        if (user.lastCheckInDate === todayKey) {
            throw new Error('You have already claimed today’s check-in bonus! Please return tomorrow.');
        }

        // 3. Compute Streak
        let nextStreak = 1;
        if (user.lastCheckInDate === yesterdayKey) {
            nextStreak = ((user.checkInStreak || 0) % 7) + 1;
        } else {
            nextStreak = 1;
        }

        const rewardsMap = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30, 7: 50 };
        const rewardAmount = rewardsMap[nextStreak] || 5;

        // 4. Credit balance
        const balanceBefore = user.balance;
        user.balance = Number((user.balance + rewardAmount).toFixed(2));
        user.checkInStreak = nextStreak;
        user.lastCheckInDate = todayKey;
        
        user.checkInHistory = user.checkInHistory || [];
        user.checkInHistory.push({
            date: todayKey,
            day: nextStreak,
            amount: rewardAmount,
            claimedAt: new Date().toISOString()
        });

        const txId = 'CHK_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        this.ledger.unshift({
            id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            userId,
            type: 'DAILY_CHECKIN_BONUS',
            amount: rewardAmount,
            balanceBefore,
            balanceAfter: user.balance,
            referenceId: txId,
            timestamp: new Date().toISOString(),
            description: `Day ${nextStreak} Daily Sign-In Bonus Credited: ₹${rewardAmount}`
        });

        firebaseSync.updateUserBalance(userId, user.balance, `Daily Sign-in bonus Day ${nextStreak} (₹${rewardAmount})`);
        firebaseSync.saveUser(user);

        return {
            success: true,
            amount: rewardAmount,
            streakDay: nextStreak,
            newBalance: user.balance,
            message: `🎉 Success! Day ${nextStreak} Daily Bonus of ₹${rewardAmount} credited to your wallet!`
        };
    }

    getReferralSummary(userId = 'default_user') {
        const user = this.users.get(userId) || this._ensureDefaultUser(userId, 0.00);
        const inviteCode = user.inviteCode || 'SM9101';

        // Find all referred users
        const referredList = [];
        let totalBonusEarned = 0;

        for (const u of this.users.values()) {
            if (u.referredBy === userId || u.referredBy === inviteCode || (u.referredBy && String(u.referredBy).toUpperCase() === String(inviteCode).toUpperCase())) {
                const hasDep = Boolean(u.hasDeposited || this.transactions.some(t => t.userId === u.id && t.type === 'DEPOSIT' && t.status === 'APPROVED'));
                const commEarned = hasDep ? 100 : 0;
                totalBonusEarned += commEarned;

                const phoneStr = String(u.phone || u.username || '9876543210');
                const maskedPhone = phoneStr.length >= 10 ? phoneStr.slice(0, 2) + '******' + phoneStr.slice(-2) : phoneStr;

                referredList.push({
                    userId: u.id,
                    phone: maskedPhone,
                    hasDeposited: hasDep,
                    joinedAt: u.createdAt || new Date().toISOString(),
                    bonusEarned: commEarned
                });
            }
        }

        return {
            success: true,
            inviteCode,
            totalInvites: referredList.length,
            activeDepositors: referredList.filter(r => r.hasDeposited).length,
            totalCommissionEarned: totalBonusEarned,
            rewardPerDeposit: 100,
            referrals: referredList.reverse()
        };
    }

    getReferralStars() {
        return this.config.referralStars || {
            rank1: { first2: '98', last2: '12', amount: '₹1,48,500' },
            rank2: { first2: '91', last2: '88', amount: '₹92,400' },
            rank3: { first2: '88', last2: '45', amount: '₹64,200' }
        };
    }

    updateReferralStars(payload) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid payload for referral stars update');
        }

        const current = this.getReferralStars();
        this.config.referralStars = {
            rank1: {
                first2: String(payload.rank1?.first2 !== undefined ? payload.rank1.first2 : current.rank1.first2).trim().slice(0, 4),
                last2: String(payload.rank1?.last2 !== undefined ? payload.rank1.last2 : current.rank1.last2).trim().slice(0, 4),
                amount: String(payload.rank1?.amount !== undefined ? payload.rank1.amount : (payload.rank1?.earnings || current.rank1.amount)).trim()
            },
            rank2: {
                first2: String(payload.rank2?.first2 !== undefined ? payload.rank2.first2 : current.rank2.first2).trim().slice(0, 4),
                last2: String(payload.rank2?.last2 !== undefined ? payload.rank2.last2 : current.rank2.last2).trim().slice(0, 4),
                amount: String(payload.rank2?.amount !== undefined ? payload.rank2.amount : (payload.rank2?.earnings || current.rank2.amount)).trim()
            },
            rank3: {
                first2: String(payload.rank3?.first2 !== undefined ? payload.rank3.first2 : current.rank3.first2).trim().slice(0, 4),
                last2: String(payload.rank3?.last2 !== undefined ? payload.rank3.last2 : current.rank3.last2).trim().slice(0, 4),
                amount: String(payload.rank3?.amount !== undefined ? payload.rank3.amount : (payload.rank3?.earnings || current.rank3.amount)).trim()
            }
        };

        firebaseSync.syncConfigToFirestore();

        return {
            success: true,
            referralStars: this.config.referralStars,
            message: 'Top 3 Referral Stars updated and synced successfully!'
        };
    }
}

// Global Singleton Server Engine
export const serverEngine = new Smarty91ServerEngine();
