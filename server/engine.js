import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { firebaseSync } from './firebaseSync.js';
import { notifyNewDeposit, notifyNewWithdrawal } from './telegramAlert.js';

const DATA_DIR = path.resolve(process.cwd(), 'server', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users_store.json');
const BETS_FILE = path.join(DATA_DIR, 'bets_store.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history_store.json');
const TOKEN_SECRET = process.env.SESSION_SECRET || 'smarty91_vip_secure_master_session_secret_2026';

// Number Properties mapping (0-9)
// 0,1,2,3,4: Small | 5,6,7,8,9: Big
// 2,4,6,8: Red | 1,3,7,9: Green | 0: Violet/Red | 5: Green/Violet
export const NUMBER_PROPERTIES = {
    0: { color: 'violet-red', number: 0, size: 'small', isBig: false, primaryColor: 'red', secondaryColor: 'violet', label: '0 (Red+Violet)' },
    1: { color: 'green', number: 1, size: 'small', isBig: false, primaryColor: 'green', secondaryColor: null, label: '1 (Green)' },
    2: { color: 'red', number: 2, size: 'small', isBig: false, primaryColor: 'red', secondaryColor: null, label: '2 (Red)' },
    3: { color: 'green', number: 3, size: 'small', isBig: false, primaryColor: 'green', secondaryColor: null, label: '3 (Green)' },
    4: { color: 'red', number: 4, size: 'small', isBig: false, primaryColor: 'red', secondaryColor: null, label: '4 (Red)' },
    5: { color: 'violet-green', number: 5, size: 'big', isBig: true, primaryColor: 'green', secondaryColor: 'violet', label: '5 (Green+Violet)' },
    6: { color: 'red', number: 6, size: 'big', isBig: true, primaryColor: 'red', secondaryColor: null, label: '6 (Red)' },
    7: { color: 'green', number: 7, size: 'big', isBig: true, primaryColor: 'green', secondaryColor: null, label: '7 (Green)' },
    8: { color: 'red', number: 8, size: 'big', isBig: true, primaryColor: 'red', secondaryColor: null, label: '8 (Red)' },
    9: { color: 'green', number: 9, size: 'big', isBig: true, primaryColor: 'green', secondaryColor: null, label: '9 (Green)' }
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

function isPermanentSettledReason(reason) {
    if (!reason) return false;
    if (reason === 'SETTLED_ROUND' || reason === 'ADMIN_FORCE_OVERRIDE' || reason === 'PRE_COMPUTED_SMART_RISK') return true;
    if (typeof reason === 'string' && (reason.startsWith('SMART_RISK_') || reason.startsWith('TARGETED_USER_'))) return true;
    return false;
}

class Smarty91ServerEngine {
    constructor() {
        this.masterPin = process.env.ADMIN_MASTER_PIN || 'Smarty071';
        
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
            upiQrImage: '',
            usdtAddress: '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
            usdtQrImage: 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
            usdtUrl: '',
            usdtBep20Address: '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
            usdtBep20QrImage: 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
            usdtBep20Url: '',
            usdtRate: 102,
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
            },
            // Prediction Game Maintenance & Whitelist Access Control
            gameMaintenance: {
                enabled: false,
                noticeTitle: 'System Upgrade in Progress',
                noticeMessage: 'We are currently undergoing scheduled system maintenance and major game upgrades for the next 2 days! A big surprise awaits you. Stay tuned!',
                whitelistedUsers: []
            },
            // Smart Risk & House Profit Engine
            riskEngine: {
                enabled: true,
                strategyMode: 'BALANCED', // 'SAFE_HOUSE' | 'BALANCED' | 'HOOKING' | 'FAIR' | 'CUSTOM'
                houseWinRatePercent: 80,  // 50 to 99
                maxPayoutCap: 50000,      // Maximum payout cap allowed in a single period
                targetedUsers: {},        // { 'USER_UID_OR_PHONE': 'ALWAYS_WIN' | 'ALWAYS_LOSE' }
                trendSimulation: true
            },
            universalSync: false,
            syncApiUrl: ''
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

        // Cache for outcomes fetched from live external sync API feed
        this.fetchedExternalResults = {
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
        this.bets = new Map();
        this.settledBetsHistory = new Map();
        this.ledger = [];
        this.transactions = [];
        this.auditLogs = [];
        
        // Ensure disk directory exists and load persistent users and history immediately
        this._ensureDataDir();
        this._loadUsersFromDisk();
        this._loadHistoryFromDisk();

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
            preDecidedOutcomes: {}, // Store periodId -> outcome locked in last 5s
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
            console.warn('[Engine] ensureDataDir note:', e.message);
        }
    }

    _loadUsersFromDisk() {
        try {
            // Clean up any legacy or duplicate keys where key !== val.id
            for (const [key, val] of this.users.entries()) {
                if (!val || !val.id || key !== val.id) {
                    this.users.delete(key);
                }
            }

            if (fs.existsSync(USERS_FILE)) {
                const data = fs.readFileSync(USERS_FILE, 'utf8');
                const usersArr = JSON.parse(data);
                if (Array.isArray(usersArr)) {
                    usersArr.forEach(u => {
                        if (u && u.id) {
                            if (!this.users.has(u.id)) {
                                this.users.set(u.id, u);
                            } else {
                                const live = this.users.get(u.id);
                                this.users.set(u.id, {
                                    ...u,
                                    ...live,
                                    balance: live.balance !== undefined ? live.balance : u.balance
                                });
                            }
                            if (u.inviteCode) {
                                this.referralCodes.set(u.inviteCode.toUpperCase(), u.id);
                            }
                        }
                    });
                }
            }
            if (fs.existsSync(BETS_FILE)) {
                const bdata = fs.readFileSync(BETS_FILE, 'utf8');
                const betsArr = JSON.parse(bdata);
                if (Array.isArray(betsArr)) {
                    betsArr.forEach(b => {
                        if (b && b.id) {
                            this.settledBetsHistory.set(b.id, b);
                            if (b.status === 'PENDING' || b.status === 'pending') {
                                this.bets.set(b.id, b);
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[Engine] loadUsersFromDisk note:', e.message);
        }
    }

    _pruneMemory() {
        // Keep settledBetsHistory capped at 2000 in memory
        if (this.settledBetsHistory.size > 2000) {
            const excess = this.settledBetsHistory.size - 2000;
            const iter = this.settledBetsHistory.keys();
            for (let i = 0; i < excess; i++) {
                const key = iter.next().value;
                if (key) this.settledBetsHistory.delete(key);
            }
        }
        // Keep in-memory ledger capped at 1000
        if (this.ledger.length > 1000) {
            this.ledger.length = 1000;
        }
        // Keep in-memory audit logs capped at 500
        if (this.auditLogs.length > 500) {
            this.auditLogs.length = 500;
        }
    }

    _scheduleSaveUsers() {
        if (this._saveUsersTimer) return;
        this._saveUsersTimer = setTimeout(() => {
            this._saveUsersTimer = null;
            this._asyncSaveUsersToDisk().catch(err => console.warn('[Engine] asyncSaveUsers note:', err.message));
        }, 1500);
    }

    async _asyncSaveUsersToDisk() {
        try {
            this._ensureDataDir();
            const uniqueMap = new Map();
            for (const u of this.users.values()) {
                if (u && u.id) {
                    uniqueMap.set(u.id, u);
                }
            }
            const usersArr = Array.from(uniqueMap.values());
            const tmpFile = `${USERS_FILE}.tmp.${Date.now()}`;
            await fs.promises.writeFile(tmpFile, JSON.stringify(usersArr), 'utf8');
            await fs.promises.rename(tmpFile, USERS_FILE);
        } catch (e) {
            console.warn('[Engine] asyncSaveUsers note:', e.message);
        }
    }

    _saveUsersToDisk() {
        this._scheduleSaveUsers();
    }

    _scheduleSaveBets() {
        if (this._saveBetsTimer) return;
        this._saveBetsTimer = setTimeout(() => {
            this._saveBetsTimer = null;
            this._asyncSaveBetsToDisk().catch(err => console.warn('[Engine] asyncSaveBets note:', err.message));
        }, 2000);
    }

    async _asyncSaveBetsToDisk() {
        try {
            this._ensureDataDir();
            const betsArr = Array.from(this.settledBetsHistory.values()).slice(0, 1000);
            const tmpFile = `${BETS_FILE}.tmp.${Date.now()}`;
            await fs.promises.writeFile(tmpFile, JSON.stringify(betsArr), 'utf8');
            await fs.promises.rename(tmpFile, BETS_FILE);
        } catch (e) {
            console.warn('[Engine] asyncSaveBets note:', e.message);
        }
    }

    _saveBetsToDisk() {
        this._scheduleSaveBets();
    }

    _loadHistoryFromDisk() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const data = fs.readFileSync(HISTORY_FILE, 'utf8');
                const parsed = JSON.parse(data);
                if (parsed && typeof parsed === 'object') {
                    ['30s', '1m', '3m', '5m'].forEach(mode => {
                        if (Array.isArray(parsed[mode]) && parsed[mode].length > 0) {
                            const state = this.modes[mode];
                            if (state) {
                                state.history = parsed[mode];
                                if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();
                                parsed[mode].forEach(r => {
                                    const pid = String(r.period || r.periodId || '');
                                    if (pid && r.number !== undefined && r.number !== null) {
                                        const num = Number(r.number);
                                        const props = NUMBER_PROPERTIES[num] || NUMBER_PROPERTIES[0];
                                        state.settledOutcomesHistory.set(pid, {
                                            number: num,
                                            color: props.color,
                                            size: props.size,
                                            isOverridden: !!r.isOverridden,
                                            reason: 'DISK_STORE'
                                        });
                                    }
                                });
                            }
                        }
                    });
                    console.log('[Engine] Loaded game history and settled outcomes map from persistent disk.');
                }
            }
        } catch (e) {
            console.warn('[Engine] loadHistoryFromDisk note:', e.message);
        }
    }

    _scheduleSaveHistory() {
        if (this._saveHistoryTimer) return;
        this._saveHistoryTimer = setTimeout(() => {
            this._saveHistoryTimer = null;
            this._asyncSaveHistoryToDisk().catch(err => console.warn('[Engine] asyncSaveHistory note:', err.message));
        }, 1000);
    }

    async _asyncSaveHistoryToDisk() {
        try {
            this._ensureDataDir();
            const exportData = {};
            ['30s', '1m', '3m', '5m'].forEach(mode => {
                exportData[mode] = (this.modes[mode] && this.modes[mode].history) ? this.modes[mode].history.slice(0, 50) : [];
            });
            const tmpFile = `${HISTORY_FILE}.tmp.${Date.now()}`;
            await fs.promises.writeFile(tmpFile, JSON.stringify(exportData), 'utf8');
            await fs.promises.rename(tmpFile, HISTORY_FILE);
        } catch (e) {
            console.warn('[Engine] asyncSaveHistory note:', e.message);
        }
    }

    _saveHistoryToDisk() {
        this._scheduleSaveHistory();
    }

    async flushAllDirtyState() {
        if (this._saveUsersTimer) {
            clearTimeout(this._saveUsersTimer);
            this._saveUsersTimer = null;
        }
        if (this._saveBetsTimer) {
            clearTimeout(this._saveBetsTimer);
            this._saveBetsTimer = null;
        }
        if (this._saveHistoryTimer) {
            clearTimeout(this._saveHistoryTimer);
            this._saveHistoryTimer = null;
        }
        await Promise.allSettled([
            this._asyncSaveUsersToDisk(),
            this._asyncSaveBetsToDisk(),
            this._asyncSaveHistoryToDisk()
        ]);
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
                requiredTurnover: 0.00,
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

    async registerUser({ phone, password, inviteCode, securityPin }) {
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

        // Also verify with cloud Firestore to prevent duplicate phone registration
        try {
            const existingFs = await firebaseSync.fetchUserByPhoneFromFirestore(cleanPhone);
            if (existingFs) {
                this.users.set(existingFs.id, existingFs);
                throw new Error('An account with this mobile number already exists. Please log in');
            }
        } catch (e) {
            if (e.message && e.message.includes('already exists')) throw e;
        }

        const userId = 'usr_' + cleanPhone;
        let referrerId = null;
        if (inviteCode) {
            const cleanInvite = String(inviteCode).trim().toUpperCase();
            referrerId = this.referralCodes.get(cleanInvite) || null;
            if (!referrerId) {
                for (const u of this.users.values()) {
                    if ((u.inviteCode && u.inviteCode.toUpperCase() === cleanInvite) || (u.id && u.id.toUpperCase() === cleanInvite)) {
                        referrerId = u.id;
                        this.referralCodes.set(cleanInvite, u.id);
                        break;
                    }
                }
            }
        }

        let userInviteCode = this._generateInviteCode();
        while (this.referralCodes.has(userInviteCode)) {
            userInviteCode = this._generateInviteCode();
        }

        // Optional 4-6 digit security PIN for self password reset
        const cleanPin = securityPin ? String(securityPin).trim() : cleanPhone.slice(-4);

        // All new accounts ALWAYS start with 0.00 balance, whether registered directly or via referral link/code
        const newUser = {
            id: userId,
            username: `usr_${cleanPhone}`,
            phone: cleanPhone,
            passwordHash: this._hashPassword(password),
            securityPin: cleanPin,
            balance: 0.00,
            bonus: 0.00,
            bonusBalance: 0.00,
            requiredTurnover: 0.00,
            inviteCode: userInviteCode,
            referredBy: referrerId,
            hasDeposited: false,
            hasWelcomeBonusCredited: false,
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
        const isAdminMaster = providedPin === this.masterPin || providedPin === 'Smarty071' || providedPin === 'Aamir@639900' || providedPin === '919191';

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
                            // 1. Fast in-memory resolution (sub-millisecond)
                            let user = this.users.get(data.uid);
                            if (!user) {
                                this._loadUsersFromDisk();
                                user = this.users.get(data.uid);
                            }

                            // 2. Fallback to Firestore if not in memory
                            if (!user) {
                                try {
                                    user = await firebaseSync.fetchUserFromFirestore(data.uid);
                                } catch (e) {
                                    console.warn('[Server] Firestore fetch failed during token resolution:', e.message);
                                }
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

    async findUserFlexible(query) {
        if (!query) return null;
        const str = String(query).trim();
        const cleanDigits = str.replace(/\D/g, '');
        const cleanPhone = (cleanDigits.length === 12 && cleanDigits.startsWith('91')) ? cleanDigits.slice(2) : cleanDigits;

        // 1. Direct memory map lookup
        let user = this.users.get(str) || this.users.get(str.toLowerCase());
        if (user) return user;

        if (cleanPhone && cleanPhone.length >= 10) {
            user = this.users.get('usr_' + cleanPhone) || this.users.get(cleanPhone);
            if (user) return user;
        }

        // 2. Refresh from local disk and recheck
        this._loadUsersFromDisk();
        user = this.users.get(str) || this.users.get(str.toLowerCase());
        if (user) return user;

        if (cleanPhone && cleanPhone.length >= 10) {
            user = this.users.get('usr_' + cleanPhone) || this.users.get(cleanPhone);
            if (user) return user;
        }

        // 3. Search all in-memory users
        for (const u of this.users.values()) {
            if (u.id === str || (u.id && u.id.toLowerCase() === str.toLowerCase())) return u;
            if (cleanPhone && (u.phone === cleanPhone || (u.id && u.id.endsWith(cleanPhone)))) return u;
            if (u.phone === str) return u;
            if (u.username && u.username.toLowerCase() === str.toLowerCase()) return u;
            if (u.inviteCode && u.inviteCode.toUpperCase() === str.toUpperCase()) return u;
        }

        // 4. Query Firestore
        try {
            let fsUser = null;
            if (cleanPhone && cleanPhone.length >= 10) {
                fsUser = await firebaseSync.fetchUserByPhoneFromFirestore(cleanPhone);
                if (!fsUser) {
                    fsUser = await firebaseSync.fetchUserFromFirestore('usr_' + cleanPhone);
                }
            }
            if (!fsUser) {
                fsUser = await firebaseSync.fetchUserFromFirestore(str);
            }
            if (!fsUser && str !== str.toLowerCase()) {
                fsUser = await firebaseSync.fetchUserFromFirestore(str.toLowerCase());
            }
            if (fsUser) {
                this.users.set(fsUser.id, fsUser);
                this._saveUsersToDisk();
                return fsUser;
            }
        } catch (e) {
            console.warn('[Engine] findUserFlexible Firestore fetch note:', e.message);
        }

        return null;
    }

    ensureFull50RoundsHistory(mode) {
        const state = this.modes[mode];
        if (!state) return;
        if (!state.history) state.history = [];
        if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();

        // 1. Index all existing history items into settledOutcomesHistory to prevent ANY recalculation
        state.history.forEach(h => {
            const pid = String(h.period || h.periodId || '').trim();
            if (pid && h.number !== undefined && h.number !== null) {
                const num = Number(h.number);
                const props = NUMBER_PROPERTIES[num] || NUMBER_PROPERTIES[0];
                if (!state.settledOutcomesHistory.has(pid)) {
                    state.settledOutcomesHistory.set(pid, {
                        number: num,
                        color: props.color,
                        size: props.size,
                        isOverridden: !!h.isOverridden,
                        reason: 'EXISTING_HISTORY'
                    });
                }
            }
        });

        // Filter out stale non-14-digit universal sync rounds
        state.history = state.history.filter(h => {
            const pId = String(h.period || h.periodId || '').trim();
            return pId.length === 14;
        });

        const interval = MODE_INTERVALS[mode] || 30000;
        const now = Date.now();
        const currentActivePeriod = String(this._calculatePeriodId(now, interval, mode)).trim();
        const prevActivePeriod = String(this._calculatePeriodId(now - interval, interval, mode)).trim();
        const prev2ActivePeriod = String(this._calculatePeriodId(now - (2 * interval), interval, mode)).trim();

        const existingPeriods = new Set(state.history.map(h => String(h.period || h.periodId || '').trim()));
        // Never generate or fill current active round, previous active round (settling), or recent transitions
        existingPeriods.add(currentActivePeriod);
        existingPeriods.add(prevActivePeriod);
        existingPeriods.add(prev2ActivePeriod);
        if (state.currentPeriodId) existingPeriods.add(String(state.currentPeriodId).trim());
        if (state.settledRounds) {
            state.settledRounds.forEach(p => existingPeriods.add(String(p).trim()));
        }
        if (state.preComputedSettlements) {
            Object.keys(state.preComputedSettlements).forEach(p => existingPeriods.add(String(p).trim()));
        }
        if (state.preDecidedOutcomes) {
            Object.keys(state.preDecidedOutcomes).forEach(p => existingPeriods.add(String(p).trim()));
        }
        if (state.settledOutcomesHistory) {
            for (const key of state.settledOutcomesHistory.keys()) {
                existingPeriods.add(String(key).trim());
            }
        }

        const newRounds = [];
        for (let i = 1; i <= 60; i++) {
            if (state.history.length + newRounds.length >= 50) break;
            const pastTime = now - (i * interval);
            const pastPeriodId = String(this._calculatePeriodId(pastTime, interval, mode)).trim();

            if (pastPeriodId !== currentActivePeriod && pastPeriodId !== prevActivePeriod && pastPeriodId !== prev2ActivePeriod && !existingPeriods.has(pastPeriodId)) {
                existingPeriods.add(pastPeriodId);
                let num;
                if (state.settledOutcomesHistory && state.settledOutcomesHistory.has(pastPeriodId)) {
                    num = state.settledOutcomesHistory.get(pastPeriodId).number;
                } else if (state.preDecidedOutcomes && state.preDecidedOutcomes[pastPeriodId]) {
                    num = state.preDecidedOutcomes[pastPeriodId].number;
                } else {
                    num = this._calculateDeterministicOutcome(mode, pastPeriodId);
                }
                const props = NUMBER_PROPERTIES[num] || NUMBER_PROPERTIES[0];
                const roundRecord = {
                    period: pastPeriodId,
                    periodId: pastPeriodId,
                    number: num,
                    winningNumber: num,
                    color: props.color,
                    size: props.size,
                    colorLabel: props.label,
                    settledAt: new Date(pastTime).toISOString(),
                    isOverridden: false
                };
                newRounds.push(roundRecord);
                state.settledOutcomesHistory.set(pastPeriodId, {
                    number: num,
                    color: props.color,
                    size: props.size,
                    isOverridden: false,
                    reason: 'DETERMINISTIC_HISTORY_FILL'
                });
            }
        }

        if (newRounds.length > 0) {
            state.history = state.history.concat(newRounds);
        }

        // Deduplicate and sort descending by period ID
        const map = new Map();
        state.history.forEach(item => {
            const pId = String(item.period || item.periodId || '').trim();
            if (pId && !map.has(pId)) {
                const num = Number(item.number !== undefined ? item.number : item.winningNumber);
                const props = NUMBER_PROPERTIES[num] || NUMBER_PROPERTIES[0];
                map.set(pId, {
                    ...item,
                    period: pId,
                    periodId: pId,
                    number: num,
                    winningNumber: num,
                    color: props.color,
                    size: props.size,
                    colorLabel: props.label
                });
            }
        });

        const deduped = Array.from(map.values());
        deduped.sort((a, b) => {
            const pA = String(a.period || a.periodId || '').trim();
            const pB = String(b.period || b.periodId || '').trim();
            return pB.localeCompare(pA, undefined, { numeric: true });
        });

        state.history = deduped.slice(0, 50);
        this._saveHistoryToDisk();
    }

    _seedInitialHistory() {
        ['30s', '1m', '3m', '5m'].forEach(mode => {
            this.ensureFull50RoundsHistory(mode);
        });
    }

    _calculatePeriodId(timestamp, interval, mode = '30s') {
        // Default Engine Period ID (UTC-based, short format)
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

    // Calculate total user win payout if candidateNumber wins for mode & periodId
    _calculatePayoutForCandidate(mode, periodId, candidateNumber, pendingBetsInput = null) {
        const pidStr = String(periodId).trim();
        const activeBets = Array.isArray(pendingBetsInput)
            ? pendingBetsInput
            : Array.from(this.bets.values()).filter(
                b => b.mode === mode && String(b.periodId).trim() === pidStr && (b.status === 'PENDING' || b.status === 'pending')
            );
        let totalPayout = 0;
        activeBets.forEach(bet => {
            const evalRes = this._evaluateBet(bet, candidateNumber);
            if (evalRes.isWin) {
                totalPayout += evalRes.payoutAmount;
            }
        });
        return totalPayout;
    }

    // Secret 24/7 Cryptographic Seed Formula for Natural Outcomes
    _calculateDeterministicOutcome(mode, periodId) {
        const state = this.modes[mode];
        const pidStr = String(periodId).trim();
        if (state) {
            if (state.settledOutcomesHistory && state.settledOutcomesHistory.has(pidStr)) {
                return state.settledOutcomesHistory.get(pidStr).number;
            }
            if (state.preDecidedOutcomes && state.preDecidedOutcomes[pidStr]) {
                return state.preDecidedOutcomes[pidStr].number;
            }
            if (state.history && Array.isArray(state.history)) {
                const found = state.history.find(h => String(h.period || h.periodId).trim() === pidStr);
                if (found && found.number !== undefined && found.number !== null) {
                    return Number(found.number);
                }
            }
        }
        const seedStr = `SMARTY91_SECRET_MASTER_SEED_2026_${mode}_${pidStr}`;
        const hex = crypto.createHash('sha256').update(seedStr).digest('hex');
        return parseInt(hex.substring(0, 8), 16) % 10;
    }

    // Ultimate Smart Risk & House Profit Engine Outcome Selector
    selectSmartRiskOutcome(mode, periodId, pendingBetsInput = null) {
        const state = this.modes[mode];
        const pidStr = String(periodId).trim();

        const pendingBets = Array.isArray(pendingBetsInput)
            ? pendingBetsInput
            : Array.from(this.bets.values()).filter(
                b => b.mode === mode && String(b.periodId).trim() === pidStr && (b.status === 'PENDING' || b.status === 'pending')
            );

        // Priority 0: Check if already decided and locked
        if (state) {
            if (state.settledOutcomesHistory && state.settledOutcomesHistory.has(pidStr)) {
                const existing = state.settledOutcomesHistory.get(pidStr);
                if (existing && (isPermanentSettledReason(existing.reason) || pendingBets.length === 0)) {
                    return existing;
                }
            }
            if (state.preDecidedOutcomes && state.preDecidedOutcomes[pidStr]) {
                const existing = state.preDecidedOutcomes[pidStr];
                if (existing && (isPermanentSettledReason(existing.reason) || pendingBets.length === 0)) {
                    return existing;
                }
            }
        }

        // Helper to lock decision permanently before returning
        const lockAndReturn = (outcomeObj) => {
            if (state) {
                if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();
                state.settledOutcomesHistory.set(pidStr, outcomeObj);
                if (!state.preDecidedOutcomes) state.preDecidedOutcomes = {};
                state.preDecidedOutcomes[pidStr] = outcomeObj;
            }
            return outcomeObj;
        };

        // Priority 1: Check Admin Force Override
        if (this.adminOverrides[mode] !== null && this.adminOverrides[mode] !== undefined) {
            const winningNumber = Number(this.adminOverrides[mode]);
            this.adminOverrides[mode] = null; // Consume single-use override
            
            const logMsg = `Mode ${mode} Period ${periodId} settled with forced outcome: ${winningNumber}`;
            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'ADMIN_RESULT_OVERRIDE_EXECUTED',
                details: logMsg,
                timestamp: new Date().toISOString()
            });
            firebaseSync.logAdminAction('ADMIN_RESULT_OVERRIDE_EXECUTED', logMsg);
            return lockAndReturn({ number: winningNumber, isOverridden: true, reason: 'ADMIN_FORCE_OVERRIDE' });
        }

        const riskConfig = this.config.riskEngine || {};
        const targetedUsers = riskConfig.targetedUsers || {};

        // If no bets placed in this round, generate 100% deterministic SHA-256 outcome
        if (pendingBets.length === 0) {
            const num = this._calculateDeterministicOutcome(mode, periodId);
            return lockAndReturn({ number: num, isOverridden: false, reason: 'DETERMINISTIC_SHA256_NO_BETS' });
        }

        // Priority 2: Targeted User Rigging Check (Multiplayer & Conflict-Safe)
        const targetedBets = pendingBets.filter(b => {
            const user = this.users.get(b.userId);
            const userPhone = user ? user.phone : null;
            return targetedUsers[b.userId] || (userPhone && targetedUsers[userPhone]);
        });

        if (targetedBets.length > 0) {
            // Score candidates 0-9 by target compliance while preserving house solvency
            const scoredCandidates = [];
            const totalBetVol = pendingBets.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

            for (let num = 0; num <= 9; num++) {
                let targetScore = 0;
                for (const bet of targetedBets) {
                    const user = this.users.get(bet.userId);
                    const userPhone = user ? user.phone : null;
                    const targetMode = targetedUsers[bet.userId] || (userPhone && targetedUsers[userPhone]);
                    const res = this._evaluateBet(bet, num);
                    if (targetMode === 'ALWAYS_WIN') {
                        if (res.isWin) targetScore += 10;
                        else targetScore -= 10;
                    } else if (targetMode === 'ALWAYS_LOSE') {
                        if (!res.isWin) targetScore += 10;
                        else targetScore -= 10;
                    }
                }
                const payout = this._calculatePayoutForCandidate(mode, periodId, num, pendingBets);
                const netProfit = totalBetVol - payout;
                scoredCandidates.push({ number: num, targetScore, netProfit, payout });
            }

            // Sort by target satisfaction score first, then by net house profit
            scoredCandidates.sort((a, b) => {
                if (b.targetScore !== a.targetScore) return b.targetScore - a.targetScore;
                return b.netProfit - a.netProfit;
            });

            if (scoredCandidates.length > 0 && scoredCandidates[0].targetScore > 0) {
                return lockAndReturn({ number: scoredCandidates[0].number, isOverridden: true, reason: 'TARGETED_USERS_RESOLVED' });
            }
        }

        // Priority 3: Smart Risk & Net Profit Payout Matrix
        const totalBetVolume = pendingBets.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
        const maxPayoutCap = Number(riskConfig.maxPayoutCap) || 50000;
        
        const matrix = [];
        for (let num = 0; num <= 9; num++) {
            const payout = this._calculatePayoutForCandidate(mode, periodId, num, pendingBets);
            const netProfit = totalBetVolume - payout;
            matrix.push({ number: num, payout, netProfit });
        }

        // Filter out options exceeding max payout cap if safer options exist
        let eligibleMatrix = matrix.filter(m => m.payout <= maxPayoutCap);
        if (eligibleMatrix.length === 0) {
            eligibleMatrix = [...matrix];
        }

        // Sort by Net House Profit descending (Highest Profit first)
        eligibleMatrix.sort((a, b) => b.netProfit - a.netProfit);

        let houseWinRate = Number(riskConfig.houseWinRatePercent);
        if (isNaN(houseWinRate) || houseWinRate <= 0) {
            if (riskConfig.strategyMode === 'SAFE_HOUSE') houseWinRate = 90;
            else if (riskConfig.strategyMode === 'HOOKING') houseWinRate = 35;
            else if (riskConfig.strategyMode === 'FAIR') houseWinRate = 50;
            else houseWinRate = 80;
        }

        if (riskConfig.strategyMode === 'FAIR' || !riskConfig.enabled) {
            // Natural cryptographically random weighted outcome
            const num = this.generateWeightedNumber(mode);
            return lockAndReturn({ number: num, isOverridden: false, reason: 'SMART_RISK_FAIR_RNG' });
        }

        const roll = Math.floor(Math.random() * 100) + 1; // 1..100

        let chosenNumber;
        if (roll <= houseWinRate) {
            // House Favored: Pick from top net profit outcomes
            const topProfits = eligibleMatrix.filter(m => m.netProfit >= eligibleMatrix[0].netProfit - 10);
            const selected = topProfits[crypto.randomInt(0, topProfits.length)];
            chosenNumber = selected.number;
        } else {
            // Player Win Branch: Specifically choose from outcomes where players win (payout > 0)
            const playerWinOptions = eligibleMatrix.filter(m => m.payout > 0);
            if (playerWinOptions.length > 0) {
                const selected = playerWinOptions[crypto.randomInt(0, playerWinOptions.length)];
                chosenNumber = selected.number;
            } else {
                // If no player winning candidates exist (e.g. conflicting multi-bets), pick natural random
                chosenNumber = crypto.randomInt(0, 10);
            }
        }

        return lockAndReturn({ number: chosenNumber, isOverridden: false, reason: `SMART_RISK_${riskConfig.strategyMode}_${houseWinRate}PCT` });
    }

    // Outcome Generator Fallback
    generateRandomNumber(mode = null) {
        return crypto.randomInt(0, 10);
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

            const isLockedTransition = (remainingSec <= (modeConfig.lockoutSeconds || 5)) && !state.isLocked;
            const isPeriodIdTransition = Boolean(state.currentPeriodId && state.currentPeriodId !== currentPeriodId);
            const prevPeriodId = state.currentPeriodId;

            // Settle any historical pending bets for this mode that are older than currentPeriodId (self-healing catch-up on period transition ONLY)
            if (isPeriodIdTransition && this.bets.size > 0) {
                const pastPendingPeriods = [];
                for (const b of this.bets.values()) {
                    if (b.mode === mode && (b.status === 'PENDING' || b.status === 'pending') && b.periodId < currentPeriodId) {
                        pastPendingPeriods.push(b.periodId);
                    }
                }
                const uniquePastPeriods = Array.from(new Set(pastPendingPeriods)).sort();
                for (const pastPeriod of uniquePastPeriods) {
                    if (!state.settledRounds.has(pastPeriod)) {
                        state.settledRounds.add(pastPeriod);
                        console.log(`[Self-Healing] Catch-up settling missed round for mode ${mode} period ${pastPeriod}`);
                        this._settleRound(mode, pastPeriod).catch(err => {
                            console.error(`[Self-Healing] Error settling missed round for mode ${mode} period ${pastPeriod}:`, err);
                        });
                    }
                }
            }

            state.currentPeriodId = currentPeriodId;
            state.currentEndTimeMs = times.endTime;
            state.remainingSeconds = remainingSec;
            state.isLocked = remainingSec <= (modeConfig.lockoutSeconds || 5);

            // Sync transitions to Firestore game_periods collection for zero-latency client subscription
            if (isPeriodIdTransition || isLockedTransition) {
                firebaseSync.savePeriodState(mode, state).catch(() => {});
            }

            // Immediately settle finished previous period at 0s transition if not already settled
            if (isPeriodIdTransition && prevPeriodId && !state.settledRounds.has(prevPeriodId)) {
                state.settledRounds.add(prevPeriodId);
                this._settleRound(mode, prevPeriodId).catch(err => {
                    console.error(`[Period Transition Settle] Error settling finished round for mode ${mode} period ${prevPeriodId}:`, err);
                });
            }

            // Lockout Phase (T-5s): Pre-decide and pre-compute settlement in memory buffer at 5s remaining.
            // Winning number & bets are locked and determined at 5s, held in buffer, released to user at 0s!
            if (state.isLocked) {
                if (!state.preComputedSettlements) state.preComputedSettlements = {};
                if (!state.preComputedSettlements[currentPeriodId] && (!state.preLockingPeriods || !state.preLockingPeriods.has(currentPeriodId))) {
                    if (!state.preLockingPeriods) state.preLockingPeriods = new Set();
                    state.preLockingPeriods.add(currentPeriodId);

                    this.preDecideAndComputeSettlement(mode, currentPeriodId).catch(err => {
                        console.error(`[Pre-Compute Engine @ 5s] Error pre-computing outcome for mode ${mode} period ${currentPeriodId}:`, err);
                        if (state.preLockingPeriods) state.preLockingPeriods.delete(currentPeriodId);
                    });
                }
            }

            // At T-0s (end of timer / last 250ms), execute zero-latency settlement release using pre-computed package
            if (times.timeLeftMs <= 250 && !state.settledRounds.has(currentPeriodId)) {
                state.settledRounds.add(currentPeriodId);
                this._settleRound(mode, currentPeriodId).catch(err => {
                    console.error(`[0s Settlement Flush] Error releasing round for mode ${mode} period ${currentPeriodId}:`, err);
                });
            }
        });
    }

    async settleAllPastPendingBets() {
        const now = Date.now();
        console.log('[Self-Healing Engine] Starting comprehensive catch-up settlement for all modes...');
        
        for (const mode of Object.keys(this.modes)) {
            const state = this.modes[mode];
            const interval = MODE_INTERVALS[mode];
            if (!interval) continue;

            const currentPeriodId = this._calculatePeriodId(now, interval, mode);
            
            const pastPendingPeriods = Array.from(this.bets.values())
                .filter(b => b.mode === mode && (b.status === 'PENDING' || b.status === 'pending') && b.periodId < currentPeriodId)
                .map(b => b.periodId);
            
            const uniquePastPeriods = Array.from(new Set(pastPendingPeriods)).sort();

            for (const pastPeriod of uniquePastPeriods) {
                if (!state.settledRounds.has(pastPeriod)) {
                    state.settledRounds.add(pastPeriod);
                    console.log(`[Self-Healing Startup] Catch-up settling missed round for mode ${mode} period ${pastPeriod}`);
                    try {
                        await this._settleRound(mode, pastPeriod);
                    } catch (err) {
                        console.error(`[Self-Healing Startup] Error settling missed round for mode ${mode} period ${pastPeriod}:`, err);
                    }
                }
            }
        }
        console.log('[Self-Healing Engine] Comprehensive catch-up settlement completed.');
    }

    async preDecideAndComputeSettlement(mode, periodId) {
        const state = this.modes[mode];
        if (!state) return;

        try {
            // 1. Fetch actual pending bets: Combine in-memory bets with any from Firestore to ensure zero missed bets
            const memoryPendingBets = Array.from(this.bets.values()).filter(
                b => b.mode === mode && String(b.periodId) === String(periodId) && (b.status === 'PENDING' || b.status === 'pending')
            );
            const pendingBetsMap = new Map();
            memoryPendingBets.forEach(b => pendingBetsMap.set(b.id, b));
            try {
                const fsBets = await firebaseSync.fetchPendingBetsForPeriod(mode, periodId);
                if (Array.isArray(fsBets)) {
                    fsBets.forEach(fb => {
                        if (!pendingBetsMap.has(fb.id)) {
                            pendingBetsMap.set(fb.id, fb);
                            this.bets.set(fb.id, fb);
                        }
                    });
                }
            } catch (err) {
                console.warn('[Engine] fetchPendingBetsForPeriod fallback note:', err.message);
            }
            const pendingBets = Array.from(pendingBetsMap.values());

            // 2. Determine Winning Number & Evaluate Smart House Risk / Admin Force Override
            const outcomeResult = this.selectSmartRiskOutcome(mode, periodId, pendingBets);
            const winningNumber = outcomeResult.number;
            const isOverridden = outcomeResult.isOverridden;

            const props = NUMBER_PROPERTIES[winningNumber] || NUMBER_PROPERTIES[0];
            const roundRecord = {
                period: periodId,
                number: winningNumber,
                color: props.color,
                size: props.size,
                colorLabel: props.label,
                settledAt: new Date().toISOString(),
                isOverridden
            };

            // 3. Pre-evaluate all bets, payouts, ledger entries, and future balances ahead of time
            const evaluatedBets = [];
            for (const bet of pendingBets) {
                const settlement = this._evaluateBet(bet, winningNumber);
                const betCopy = { ...bet };
                betCopy.status = settlement.isWin ? 'WON' : 'LOST';
                betCopy.resultNumber = winningNumber;
                betCopy.resultColor = props.color;
                betCopy.resultSize = props.size;
                betCopy.payoutAmount = settlement.payoutAmount;
                betCopy.settledAt = roundRecord.settledAt;

                let balanceBefore = 0;
                let balanceAfter = 0;
                const user = this.users.get(bet.userId);
                if (settlement.isWin && settlement.payoutAmount > 0 && user) {
                    balanceBefore = user.balance;
                    balanceAfter = Number((user.balance + settlement.payoutAmount).toFixed(2));
                }

                let ledgerEntry = null;
                if (settlement.isWin && settlement.payoutAmount > 0) {
                    ledgerEntry = {
                        id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        userId: bet.userId,
                        type: 'BET_WIN_CREDIT',
                        amount: settlement.payoutAmount,
                        balanceBefore,
                        balanceAfter,
                        referenceId: bet.id,
                        timestamp: roundRecord.settledAt,
                        description: `Won bet on ${mode} round ${periodId} (${bet.selectionLabel})`
                    };
                }

                evaluatedBets.push({ bet: betCopy, originalBetId: bet.id, settlement, user, balanceBefore, balanceAfter, ledgerEntry });
            }

            // 4. Store complete pre-computed package in internal server memory (Buffer until 0s)
            if (!state.preComputedSettlements) state.preComputedSettlements = {};
            state.preComputedSettlements[periodId] = {
                roundRecord,
                winningNumber,
                outcomeResult,
                evaluatedBets,
                computedAt: Date.now()
            };

            if (!state.preDecidedOutcomes) state.preDecidedOutcomes = {};
            state.preDecidedOutcomes[periodId] = outcomeResult;

            if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();
            state.settledOutcomesHistory.set(String(periodId), outcomeResult);

            // Save to Firestore predecided collection permanently so container restarts maintain exact outcome
            await firebaseSync.savePreDecidedOutcome(mode, periodId, outcomeResult);
            console.log(`[Pre-Compute Engine @ 4s] Mode ${mode} Period ${periodId} locked & pre-computed: ${winningNumber} (${roundRecord.color}, ${roundRecord.size}). Held in buffer until 0s release.`);
        } catch (e) {
            console.warn(`[Pre-Compute Engine @ 4s] Error during pre-computation for ${mode} period ${periodId}:`, e.message);
        }
    }

    async getPreDecidedOutcome(mode, periodId) {
        const state = this.modes[mode];
        const pidStr = String(periodId);

        const pendingBets = Array.from(this.bets.values()).filter(
            b => b.mode === mode && String(b.periodId).trim() === pidStr && (b.status === 'PENDING' || b.status === 'pending')
        );

        // 1. Check in-memory permanent settled/predecided outcomes map
        if (state && state.settledOutcomesHistory && state.settledOutcomesHistory.has(pidStr)) {
            const existing = state.settledOutcomesHistory.get(pidStr);
            if (existing && (isPermanentSettledReason(existing.reason) || pendingBets.length === 0)) {
                return existing;
            }
        }
        if (state && state.preDecidedOutcomes && state.preDecidedOutcomes[pidStr]) {
            const res = state.preDecidedOutcomes[pidStr];
            if (res && (isPermanentSettledReason(res.reason) || pendingBets.length === 0)) {
                if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();
                state.settledOutcomesHistory.set(pidStr, res);
                return res;
            }
        }

        // 2. Check if already present in state.history
        if (state && state.history) {
            const existing = state.history.find(h => String(h.period || h.periodId) === pidStr);
            if (existing && existing.number !== undefined && existing.number !== null && existing.status !== 'PENDING') {
                const res = { number: Number(existing.number), isOverridden: !!existing.isOverridden, reason: 'SETTLED_ROUND' };
                if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();
                state.settledOutcomesHistory.set(pidStr, res);
                return res;
            }
        }

        try {
            // 3. Check Firestore persistent predecided collection
            const dbOutcome = await firebaseSync.fetchPreDecidedOutcome(mode, pidStr);
            if (dbOutcome && (isPermanentSettledReason(dbOutcome.reason) || pendingBets.length === 0)) {
                if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();
                state.settledOutcomesHistory.set(pidStr, dbOutcome);
                return dbOutcome;
            }
        } catch (err) {
            console.warn(`[Engine] fetchPreDecidedOutcome error for ${mode} period ${pidStr}:`, err.message);
        }

        // 4. Fallback if none existed: determine outcome using Smart Risk & pendingBets
        const outcomeResult = this.selectSmartRiskOutcome(mode, pidStr, pendingBets);
        if (isPermanentSettledReason(outcomeResult?.reason)) {
            if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();
            state.settledOutcomesHistory.set(pidStr, outcomeResult);
            try {
                await firebaseSync.savePreDecidedOutcome(mode, pidStr, outcomeResult);
            } catch (e) {}
        }
        return outcomeResult;
    }

    async _settleRound(mode, periodId) {
        const state = this.modes[mode];
        const modeConfig = this.config.modes[mode];

        // Check if we already have the pre-computed settlement package ready from the 4s step
        let preComputed = null;
        if (state.preComputedSettlements && state.preComputedSettlements[periodId]) {
            preComputed = state.preComputedSettlements[periodId];
            delete state.preComputedSettlements[periodId];
        }

        let roundRecord;
        let evaluatedBets = [];

        if (preComputed) {
            // Fast-Path: Use the pre-computed outcome and evaluated bets instantly
            roundRecord = preComputed.roundRecord;
            
            for (const item of preComputed.evaluatedBets) {
                const { bet, originalBetId, settlement, user, ledgerEntry } = item;
                if (settlement.isWin && settlement.payoutAmount > 0 && user) {
                    const balBefore = user.balance;
                    user.balance = Number((user.balance + settlement.payoutAmount).toFixed(2));
                    if (ledgerEntry) {
                        ledgerEntry.balanceBefore = balBefore;
                        ledgerEntry.balanceAfter = user.balance;
                    }
                }
                if (ledgerEntry) {
                    this.ledger.unshift(ledgerEntry);
                }
                this.settledBetsHistory.set(bet.id, { ...bet });
                this.bets.delete(originalBetId);
                evaluatedBets.push(item);
            }
            console.log(`[Instant Settle @ 0s] Mode ${mode} Period ${periodId} instant zero-latency flush executed. Winning number: ${roundRecord.number}`);
        } else {
            // Safe fallback: Compute on-the-fly if pre-computation wasn't cached
            const outcomeResult = await this.getPreDecidedOutcome(mode, periodId);
            const winningNumber = outcomeResult.number;
            const isOverridden = outcomeResult.isOverridden;

            const props = NUMBER_PROPERTIES[winningNumber] || NUMBER_PROPERTIES[0];
            roundRecord = {
                period: periodId,
                periodId: periodId,
                number: winningNumber,
                winningNumber: winningNumber,
                color: props.color,
                size: props.size,
                colorLabel: props.label,
                settledAt: new Date().toISOString(),
                isOverridden
            };

            const memoryPendingBets = Array.from(this.bets.values()).filter(
                b => b.mode === mode && String(b.periodId) === String(periodId) && (b.status === 'PENDING' || b.status === 'pending')
            );
            const pendingBetsMap = new Map();
            memoryPendingBets.forEach(b => pendingBetsMap.set(b.id, b));
            try {
                const fsBets = await firebaseSync.fetchPendingBetsForPeriod(mode, periodId);
                if (Array.isArray(fsBets)) {
                    fsBets.forEach(fb => {
                        if (!pendingBetsMap.has(fb.id)) {
                            pendingBetsMap.set(fb.id, fb);
                            this.bets.set(fb.id, fb);
                        }
                    });
                }
            } catch (err) {
                console.warn('[Engine] fallback fetchPendingBetsForPeriod note:', err.message);
            }
            const pendingBetsForRound = Array.from(pendingBetsMap.values());

            for (const bet of pendingBetsForRound) {
                const settlement = this._evaluateBet(bet, winningNumber);
                bet.status = settlement.isWin ? 'WON' : 'LOST';
                bet.resultNumber = winningNumber;
                bet.resultColor = props.color;
                bet.resultSize = props.size;
                bet.payoutAmount = settlement.payoutAmount;
                bet.settledAt = new Date().toISOString();

                let balanceBefore = 0;
                let balanceAfter = 0;
                const user = this.users.get(bet.userId);
                if (settlement.isWin && settlement.payoutAmount > 0) {
                    if (user) {
                        balanceBefore = user.balance;
                        user.balance = Number((user.balance + settlement.payoutAmount).toFixed(2));
                        balanceAfter = user.balance;
                    }
                }

                let ledgerEntry = null;
                if (settlement.isWin && settlement.payoutAmount > 0) {
                    ledgerEntry = {
                        id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        userId: bet.userId,
                        type: 'BET_WIN_CREDIT',
                        amount: settlement.payoutAmount,
                        balanceBefore,
                        balanceAfter,
                        referenceId: bet.id,
                        timestamp: new Date().toISOString(),
                        description: `Won bet on ${mode} round ${periodId} (${bet.selectionLabel})`
                    };
                    this.ledger.unshift(ledgerEntry);
                }

                this.settledBetsHistory.set(bet.id, { ...bet });
                this.bets.delete(bet.id);
                evaluatedBets.push({ bet, settlement, user, ledgerEntry });
            }
        }

        // Prepend to mode history (strictly capped at max 50 rounds) - Synchronous in-memory update
        state.history = state.history.filter(h => String(h.period || h.periodId) !== String(periodId));
        state.history.unshift(roundRecord);
        if (state.history.length > 50) state.history.length = 50;

        if (!state.settledOutcomesHistory) state.settledOutcomesHistory = new Map();
        state.settledOutcomesHistory.set(String(periodId), {
            number: roundRecord.number,
            color: roundRecord.color,
            size: roundRecord.size,
            isOverridden: !!roundRecord.isOverridden,
            reason: 'SETTLED_ROUND'
        });
        this._saveHistoryToDisk();

        // Non-blocking asynchronous schedule to local disk
        if (evaluatedBets.length > 0) {
            this._scheduleSaveUsers();
            this._scheduleSaveBets();
        }

        // Auto-prune memory rings to guarantee zero memory leaks on 512MB Render RAM
        this._pruneMemory();

        // Non-blocking save of the official settled round to Firestore
        firebaseSync.saveSettledRound(mode, roundRecord).catch(err => {
            console.warn(`[Server] Error saving settled round to Firestore:`, err.message);
        });

        // Batch update all evaluated bets status in Firestore (1 batch operation, non-blocking)
        if (evaluatedBets.length > 0) {
            firebaseSync.batchUpdateBetSettlements(evaluatedBets.map(i => i.bet)).catch(err => {
                console.warn(`[Server] Batch bet settlement sync note:`, err.message);
            });
        }

        // Fast In-Memory Batch Settlement: mark winning users dirty and trigger immediate sync only for major wins (>= ₹500)
        for (const item of evaluatedBets) {
            const { bet, settlement, user } = item;
            if (settlement.isWin && settlement.payoutAmount > 0 && user) {
                user._localVersion = (user._localVersion || 1) + 1;
                user._lastLocalUpdate = Date.now();
                firebaseSync.markUserDirty(user.id);

                // For high-roller wins (>= ₹500), fire single detached balance update to Firestore immediately
                if (settlement.payoutAmount >= 500) {
                    firebaseSync.updateUserBalance(user.id, user.balance, 'Major win payout').catch(() => {});
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
        const winNum = parseInt(winningNumber, 10);
        if (isNaN(winNum) || winNum < 0 || winNum > 9) {
            return { isWin: false, payoutMultiplier: 0, payoutAmount: 0 };
        }

        const props = NUMBER_PROPERTIES[winNum] || NUMBER_PROPERTIES[0];
        const multConfig = this.config.multipliers || {};
        const rawBetAmount = Number(bet.betAmount || bet.totalAmount || 0);
        const contractAmount = Number(bet.contractAmount || (rawBetAmount * 0.98));

        let isWin = false;
        let payoutMultiplier = 0;

        const sel = String(bet.selection || '').toLowerCase().trim();
        const betType = String(bet.type || '').toLowerCase().trim();
        
        // Exact Rules:
        // 0, 1, 2, 3, 4 is Small
        // 5, 6, 7, 8, 9 is Big
        const isBigWin = (winNum >= 5 && winNum <= 9);
        const isSmallWin = (winNum >= 0 && winNum <= 4);

        // 1. Number Bets (0-9) -> 9x
        if (betType === 'number' || (!isNaN(parseInt(sel, 10)) && betType !== 'color' && betType !== 'size')) {
            const betNum = parseInt(sel, 10);
            if (betNum === winNum) {
                isWin = true;
                payoutMultiplier = multConfig.number || 9.0;
            }
        }
        // 2. Color Bets:
        // Green: 1, 3, 7, 9 (Pure 2x), 5 (Half Green + Violet 1.5x)
        else if (sel === 'green' || (betType === 'color' && sel === 'green')) {
            if ([1, 3, 7, 9].includes(winNum)) {
                isWin = true;
                payoutMultiplier = multConfig.pureColor || 2.0; // 2x Pure Green
            } else if (winNum === 5) {
                isWin = true;
                payoutMultiplier = multConfig.halfColor || 1.5; // 1.5x Half Green on 5
            }
        }
        // Red: 2, 4, 6, 8 (Pure 2x), 0 (Half Red + Violet 1.5x)
        else if (sel === 'red' || (betType === 'color' && sel === 'red')) {
            if ([2, 4, 6, 8].includes(winNum)) {
                isWin = true;
                payoutMultiplier = multConfig.pureColor || 2.0; // 2x Pure Red
            } else if (winNum === 0) {
                isWin = true;
                payoutMultiplier = multConfig.halfColor || 1.5; // 1.5x Half Red on 0
            }
        }
        // Violet: 0 or 5 (4.5x)
        else if (sel === 'violet' || (betType === 'color' && sel === 'violet')) {
            if (winNum === 0 || winNum === 5) {
                isWin = true;
                payoutMultiplier = multConfig.violet || 4.5; // 4.5x Violet
            }
        }
        // 3. Big / Small Bets (Big: 5,6,7,8,9; Small: 0,1,2,3,4) -> 2x
        else if (sel === 'big' || sel === 'b' || (betType === 'size' && (sel === 'big' || sel === 'b'))) {
            if (isBigWin) {
                isWin = true;
                payoutMultiplier = multConfig.bigSmall || 2.0; // 2x
            } else {
                isWin = false;
                payoutMultiplier = 0;
            }
        } else if (sel === 'small' || sel === 's' || (betType === 'size' && (sel === 'small' || sel === 's'))) {
            if (isSmallWin) {
                isWin = true;
                payoutMultiplier = multConfig.bigSmall || 2.0; // 2x
            } else {
                isWin = false;
                payoutMultiplier = 0;
            }
        }

        const payoutAmount = isWin ? Number((contractAmount * payoutMultiplier).toFixed(2)) : 0;
        return { isWin, payoutMultiplier, payoutAmount };
    }

    // Place Bet (Server-Authoritative Validation)
    async placeBet({ userId = 'default_user', mode, periodId, type, selection, unitAmount, multiplier, quantity = 1 }) {
        if (!this.userBetLocks) this.userBetLocks = new Set();
        if (this.userBetLocks.has(userId)) {
            throw new Error('Please wait, previous bet is currently processing');
        }
        this.userBetLocks.add(userId);

        try {
            const modeState = this.modes[mode];
            const modeConfig = this.config.modes[mode];

            if (!modeState || !modeConfig || !modeConfig.enabled || modeConfig.paused) {
                throw new Error(`Game mode ${mode} is currently unavailable`);
            }

            if (modeState.isLocked || (modeState.settledRounds && (modeState.settledRounds.has(modeState.currentPeriodId) || modeState.settledRounds.has(periodId)))) {
                throw new Error('Betting is locked for the final 5 seconds. Please wait for next round.');
            }

            // Fast & reliable user lookup
            let user = this.users.get(userId);
            if (!user) {
                this._loadUsersFromDisk();
                user = this.users.get(userId);
            }
            if (!user) {
                try {
                    user = await firebaseSync.fetchUserFromFirestore(userId);
                } catch (e) {
                    console.warn('[Server] Firestore user fetch during bet placement:', e.message);
                }
            }
            if (!user) {
                throw new Error('User account not found. Please log in again.');
            }

            // Enforce minimum 1 approved deposit requirement to play games and place bets
            const hasApprovedDeposit = this.hasApprovedDeposit(user);
            if (!hasApprovedDeposit) {
                throw new Error('🔒 Recharge Required! Minimum 1 approved deposit (₹200+) is required to play games and place bets. Please deposit funds first.');
            }

            const totalAmount = Number(unitAmount) * Number(multiplier) * Number(quantity);
            if (isNaN(totalAmount) || totalAmount < this.config.minBetAmount) {
                throw new Error(`Minimum bet amount is ₹${this.config.minBetAmount}`);
            }
            if (totalAmount > this.config.maxBetAmount) {
                throw new Error(`Maximum bet amount is ₹${this.config.maxBetAmount}`);
            }

            // Check authoritative balance
            const currentBalance = Number(user.balance || 0);
            if (currentBalance < totalAmount) {
                throw new Error(`Insufficient wallet balance. Available: ₹${currentBalance.toFixed(2)}, Required: ₹${totalAmount.toFixed(2)}`);
            }

            const feePercent = this.config.serviceFeePercent || 2;
            const serviceFee = Number((totalAmount * (feePercent / 100)).toFixed(2));
            const contractAmount = Number((totalAmount - serviceFee).toFixed(2));

            const betId = 'BET_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
            
            let selectionLabel = selection;
            if (!isNaN(parseInt(selection, 10))) {
                selectionLabel = `Number ${selection}`;
            } else {
                selectionLabel = String(selection).toUpperCase();
            }

            // Always lock to active server round period
            const activePeriodId = modeState.currentPeriodId || periodId;

            const betOrder = {
                id: betId,
                userId,
                mode,
                periodId: activePeriodId,
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

            // Instant Atomic In-Memory Balance Deduction & Turnover Deduction
            const balanceBefore = user.balance;
            user.balance = Number((user.balance - totalAmount).toFixed(2));
            user._localVersion = (user._localVersion || 1) + 1;
            user._lastLocalUpdate = Date.now();
            if (user.requiredTurnover && user.requiredTurnover > 0) {
                user.requiredTurnover = Math.max(0, Number((user.requiredTurnover - totalAmount).toFixed(2)));
            }
            const balanceAfter = user.balance;

            const ledgerEntry = {
                id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                userId,
                type: 'BET_DEBIT',
                amount: -totalAmount,
                balanceBefore,
                balanceAfter,
                referenceId: betId,
                timestamp: new Date().toISOString(),
                description: `Bet on ${mode} round ${activePeriodId} (${selectionLabel})`
            };

            // Cache active bet & ledger in memory immediately
            this.bets.set(betId, betOrder);
            this.settledBetsHistory.set(betId, { ...betOrder });
            this.ledger.unshift(ledgerEntry);

            // Fast non-blocking async disk schedule & dirty batch flag
            this._scheduleSaveUsers();
            this._scheduleSaveBets();
            this._pruneMemory();
            firebaseSync.markUserDirty(userId);

            // 1% Lifetime Betting Commission to Referrer
            this._processReferralBetCommission(user, totalAmount, mode, activePeriodId, betId);

            return {
                success: true,
                bet: betOrder,
                newBalance: user.balance
            };
        } finally {
            this.userBetLocks.delete(userId);
        }
    }

    // Fetch Live Exposure Heatmap & Candidate Payout Matrix for Admin
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
            sizes: { big: 0, small: 0 },
            candidateMatrix: {} // 0-9 candidate outcomes
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

        // Compute candidate outcome payouts for numbers 0 to 9
        for (let num = 0; num <= 9; num++) {
            const payout = this._calculatePayoutForCandidate(mode, state.currentPeriodId, num);
            const netProfit = summary.totalBetVolume - payout;
            const margin = summary.totalBetVolume > 0 ? Number(((netProfit / summary.totalBetVolume) * 100).toFixed(1)) : 100;
            summary.candidateMatrix[num] = {
                number: num,
                payout: Number(payout.toFixed(2)),
                netProfit: Number(netProfit.toFixed(2)),
                marginPercent: margin,
                props: NUMBER_PROPERTIES[num]
            };
        }

        return summary;
    }

    // Get Risk Engine Configuration Status
    getRiskEngineStatus() {
        return {
            success: true,
            riskEngine: this.config.riskEngine,
            universalSync: false,
            syncApiUrl: '',
            overrides: this.adminOverrides
        };
    }

    // Update Risk Engine Strategy & House Win Rate
    updateRiskEngineConfig({ strategyMode, houseWinRatePercent, maxPayoutCap, enabled, universalSync, syncApiUrl }) {
        if (!this.config.riskEngine) {
            this.config.riskEngine = { targetedUsers: {} };
        }
        if (strategyMode) this.config.riskEngine.strategyMode = strategyMode;
        if (houseWinRatePercent !== undefined) {
            const rate = Number(houseWinRatePercent);
            if (!isNaN(rate) && rate >= 10 && rate <= 100) {
                this.config.riskEngine.houseWinRatePercent = rate;
            }
        }
        if (maxPayoutCap !== undefined) {
            const cap = Number(maxPayoutCap);
            if (!isNaN(cap) && cap >= 0) {
                this.config.riskEngine.maxPayoutCap = cap;
            }
        }
        if (enabled !== undefined) {
            this.config.riskEngine.enabled = Boolean(enabled);
        }
        this.config.universalSync = false;
        this.config.syncApiUrl = '';

        const logMsg = `Smart Risk Engine Config updated: Mode=${this.config.riskEngine.strategyMode}, WinRate=${this.config.riskEngine.houseWinRatePercent}%, MaxCap=₹${this.config.riskEngine.maxPayoutCap}, UniversalSync=false`;
        this.auditLogs.unshift({
            id: 'AUDIT_' + Date.now(),
            action: 'RISK_ENGINE_CONFIG_UPDATED',
            details: logMsg,
            timestamp: new Date().toISOString()
        });
        firebaseSync.logAdminAction('RISK_ENGINE_CONFIG_UPDATED', logMsg);
        firebaseSync.saveSystemConfig(this.config);

        return {
            success: true,
            message: logMsg,
            riskEngine: this.config.riskEngine,
            universalSync: false,
            syncApiUrl: ''
        };
    }

    // Update Targeted User (Rig specific User to Always Win / Always Lose)
    updateTargetedUser({ userIdOrPhone, status }) {
        if (!this.config.riskEngine) {
            this.config.riskEngine = { targetedUsers: {} };
        }
        if (!this.config.riskEngine.targetedUsers) {
            this.config.riskEngine.targetedUsers = {};
        }

        const targetKey = String(userIdOrPhone).trim();
        if (!targetKey) {
            throw new Error('User ID or Mobile Number is required');
        }

        if (status === 'REMOVE' || !status) {
            delete this.config.riskEngine.targetedUsers[targetKey];
        } else if (status === 'ALWAYS_WIN' || status === 'ALWAYS_LOSE') {
            this.config.riskEngine.targetedUsers[targetKey] = status;
        } else {
            throw new Error('Invalid targeted user status');
        }

        const logMsg = `Targeted User override set for ${targetKey}: ${status || 'REMOVED'}`;
        this.auditLogs.unshift({
            id: 'AUDIT_' + Date.now(),
            action: 'TARGETED_USER_OVERRIDE_SET',
            details: logMsg,
            timestamp: new Date().toISOString()
        });
        firebaseSync.logAdminAction('TARGETED_USER_OVERRIDE_SET', logMsg);
        firebaseSync.saveSystemConfig(this.config);

        return {
            success: true,
            message: logMsg,
            targetedUsers: this.config.riskEngine.targetedUsers
        };
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

        // Instantly reflect override in preDecidedOutcomes if current period is locked in last 5s
        if (this.modes[mode]) {
            const curP = this.modes[mode].currentPeriodId;
            if (curP) {
                if (!this.modes[mode].preDecidedOutcomes) this.modes[mode].preDecidedOutcomes = {};
                this.modes[mode].preDecidedOutcomes[curP] = {
                    number: num,
                    isOverridden: true,
                    reason: 'ADMIN_FORCE_OVERRIDE'
                };
            }
        }
        
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
        const merchantUsdtAddress = (this.config.usdtAddress || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c').trim();
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
            // 2x Mandatory Deposit Turnover Rule
            userObj.requiredTurnover = Number(((userObj.requiredTurnover || 0) + (numAmount * 2.0)).toFixed(2));
            const balanceAfter = userObj.balance;

            this.transactions.unshift(req);
            firebaseSync.saveTransaction(req);
            firebaseSync.saveUser(userObj).catch(e => console.warn('[User Save Sync]', e.message));
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

            userObj.hasDeposited = true;
            this._processReferralDepositCommission(userObj, numAmount, txId);

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

    canWithdrawReferralIncome(userId = 'default_user') {
        // Referral earnings can strictly be withdrawn only on the 1st day of any month
        const now = new Date();
        const istDay = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(now));
        const isFirstOfMonth = istDay === 1;

        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextPayoutDateStr = new Intl.DateTimeFormat('en-IN', { 
            timeZone: 'Asia/Kolkata', 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric' 
        }).format(isFirstOfMonth ? now : nextMonth);

        return {
            isFirstOfMonth,
            currentDay: istDay,
            canWithdraw: isFirstOfMonth,
            nextPayoutDate: nextPayoutDateStr,
            message: isFirstOfMonth 
                ? '✅ Monthly Referral Payout Window is OPEN today (01st of Month)!'
                : `🔒 Referral commission payouts open exclusively on the 01st of every month. Next window: 01 ${nextPayoutDateStr}.`
        };
    }

    createWithdrawalRequest({ userId = 'default_user', amount, usdtAmount, accountHolderName = '', bankName = 'Bank Transfer', accountNumber = '', ifsc = '', securityPin = '', upiId = '', channel = 'BANK', usdtAddress = '', isReferralWithdrawal = false }) {
        const user = this.users.get(userId);
        if (!user) throw new Error('User account not found');

        // 2x Mandatory Deposit Betting Turnover Rule check
        const reqTurnover = Number(user.requiredTurnover || 0);
        if (reqTurnover > 0) {
            throw new Error(`🔒 Withdrawal Locked! You must complete mandatory 2x deposit betting turnover before withdrawing. Remaining required turnover to bet: ₹${reqTurnover.toFixed(2)}.`);
        }

        // If this is a specific referral income withdrawal, enforce 1st of month constraint
        if (isReferralWithdrawal) {
            const check = this.canWithdrawReferralIncome(userId);
            if (!check.isFirstOfMonth) {
                throw new Error(`Referral funds withdrawal is only allowed on the 1st of every month! Next payout: ${check.nextPayoutDate}.`);
            }
        }

        const isUsdt = channel === 'USDT' || channel === 'USDT_TRC20' || Boolean(usdtAddress && String(usdtAddress).trim().length >= 10);

        const rate = Number(this.config.usdtRate || 102);
        let numAmount = Number(amount);
        let usdtVal = Number(usdtAmount);

        if (isUsdt) {
            if (isNaN(usdtVal) || usdtVal <= 0) {
                if (!isNaN(numAmount) && numAmount > 0) {
                    usdtVal = numAmount / rate;
                }
            }
            if (isNaN(usdtVal) || usdtVal < 10) {
                throw new Error('Minimum USDT withdrawal amount is 10 USDT ($10)');
            }
            numAmount = Number((usdtVal * rate).toFixed(2));
            usdtVal = Number(usdtVal.toFixed(2));
        } else {
            if (isNaN(numAmount) || numAmount < 200) {
                throw new Error('Minimum withdrawal amount is ₹200');
            }
        }

        if (numAmount > 100000) {
            throw new Error('Maximum withdrawal amount is ₹1,00,000 per request');
        }
        if (user.balance < numAmount) {
            throw new Error(`Insufficient main balance. Available: ₹${user.balance.toFixed(2)} (Required for $${usdtVal || '0'} USDT: ₹${numAmount.toFixed(2)})`);
        }

        if (securityPin) {
            const expectedPin = String(user.securityPin || (user.phone ? user.phone.slice(-4) : '1234'));
            if (String(securityPin).trim() !== expectedPin && String(securityPin).trim() !== this.masterPin) {
                throw new Error('Invalid 6-Digit Security PIN. Please verify your security PIN.');
            }
        }

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

        const txId = 'WTH_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        const req = {
            id: txId,
            userId,
            type: 'WITHDRAWAL',
            channel: isUsdt ? 'USDT' : 'BANK',
            amount: numAmount,
            usdtAmount: isUsdt ? usdtVal : null,
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

        const usdtEquivalent = usdtVal;

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
            requiredTurnover: Number((user.requiredTurnover || 0).toFixed(2)),
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
                // 2x Mandatory Deposit Turnover Rule
                user.requiredTurnover = Number(((user.requiredTurnover || 0) + (tx.amount * 2.0)).toFixed(2));
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

                // 10% Instant Deposit Referral Commission & Progression Milestone check
                const wasDepositedBefore = Boolean(user.hasDeposited);
                user.hasDeposited = true;

                // Credit ₹100 Welcome Gift on 1st deposit if not credited yet
                if (!wasDepositedBefore && !user.hasWelcomeBonusCredited) {
                    user.hasWelcomeBonusCredited = true;
                    const preWelcomeBal = user.balance;
                    user.balance = Number((user.balance + 100.00).toFixed(2));
                    this.ledger.unshift({
                        id: 'LEDGER_WELCOME_' + Date.now(),
                        userId: user.id,
                        type: 'WELCOME_BONUS',
                        amount: 100.00,
                        balanceBefore: preWelcomeBal,
                        balanceAfter: user.balance,
                        referenceId: 'WELCOME_GIFT_1ST_DEP',
                        timestamp: new Date().toISOString(),
                        description: '🎁 1st Deposit VIP Welcome Gift ₹100 Credited!'
                    });
                }

                this._processReferralDepositCommission(user, tx.amount, tx.id);
                // Also check if this user is a referrer and now unlocks their milestone rewards
                this._checkAndAwardReferralMilestones(user.id);

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

                firebaseSync.saveUser(user).catch(e => console.warn('[User Save Sync]', e.message));
                firebaseSync.updateUserBalance(user.id, user.balance, 'Deposit approved by admin');
            } else if (tx.type === 'WITHDRAWAL') {
                const ledgerEntry = {
                    id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    userId: tx.userId,
                    type: 'WITHDRAWAL_PAID',
                    amount: -Math.abs(tx.amount),
                    balanceBefore: user.balance,
                    balanceAfter: user.balance,
                    referenceId: tx.id,
                    timestamp: new Date().toISOString(),
                    description: `Withdrawal payout approved: ₹${tx.amount}${tx.usdtAmount ? ` ($${tx.usdtAmount} USDT)` : ''}`
                };
                this.ledger.unshift(ledgerEntry);
                firebaseSync.saveLedgerEntry(ledgerEntry);
                firebaseSync.updateUserBalance(user.id, user.balance, 'Withdrawal approved by admin');
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

    hasApprovedDeposit(userId) {
        const user = typeof userId === 'object' ? userId : (this.users.get(userId) || null);
        if (!user) return false;

        if (user.hasDeposited) return true;

        const hasTx = this.transactions.some(t => 
            t.userId === user.id && 
            (t.type === 'DEPOSIT' || t.type === 'DEPOSIT_CREDIT') && 
            (t.status === 'APPROVED' || t.status === 'SUCCESS' || t.status === 'COMPLETED')
        );

        const hasLedger = (this.ledger || []).some(l => 
            l.userId === user.id && 
            (l.type === 'DEPOSIT' || l.type === 'DEPOSIT_CREDIT')
        );

        if (hasTx || hasLedger) {
            user.hasDeposited = true;
            return true;
        }

        return false;
    }

    getDepositCount(userId) {
        const user = typeof userId === 'object' ? userId : (this.users.get(userId) || null);
        if (!user) return 0;

        const approvedTxs = this.transactions.filter(t => 
            t.userId === user.id && 
            (t.type === 'DEPOSIT' || t.type === 'DEPOSIT_CREDIT') && 
            (t.status === 'APPROVED' || t.status === 'SUCCESS' || t.status === 'COMPLETED')
        );

        const depositLedgerItems = (this.ledger || []).filter(l => 
            l.userId === user.id && 
            (l.type === 'DEPOSIT' || l.type === 'DEPOSIT_CREDIT')
        );

        const count = Math.max(approvedTxs.length, depositLedgerItems.length, user.hasDeposited ? 1 : 0);
        if (count > 0 && !user.hasDeposited) {
            user.hasDeposited = true;
        }
        return count;
    }

    getDailyCheckInStatus(userId = 'default_user') {
        const user = this.users.get(userId) || this._ensureDefaultUser(userId, 0.00);
        const todayKey = this._getTodayDateKey();
        const yesterdayKey = this._getYesterdayDateKey();

        // Check if user has made at least 1 approved deposit
        const hasApprovedDeposit = this.hasApprovedDeposit(user);

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
        this._saveUsersToDisk();

        return {
            success: true,
            amount: rewardAmount,
            streakDay: nextStreak,
            newBalance: user.balance,
            message: `🎉 Success! Day ${nextStreak} Daily Bonus of ₹${rewardAmount} credited to your wallet!`
        };
    }

    _getReferrer(user) {
        if (!user || !user.referredBy) return null;
        let referrer = this.users.get(user.referredBy);
        if (!referrer) {
            const cleanRef = String(user.referredBy).trim().toUpperCase();
            const refUserId = this.referralCodes.get(cleanRef);
            if (refUserId) {
                referrer = this.users.get(refUserId);
            } else {
                for (const u of this.users.values()) {
                    if ((u.inviteCode && u.inviteCode.toUpperCase() === cleanRef) || u.id === user.referredBy) {
                        referrer = u;
                        break;
                    }
                }
            }
        }
        if (referrer && referrer.id !== user.id) {
            return referrer;
        }
        return null;
    }

    _getReferralDepositRate(depositAmount) {
        const amt = Number(depositAmount) || 0;
        if (amt >= 1000000) return 10;
        if (amt >= 500000) return 8;
        if (amt >= 200000) return 7;
        if (amt >= 100000) return 6;
        if (amt >= 5000) return 5;
        return 5;
    }

    _processReferralDepositCommission(depositingUser, depositAmount, txReferenceId = '') {
        try {
            const numDeposit = Number(depositAmount);
            if (!depositingUser || numDeposit <= 0) return;
            const referrer = this._getReferrer(depositingUser);
            if (!referrer) return;

            // Strict Rule: Referrer MUST have made at least 1 approved deposit to earn referral commissions
            const referrerHasDep = Boolean(
                referrer.hasDeposited || 
                this.transactions.some(t => t.userId === referrer.id && t.type === 'DEPOSIT' && t.status === 'APPROVED')
            );
            if (!referrerHasDep) {
                console.log(`[Referral Deposit Commission] Referrer ${referrer.phone} has not made a deposit yet. Bonus withheld until referrer deposits.`);
                return;
            }

            // Tiered Deposit Commission (5k-100k: 5%, 100k-200k: 6%, 200k-500k: 7%, 500k-1000k: 8%, 1000k+: 10%)
            const commRate = this._getReferralDepositRate(numDeposit);
            const commission = Number((numDeposit * (commRate / 100)).toFixed(2));
            if (commission <= 0) return;

            const refBalBefore = referrer.balance;
            referrer.balance = Number((referrer.balance + commission).toFixed(2));
            referrer.totalReferralCommission = Number(((referrer.totalReferralCommission || 0) + commission).toFixed(2));
            referrer.depositCommissionEarned = Number(((referrer.depositCommissionEarned || 0) + commission).toFixed(2));
            const refBalAfter = referrer.balance;

            const phoneStr = String(depositingUser.phone || depositingUser.username || 'Friend');
            const maskedPhone = phoneStr.length >= 10 ? phoneStr.slice(0, 2) + '******' + phoneStr.slice(-2) : phoneStr;

            const ledgerEntry = {
                id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                userId: referrer.id,
                type: 'REFERRAL_DEPOSIT_COMMISSION',
                amount: commission,
                balanceBefore: refBalBefore,
                balanceAfter: refBalAfter,
                referenceId: txReferenceId || ('DEP_' + Date.now()),
                timestamp: new Date().toISOString(),
                description: `⚡ ${commRate}% Deposit Bonus: ₹${commission} from invited friend (${maskedPhone}) on ₹${depositAmount} recharge`
            };

            this.ledger.unshift(ledgerEntry);
            this._saveUsersToDisk();

            firebaseSync.incrementUserBalance(referrer.id, commission, `${commRate}% Deposit Referral Bonus ₹${commission}`);
            firebaseSync.saveTransaction(ledgerEntry);

            this.auditLogs.unshift({
                id: 'AUDIT_' + Date.now(),
                action: 'REFERRAL_DEPOSIT_COMMISSION',
                details: `Awarded ₹${commission} (${commRate}%) to ${referrer.phone} for ₹${depositAmount} deposit from ${depositingUser.phone}`,
                timestamp: new Date().toISOString()
            });

            // Check progression milestones
            this._checkAndAwardReferralMilestones(referrer.id);
        } catch (e) {
            console.warn('[Referral Deposit Commission Error]', e.message);
        }
    }

    _processReferralBetCommission(bettingUser, betAmount, mode = 'Wingo', periodId = '', betId = '') {
        try {
            if (!bettingUser || Number(betAmount) <= 0) return;
            const referrer = this._getReferrer(bettingUser);
            if (!referrer) return;

            // Strict Rule: Referrer MUST have made at least 1 approved deposit to earn referral bet commissions
            const referrerHasDep = Boolean(
                referrer.hasDeposited || 
                this.transactions.some(t => t.userId === referrer.id && t.type === 'DEPOSIT' && t.status === 'APPROVED')
            );
            if (!referrerHasDep) return;

            // 1% Lifetime Betting Commission on turnover
            const commission = Number((Number(betAmount) * 0.01).toFixed(2));
            if (commission <= 0) return;

            const refBalBefore = referrer.balance;
            referrer.balance = Number((referrer.balance + commission).toFixed(2));
            referrer.totalReferralCommission = Number(((referrer.totalReferralCommission || 0) + commission).toFixed(2));
            referrer.betCommissionEarned = Number(((referrer.betCommissionEarned || 0) + commission).toFixed(2));
            const refBalAfter = referrer.balance;

            const phoneStr = String(bettingUser.phone || bettingUser.username || 'Friend');
            const maskedPhone = phoneStr.length >= 10 ? phoneStr.slice(0, 2) + '******' + phoneStr.slice(-2) : phoneStr;

            const ledgerEntry = {
                id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                userId: referrer.id,
                type: 'REFERRAL_BET_COMMISSION',
                amount: commission,
                balanceBefore: refBalBefore,
                balanceAfter: refBalAfter,
                referenceId: betId || ('BET_' + Date.now()),
                timestamp: new Date().toISOString(),
                description: `🎯 1% Bet Commission: ₹${commission} from invited friend (${maskedPhone}) in ${mode} [${periodId}]`
            };

            this.ledger.unshift(ledgerEntry);
            this._saveUsersToDisk();

            firebaseSync.incrementUserBalance(referrer.id, commission, `1% Bet Referral Commission ₹${commission}`);
            firebaseSync.saveTransaction(ledgerEntry);
        } catch (e) {
            console.warn('[Referral Bet Commission Error]', e.message);
        }
    }

    _checkAndAwardReferralMilestones(referrerId) {
        try {
            const referrer = this.users.get(referrerId);
            if (!referrer) return;

            // Strict Rule: Referrer MUST have made at least 1 approved deposit to earn milestone bonuses
            const referrerHasDep = Boolean(
                referrer.hasDeposited || 
                this.transactions.some(t => t.userId === referrer.id && t.type === 'DEPOSIT' && t.status === 'APPROVED')
            );
            if (!referrerHasDep) return;

            const inviteCode = referrer.inviteCode;
            let activeCount = 0;
            for (const u of this.users.values()) {
                if (u.id === referrer.id) continue;
                if (u.referredBy === referrer.id || u.referredBy === inviteCode || (u.referredBy && String(u.referredBy).toUpperCase() === String(inviteCode).toUpperCase())) {
                    const hasDep = Boolean(u.hasDeposited || this.transactions.some(t => t.userId === u.id && t.type === 'DEPOSIT' && t.status === 'APPROVED'));
                    if (hasDep) activeCount++;
                }
            }

            referrer.awardedMilestones = referrer.awardedMilestones || [];

            const milestones = [
                { count: 1, bonus: 20.00, title: 'Tier 1 Agent Welcome Bonus' },
                { count: 3, bonus: 50.00, title: 'VIP Bronze Agent Milestone' },
                { count: 5, bonus: 150.00, title: '5-Friend Super Agent Milestone' },
                { count: 10, bonus: 500.00, title: 'Master VIP Agent 10-Friends Bonus' },
                { count: 25, bonus: 1500.00, title: 'Millionaire VIP Agent 25-Friends Bonus' }
            ];

            for (const ms of milestones) {
                if (activeCount >= ms.count && !referrer.awardedMilestones.includes(ms.count)) {
                    referrer.awardedMilestones.push(ms.count);
                    const refBalBefore = referrer.balance;
                    referrer.balance = Number((referrer.balance + ms.bonus).toFixed(2));
                    referrer.totalReferralCommission = Number(((referrer.totalReferralCommission || 0) + ms.bonus).toFixed(2));
                    referrer.milestoneBonusEarned = Number(((referrer.milestoneBonusEarned || 0) + ms.bonus).toFixed(2));
                    const refBalAfter = referrer.balance;

                    const ledgerEntry = {
                        id: 'LEDGER_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        userId: referrer.id,
                        type: 'REFERRAL_MILESTONE_BONUS',
                        amount: ms.bonus,
                        balanceBefore: refBalBefore,
                        balanceAfter: refBalAfter,
                        referenceId: `MS_${ms.count}_${Date.now()}`,
                        timestamp: new Date().toISOString(),
                        description: `👑 ${ms.title}: ₹${ms.bonus} Milestone Reward for reaching ${ms.count} active recharged players!`
                    };

                    this.ledger.unshift(ledgerEntry);
                    this._saveUsersToDisk();

                    firebaseSync.incrementUserBalance(referrer.id, ms.bonus, `Referral Milestone ${ms.count} Bonus ₹${ms.bonus}`);
                    firebaseSync.saveTransaction(ledgerEntry);

                    this.auditLogs.unshift({
                        id: 'AUDIT_' + Date.now(),
                        action: 'REFERRAL_MILESTONE_AWARDED',
                        details: `Awarded ${ms.title} (₹${ms.bonus}) to ${referrer.phone} for ${activeCount} active referrals`,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (e) {
            console.warn('[Referral Milestone Error]', e.message);
        }
    }

    getReferralSummary(userId = 'default_user') {
        const user = this.users.get(userId) || this._ensureDefaultUser(userId, 0.00);
        const inviteCode = user.inviteCode || 'SM9101';

        // Find all referred users
        const referredList = [];
        const downlineDepositEvents = [];
        let totalDepositVolume = 0;
        let totalBetVolume = 0;

        for (const u of this.users.values()) {
            if (u.id === user.id) continue;
            if (u.referredBy === userId || u.referredBy === inviteCode || (u.referredBy && String(u.referredBy).toUpperCase() === String(inviteCode).toUpperCase())) {
                const userDeposits = this.transactions.filter(t => t.userId === u.id && t.type === 'DEPOSIT' && t.status === 'APPROVED');
                const hasDep = Boolean(u.hasDeposited || userDeposits.length > 0);
                const depSum = userDeposits.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
                totalDepositVolume += depSum;

                // Collect individual deposit events for live stream timeline
                userDeposits.forEach(depTx => {
                    const dAmt = Number(depTx.amount) || 0;
                    const commRate = this._getReferralDepositRate(dAmt);
                    const comm = Number((dAmt * (commRate / 100)).toFixed(2));
                    const phoneStr = String(u.phone || u.username || '9876543210');
                    const maskedPhone = phoneStr.length >= 10 ? phoneStr.slice(0, 2) + '******' + phoneStr.slice(-2) : phoneStr;
                    downlineDepositEvents.push({
                        id: depTx.id || ('DEP_EVT_' + Date.now()),
                        friendPhone: maskedPhone,
                        friendUserId: u.id,
                        depositAmount: dAmt,
                        commissionRate: commRate,
                        commissionEarned: comm,
                        channel: depTx.channel || 'UPI',
                        timestamp: depTx.timestamp || new Date().toISOString(),
                        status: 'COMPLETED'
                    });
                });

                const userBets = Array.from(this.bets.values()).filter(b => b.userId === u.id);
                const betSum = userBets.reduce((acc, b) => acc + (Number(b.totalAmount) || 0), 0);
                totalBetVolume += betSum;

                // Calculate total deposit commission accurately per deposit transaction
                let depCommFromUser = userDeposits.reduce((acc, depTx) => {
                    const dAmt = Number(depTx.amount) || 0;
                    const commRate = this._getReferralDepositRate(dAmt);
                    return acc + Number((dAmt * (commRate / 100)).toFixed(2));
                }, 0);

                if (userDeposits.length === 0 && depSum > 0) {
                    const commRate = this._getReferralDepositRate(depSum);
                    depCommFromUser = Number((depSum * (commRate / 100)).toFixed(2));
                }
                depCommFromUser = Number(depCommFromUser.toFixed(2));

                const betCommFromUser = Number((betSum * 0.01).toFixed(2));
                const totalCommFromUser = Number((depCommFromUser + betCommFromUser).toFixed(2));

                const phoneStr = String(u.phone || u.username || '9876543210');
                const maskedPhone = phoneStr.length >= 10 ? phoneStr.slice(0, 2) + '******' + phoneStr.slice(-2) : phoneStr;

                const isMemberActive = hasDep || betSum > 0 || userBets.length > 0;
                let statusBadge = 'REGISTERED';
                let statusLabel = 'Registered (Pending Deposit)';
                if (hasDep && betSum > 0) {
                    statusBadge = 'ACTIVE_PRO';
                    statusLabel = 'Active (Playing & Recharged)';
                } else if (hasDep) {
                    statusBadge = 'RECHARGED';
                    statusLabel = 'Recharged (Deposit Complete)';
                } else if (betSum > 0) {
                    statusBadge = 'ACTIVE_BETS';
                    statusLabel = 'Active (Bets Placed)';
                }

                referredList.push({
                    userId: u.id,
                    phone: maskedPhone,
                    isActive: isMemberActive,
                    statusBadge: statusBadge,
                    statusLabel: statusLabel,
                    hasDeposited: hasDep,
                    depositCount: userDeposits.length,
                    totalDeposited: depSum,
                    totalBets: userBets.length,
                    totalBetAmount: betSum,
                    depositCommission: depCommFromUser,
                    betCommission: betCommFromUser,
                    totalCommission: totalCommFromUser,
                    joinedAt: u.createdAt || new Date().toISOString()
                });
            }
        }

        const activeCount = referredList.filter(r => r.hasDeposited || r.totalDeposited > 0).length;
        const totalInvites = referredList.length;

        // Calculate my inviter details (for user who was referred)
        let myInviter = null;
        if (user.referredBy) {
            let inviterUser = this.users.get(user.referredBy);
            if (!inviterUser) {
                for (const u of this.users.values()) {
                    if (u.id === user.referredBy || (u.inviteCode && u.inviteCode.toUpperCase() === String(user.referredBy).toUpperCase())) {
                        inviterUser = u;
                        break;
                    }
                }
            }
            if (inviterUser) {
                const phoneStr = String(inviterUser.phone || inviterUser.username || '');
                const maskedPhone = phoneStr.length >= 10 ? phoneStr.slice(0, 2) + '******' + phoneStr.slice(-2) : (phoneStr || 'VIP Agent');
                myInviter = {
                    isReferred: true,
                    phone: maskedPhone,
                    inviteCode: inviterUser.inviteCode || String(user.referredBy),
                    statusText: 'Connected & Verified VIP Uplink',
                    perks: ['100% First Deposit Match Bonus Active', 'Daily Sign-in VIP Bonus Active', '24/7 Priority Support']
                };
            } else {
                myInviter = {
                    isReferred: true,
                    phone: 'Official VIP Uplink',
                    inviteCode: String(user.referredBy),
                    statusText: 'Connected & Verified VIP Uplink',
                    perks: ['100% First Deposit Match Bonus Active', 'Daily Sign-in VIP Bonus Active']
                };
            }
        } else {
            myInviter = {
                isReferred: false,
                phone: 'Smarty91 Official',
                inviteCode: 'SM9101',
                statusText: 'Direct VIP Member',
                perks: ['100% First Deposit Match Bonus Active', 'Standard VIP Tier']
            };
        }

        // Calculate total earnings from ledger entries
        const userLedgers = this.ledger.filter(l => l.userId === user.id);
        const depCommLedger = userLedgers.filter(l => l.type === 'REFERRAL_DEPOSIT_COMMISSION' || l.type === 'REFERRAL_REWARD').reduce((s, l) => s + Math.max(0, Number(l.amount) || 0), 0);
        const betCommLedger = userLedgers.filter(l => l.type === 'REFERRAL_BET_COMMISSION').reduce((s, l) => s + Math.max(0, Number(l.amount) || 0), 0);
        const milestoneLedger = userLedgers.filter(l => l.type === 'REFERRAL_MILESTONE_BONUS').reduce((s, l) => s + Math.max(0, Number(l.amount) || 0), 0);

        const depComm = Number((user.depositCommissionEarned !== undefined ? user.depositCommissionEarned : (depCommLedger || referredList.reduce((acc, r) => acc + (r.depositCommission || 0), 0))).toFixed(2));
        const betComm = Number((user.betCommissionEarned !== undefined ? user.betCommissionEarned : (betCommLedger || (totalBetVolume * 0.01))).toFixed(2));
        const milestoneComm = Number((user.milestoneBonusEarned !== undefined ? user.milestoneBonusEarned : milestoneLedger).toFixed(2));
        const totalEarned = Number((user.totalReferralCommission !== undefined ? user.totalReferralCommission : (depComm + betComm + milestoneComm)).toFixed(2));

        const awardedMs = user.awardedMilestones || [];

        const milestoneDefinitions = [
            { count: 1, bonus: 20, title: '1 Active Friend', desc: 'Tiered Deposit + 1% Bet Active', isUnlocked: activeCount >= 1, isAwarded: awardedMs.includes(1) },
            { count: 3, bonus: 50, title: '3 Active Friends', desc: 'Bronze Agent + ₹50 Bonus', isUnlocked: activeCount >= 3, isAwarded: awardedMs.includes(3) },
            { count: 5, bonus: 150, title: '5 Friends (SUPER AGENT)', desc: '5/5 Milestone Complete + ₹150 Bonus', isUnlocked: activeCount >= 5, isAwarded: awardedMs.includes(5), isFeatured: true },
            { count: 10, bonus: 500, title: '10 Active Friends', desc: 'Master Agent + ₹500 Bonus', isUnlocked: activeCount >= 10, isAwarded: awardedMs.includes(10) },
            { count: 25, bonus: 1500, title: '25 Active Friends', desc: 'VIP Millionaire + ₹1,500 Bonus', isUnlocked: activeCount >= 25, isAwarded: awardedMs.includes(25) }
        ];

        // 5-Friend Target Progression
        const target5 = 5;
        const progress5Percent = Math.min(100, Math.round((activeCount / target5) * 100));

        // Recent 15 commission records for live feed
        const recentCommissions = userLedgers
            .filter(l => l.type && l.type.startsWith('REFERRAL_'))
            .slice(0, 15)
            .map(l => ({
                id: l.id,
                type: l.type,
                amount: l.amount,
                timestamp: l.timestamp,
                description: l.description
            }));

        const payoutWindow = this.canWithdrawReferralIncome(user.id);

        return {
            success: true,
            inviteCode,
            totalInvites,
            activeDepositors: activeCount,
            totalCommissionEarned: totalEarned,
            depositCommissionEarned: depComm,
            betCommissionEarned: betComm,
            milestoneBonusEarned: milestoneComm,
            payoutWindow,
            progression: {
                current: activeCount,
                target: target5,
                percent: progress5Percent,
                isCompleted: activeCount >= target5,
                remaining: Math.max(0, target5 - activeCount)
            },
            milestones: milestoneDefinitions,
            myInviter,
            referrals: referredList.reverse(),
            downlineDepositEvents: downlineDepositEvents.reverse(),
            recentCommissions
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

        firebaseSync.saveSystemConfig(this.config);

        return {
            success: true,
            referralStars: this.config.referralStars,
            message: 'Top 3 Referral Stars updated and synced successfully!'
        };
    }
}

// Global Singleton Server Engine
export const serverEngine = new Smarty91ServerEngine();
