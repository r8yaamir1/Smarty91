// server/firebaseSync.js - Server-side Firestore synchronization
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
    getFirestore,
    doc,
    collection,
    onSnapshot,
    setDoc,
    getDoc,
    updateDoc,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    increment,
    runTransaction,
    deleteDoc,
    writeBatch
} from 'firebase/firestore';

export const firebaseConfig = {
    projectId: "smarty91-40e57",
    appId: "1:575521043990:web:108625a45409f34bf76737",
    apiKey: "AIzaSyA3aI18LmjJ0j-NIZvWx9zOiDk1AUV9Kz0",
    authDomain: "smarty91-40e57.firebaseapp.com",
    storageBucket: "smarty91-40e57.firebasestorage.app",
    messagingSenderId: "575521043990",
    measurementId: "G-2K63GFRWL2"
};

let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}

export const db = getFirestore(app);

class FirebaseSyncManager {
    constructor() {
        this.isInitialized = false;
        this.isQuotaExhausted = false;
        this.quotaResetTime = 0;
        this.dirtyUsers = new Set();
        this._batchSyncTimer = null;
    }

    markUserDirty(userId) {
        if (!userId || userId === 'default_user') return;
        this.dirtyUsers.add(userId);
        // If accumulated more than 25 dirty users, trigger batch flush quickly
        if (this.dirtyUsers.size >= 25) {
            this.flushDirtyUsers().catch(() => {});
        }
    }

    async flushDirtyUsers() {
        if (this.dirtyUsers.size === 0 || !this._checkQuota()) return;
        const uids = Array.from(this.dirtyUsers);
        this.dirtyUsers.clear();

        while (uids.length > 0) {
            const chunk = uids.splice(0, 400);
            try {
                const batch = writeBatch(db);
                let count = 0;
                for (const uid of chunk) {
                    const user = this.engine ? this.engine.users.get(uid) : null;
                    if (user) {
                        const canonicalId = (user.id && !user.id.startsWith('usr_') && !isNaN(Number(user.id)) && user.id !== 'default_user') ? 'usr_' + user.id : user.id;
                        const userRef = doc(db, 'users', canonicalId);
                        batch.set(userRef, {
                            id: canonicalId,
                            balance: Number(user.balance !== undefined ? user.balance : 0),
                            bonusBalance: Number(user.bonusBalance !== undefined ? user.bonusBalance : 0),
                            requiredTurnover: Number(user.requiredTurnover !== undefined ? user.requiredTurnover : 0),
                            _serverVersion: user._localVersion || 1,
                            lastBatchSync: new Date().toISOString()
                        }, { merge: true });
                        count++;
                    }
                }
                if (count > 0) {
                    await batch.commit();
                }
            } catch (err) {
                this._handleQuotaError(err);
                console.warn('[Firebase] Batch flush error:', err.message);
            }
        }
    }

    _checkQuota() {
        if (this.isQuotaExhausted) {
            if (Date.now() > this.quotaResetTime) {
                this.isQuotaExhausted = false;
                return true;
            }
            return false;
        }
        return true;
    }

    _handleQuotaError(err) {
        if (err && (err.message?.includes('RESOURCE_EXHAUSTED') || err.code === 'resource-exhausted' || err.code === 8)) {
            if (!this.isQuotaExhausted) {
                console.warn('[Firebase] Firestore write quota reached. Seamlessly utilizing in-memory game state.');
            }
            this.isQuotaExhausted = true;
            this.quotaResetTime = Date.now() + 30 * 60 * 1000;
        }
    }

    async init(engine) {
        this.engine = engine;
        try {
            console.log('[Firebase] Initializing server Firestore sync...');
            
            // 1. Sync & Listen to Game Config
            await this._initSystemConfig();

            // 1.1 Sync & Listen to Today's Profit Stars
            await this._initProfitStars();

            // 2. Listen in real-time to Admin Overrides from Firestore
            this._listenToAdminOverrides();

            // 3. Hydrate all registered users from Firestore into server memory
            await this._hydrateUsersFromFirestore();

            // 3.1 Listen in real-time to User Account additions & updates
            this._listenToUsers();

            // 4. Hydrate game history from Firestore and fill deterministic rounds up to 50 for all modes
            await this._hydrateHistoryFromFirestore();

            // 4.1 Hydrate active pending bets from Firestore into server memory to prevent pending status bugs on server restart
            await this._hydratePendingBetsFromFirestore();

            // 4.2 Settle any past pending bets that missed their rounds (e.g. while server was scaled to zero/sleeping)
            await this.engine.settleAllPastPendingBets();

            // 5. Sync default user if not already existing
            await this._syncUserToFirestore(this.engine.users.get('default_user'));

            this.isInitialized = true;
            if (this._batchSyncTimer) clearInterval(this._batchSyncTimer);
            this._batchSyncTimer = setInterval(() => this.flushDirtyUsers().catch(() => {}), 45000);
            console.log('[Firebase] Firestore Server sync ready & live!');
        } catch (err) {
            this._handleQuotaError(err);
            console.error('[Firebase] Init error (will retry in background):', err.message);
        }
    }

    async resetAndWipeAllFirestoreGameHistory() {
        try {
            const modes = ['30s', '1m', '3m', '5m'];
            for (const mode of modes) {
                if (this.engine.modes[mode]) {
                    this.engine.modes[mode].history = [];
                }
                try {
                    const summaryRef = doc(db, 'game_history_summary', mode);
                    await setDoc(summaryRef, {
                        mode,
                        rounds: [],
                        updatedAt: new Date().toISOString()
                    });
                    console.log(`[Firebase] Cleared and wiped game_history_summary in Firestore for mode ${mode}`);
                } catch (e) {
                    console.warn(`[Firebase] Reset summary warning for ${mode}:`, e.message);
                }
            }
        } catch (err) {
            console.warn('[Firebase] Clear history warning:', err.message);
        }
    }

    async _hydrateHistoryFromFirestore() {
        try {
            const modes = ['30s', '1m', '3m', '5m'];
            for (const mode of modes) {
                try {
                    const summaryRef = doc(db, 'game_history_summary', mode);
                    const snap = await getDoc(summaryRef);
                    if (snap.exists()) {
                        const data = snap.data();
                        if (data && Array.isArray(data.rounds) && data.rounds.length > 0) {
                            const validRounds = data.rounds.filter(r => {
                                const pId = String(r.period || r.periodId || '');
                                return pId.length === 14;
                            });
                            this.engine.modes[mode].history = validRounds;
                            if (!this.engine.modes[mode].settledOutcomesHistory) {
                                this.engine.modes[mode].settledOutcomesHistory = new Map();
                            }
                            validRounds.forEach(r => {
                                const pId = String(r.period || r.periodId || '');
                                if (pId && r.number !== undefined && r.number !== null) {
                                    const num = Number(r.number);
                                    this.engine.modes[mode].settledOutcomesHistory.set(pId, {
                                        number: num,
                                        color: r.color,
                                        size: r.size,
                                        isOverridden: !!r.isOverridden,
                                        reason: 'FIRESTORE_HYDRATE'
                                    });
                                }
                            });
                        }
                    }
                } catch (e) {
                    console.warn(`[Firebase] Hydrate summary warning for ${mode}:`, e.message);
                }

                // Ensure full 50 rounds in memory
                if (this.engine.ensureFull50RoundsHistory) {
                    this.engine.ensureFull50RoundsHistory(mode);
                }

                // Write full 50 rounds back to Firestore summary doc for instant 1-read client access
                try {
                    const summaryRef = doc(db, 'game_history_summary', mode);
                    await setDoc(summaryRef, {
                        mode,
                        rounds: this.engine.modes[mode].history,
                        updatedAt: new Date().toISOString()
                    }, { merge: true });
                } catch (e) {
                    // Non-blocking
                }
            }
        } catch (err) {
            console.warn('[Firebase] History hydration warning:', err.message);
        }
    }

    async _hydrateUsersFromFirestore() {
        try {
            const usersCol = collection(db, 'users');
            const querySnap = await getDocs(usersCol);
            let count = 0;
            querySnap.forEach(docSnap => {
                const u = docSnap.data();
                const docId = docSnap.id;
                const uid = (u && u.id) ? u.id : docId;
                if (uid && uid !== 'default_user') {
                    const phoneVal = u.phone || (uid.startsWith('usr_') ? uid.replace('usr_', '') : '');
                    const userData = {
                        id: uid,
                        username: u.username || `usr_${phoneVal || 'VIP'}`,
                        phone: phoneVal,
                        passwordHash: u.passwordHash || '',
                        securityPin: u.securityPin || (phoneVal ? phoneVal.slice(-4) : '1234'),
                        balance: Number(u.balance !== undefined ? u.balance : 0),
                        requiredTurnover: Number(u.requiredTurnover !== undefined ? u.requiredTurnover : 0),
                        inviteCode: u.inviteCode || '',
                        referredBy: u.referredBy || null,
                        hasDeposited: !!u.hasDeposited,
                        isBlocked: !!u.isBlocked,
                        lastCheckInDate: u.lastCheckInDate || null,
                        checkInStreak: Number(u.checkInStreak || 0),
                        checkInHistory: Array.isArray(u.checkInHistory) ? u.checkInHistory : [],
                        totalReferralCommission: Number(u.totalReferralCommission || 0),
                        betCommissionEarned: Number(u.betCommissionEarned || 0),
                        awardedMilestones: Array.isArray(u.awardedMilestones) ? u.awardedMilestones : [],
                        bonusBalance: Number(u.bonusBalance || 0),
                        createdAt: u.createdAt || new Date().toISOString(),
                        updatedAt: u.updatedAt || new Date().toISOString()
                    };

                    this.engine.users.set(uid, userData);
                    if (userData.inviteCode) {
                        this.engine.referralCodes.set(userData.inviteCode.toUpperCase(), uid);
                    }
                    count++;
                }
            });
            console.log(`[Firebase] Successfully hydrated ${count} permanent users from Firestore into server memory.`);
            if (count > 0 && typeof this.engine._saveUsersToDisk === 'function') {
                this.engine._saveUsersToDisk();
            }
        } catch (err) {
            console.warn('[Firebase] User hydration warning:', err.message);
        }
    }

    async _hydratePendingBetsFromFirestore() {
        try {
            console.log('[Firebase] Hydrating active pending bets from Firestore...');
            const betsCol = collection(db, 'bets');
            const q = query(betsCol, where('status', '==', 'PENDING'));
            const querySnap = await getDocs(q);
            let count = 0;
            querySnap.forEach(docSnap => {
                const bet = docSnap.data();
                if (bet && bet.id) {
                    this.engine.bets.set(bet.id, bet);
                    count++;
                }
            });
            console.log(`[Firebase] Successfully loaded ${count} active pending bets into server memory.`);
        } catch (err) {
            this._handleQuotaError(err);
            console.warn('[Firebase] Active pending bets hydration warning:', err.message);
        }
    }

    async _initSystemConfig() {
        try {
            const configRef = doc(db, 'game_config', 'system');
            const snap = await getDoc(configRef);
            if (snap.exists()) {
                const data = snap.data();
                if (data.multipliers) this.engine.config.multipliers = { ...this.engine.config.multipliers, ...data.multipliers };
                if (data.serviceFeePercent !== undefined) this.engine.config.serviceFeePercent = data.serviceFeePercent;
                if (data.minBetAmount !== undefined) this.engine.config.minBetAmount = data.minBetAmount;
                if (data.maxBetAmount !== undefined) this.engine.config.maxBetAmount = data.maxBetAmount;
                if (data.upiId) this.engine.config.upiId = data.upiId;
                if (data.upiName) this.engine.config.upiName = data.upiName;
                if (data.upiQrImage !== undefined) this.engine.config.upiQrImage = data.upiQrImage;
                if (data.usdtAddress) this.engine.config.usdtAddress = data.usdtAddress;
                if (data.usdtQrImage !== undefined) this.engine.config.usdtQrImage = data.usdtQrImage;
                if (data.usdtUrl !== undefined) this.engine.config.usdtUrl = data.usdtUrl;
                if (data.usdtBep20Address) this.engine.config.usdtBep20Address = data.usdtBep20Address;
                if (data.usdtBep20QrImage !== undefined) this.engine.config.usdtBep20QrImage = data.usdtBep20QrImage;
                if (data.usdtBep20Url !== undefined) this.engine.config.usdtBep20Url = data.usdtBep20Url;
                if (data.usdtRate !== undefined) this.engine.config.usdtRate = data.usdtRate;
                if (data.riskEngine) this.engine.config.riskEngine = { ...this.engine.config.riskEngine, ...data.riskEngine };
                if (data.referralStars) this.engine.config.referralStars = data.referralStars;
                if (data.gameMaintenance) {
                    this.engine.config.gameMaintenance = {
                        enabled: !!data.gameMaintenance.enabled,
                        noticeTitle: data.gameMaintenance.noticeTitle || 'System Upgrade in Progress',
                        noticeMessage: data.gameMaintenance.noticeMessage || 'We are currently undergoing scheduled system maintenance and major game upgrades for the next 2 days! A big surprise awaits you. Stay tuned!',
                        whitelistedUsers: Array.isArray(data.gameMaintenance.whitelistedUsers) ? data.gameMaintenance.whitelistedUsers : []
                    };
                }
                this.engine.config.universalSync = false;
                this.engine.config.syncApiUrl = '';
            } else {
                await setDoc(configRef, {
                    multipliers: this.engine.config.multipliers,
                    serviceFeePercent: this.engine.config.serviceFeePercent,
                    minBetAmount: this.engine.config.minBetAmount,
                    maxBetAmount: this.engine.config.maxBetAmount,
                    riskEngine: this.engine.config.riskEngine,
                    upiId: this.engine.config.upiId || '6289140468@axl',
                    upiName: this.engine.config.upiName || 'Smarty91',
                    upiQrImage: this.engine.config.upiQrImage || '',
                    usdtAddress: this.engine.config.usdtAddress || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
                    usdtQrImage: this.engine.config.usdtQrImage || 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
                    usdtUrl: this.engine.config.usdtUrl || '',
                    usdtBep20Address: this.engine.config.usdtBep20Address || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
                    usdtBep20QrImage: this.engine.config.usdtBep20QrImage || 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
                    usdtBep20Url: this.engine.config.usdtBep20Url || '',
                    usdtRate: this.engine.config.usdtRate || 102,
                    gameMaintenance: this.engine.config.gameMaintenance || {
                        enabled: false,
                        noticeTitle: 'System Upgrade in Progress',
                        noticeMessage: 'We are currently undergoing scheduled system maintenance and major game upgrades for the next 2 days! A big surprise awaits you. Stay tuned!',
                        whitelistedUsers: []
                    },
                    universalSync: false,
                    syncApiUrl: '',
                    updatedAt: new Date().toISOString()
                });
            }

            // Real-time listener for live updates across replicas / portal changes
            onSnapshot(configRef, (docSnap) => {
                if (docSnap.exists()) {
                    const d = docSnap.data();
                    if (d.upiId) this.engine.config.upiId = d.upiId;
                    if (d.upiName) this.engine.config.upiName = d.upiName;
                    if (d.upiQrImage !== undefined) this.engine.config.upiQrImage = d.upiQrImage;
                    if (d.usdtAddress) this.engine.config.usdtAddress = d.usdtAddress;
                    if (d.usdtQrImage !== undefined) this.engine.config.usdtQrImage = d.usdtQrImage;
                    if (d.usdtUrl !== undefined) this.engine.config.usdtUrl = d.usdtUrl;
                    if (d.usdtBep20Address) this.engine.config.usdtBep20Address = d.usdtBep20Address;
                    if (d.usdtBep20QrImage !== undefined) this.engine.config.usdtBep20QrImage = d.usdtBep20QrImage;
                    if (d.usdtBep20Url !== undefined) this.engine.config.usdtBep20Url = d.usdtBep20Url;
                    if (d.usdtRate !== undefined) this.engine.config.usdtRate = d.usdtRate;
                    if (d.riskEngine) this.engine.config.riskEngine = { ...this.engine.config.riskEngine, ...d.riskEngine };
                    if (d.referralStars) this.engine.config.referralStars = d.referralStars;
                    if (d.gameMaintenance) {
                        this.engine.config.gameMaintenance = {
                            enabled: !!d.gameMaintenance.enabled,
                            noticeTitle: d.gameMaintenance.noticeTitle || 'System Upgrade in Progress',
                            noticeMessage: d.gameMaintenance.noticeMessage || 'We are currently undergoing scheduled system maintenance and major game upgrades for the next 2 days! A big surprise awaits you. Stay tuned!',
                            whitelistedUsers: Array.isArray(d.gameMaintenance.whitelistedUsers) ? d.gameMaintenance.whitelistedUsers : []
                        };
                    }
                    this.engine.config.universalSync = false;
                    this.engine.config.syncApiUrl = '';
                }
            });
        } catch (e) {
            console.warn('[Firebase] Config sync warning:', e.message);
        }
    }

    async _initProfitStars() {
        try {
            const starsRef = doc(db, 'game_config', 'profit_stars');
            const snap = await getDoc(starsRef);
            if (snap.exists()) {
                const data = snap.data();
                if (data && data.stars) {
                    this.engine.config.profitStars = { ...this.engine.config.profitStars, ...data.stars };
                    console.log("[Firebase] Loaded Today's Profit Stars from Firestore:", this.engine.config.profitStars);
                }
            } else {
                const defaultStars = this.engine.config.profitStars || {
                    rank1: { first2: '98', last2: '71', amount: '₹1,84,500' },
                    rank2: { first2: '91', last2: '04', amount: '₹1,12,800' },
                    rank3: { first2: '88', last2: '51', amount: '₹76,400' }
                };
                await setDoc(starsRef, {
                    stars: defaultStars,
                    updatedAt: new Date().toISOString()
                });
            }

            // Real-time listener for Profit Stars updates
            onSnapshot(starsRef, (docSnap) => {
                if (docSnap.exists()) {
                    const d = docSnap.data();
                    if (d && d.stars) {
                        this.engine.config.profitStars = d.stars;
                    }
                }
            });
        } catch (e) {
            console.warn('[Firebase] Profit stars init warning:', e.message);
        }
    }

    async saveProfitStars(stars) {
        if (!this._checkQuota()) return;
        try {
            const starsRef = doc(db, 'game_config', 'profit_stars');
            await setDoc(starsRef, {
                stars,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    _listenToUsers() {
        try {
            const usersCol = collection(db, 'users');
            onSnapshot(usersCol, (snapshot) => {
                let updatedCount = 0;
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' || change.type === 'modified') {
                        const u = change.doc.data();
                        const docId = change.doc.id;
                        const uid = (u && u.id) ? u.id : docId;
                        if (uid && uid !== 'default_user') {
                            const existing = this.engine.users.get(uid);
                            
                            // ECHO LOOP SHIELD: If user was modified locally within 15 seconds or has equal/newer local version, protect in-memory balance
                            const isRecentLocalUpdate = existing && existing._lastLocalUpdate && (Date.now() - existing._lastLocalUpdate < 15000);
                            const isRemoteAdminAction = u.lastUpdatedReason && (
                                u.lastUpdatedReason.includes('Admin') || 
                                u.lastUpdatedReason.includes('Deposit') || 
                                u.lastUpdatedReason.includes('Manual') ||
                                u.lastUpdatedReason.includes('Approved') ||
                                u.lastUpdatedReason.includes('Bonus')
                            );

                            let resolvedBalance = 0;
                            if (!existing) {
                                resolvedBalance = Number(u.balance !== undefined ? u.balance : 0);
                            } else if (isRemoteAdminAction) {
                                resolvedBalance = Number(u.balance !== undefined ? u.balance : existing.balance);
                                existing._localVersion = (existing._localVersion || 0) + 1;
                            } else if (isRecentLocalUpdate) {
                                resolvedBalance = existing.balance; // Keep fresh memory balance, drop echo
                            } else if (u._serverVersion && existing._localVersion && u._serverVersion > existing._localVersion) {
                                resolvedBalance = Number(u.balance !== undefined ? u.balance : existing.balance);
                                existing._localVersion = u._serverVersion;
                            } else {
                                resolvedBalance = existing.balance !== undefined ? existing.balance : Number(u.balance || 0);
                            }

                            const updatedUser = {
                                ...(existing || {}),
                                ...u,
                                id: uid,
                                username: u.username || (existing ? existing.username : `usr_${u.phone || 'VIP'}`),
                                phone: u.phone || (existing ? existing.phone : (uid.startsWith('usr_') ? uid.replace('usr_', '') : '')),
                                passwordHash: u.passwordHash || (existing ? existing.passwordHash : ''),
                                securityPin: u.securityPin || (existing ? existing.securityPin : (u.phone ? u.phone.slice(-4) : '1234')),
                                balance: resolvedBalance,
                                _localVersion: (existing && existing._localVersion) ? existing._localVersion : 1,
                                _lastLocalUpdate: (existing && existing._lastLocalUpdate) ? existing._lastLocalUpdate : Date.now(),
                                requiredTurnover: Number(u.requiredTurnover !== undefined ? u.requiredTurnover : (existing ? existing.requiredTurnover : 0)),
                                inviteCode: u.inviteCode || (existing ? existing.inviteCode : ''),
                                referredBy: u.referredBy !== undefined ? u.referredBy : (existing ? existing.referredBy : null),
                                hasDeposited: u.hasDeposited !== undefined ? !!u.hasDeposited : (existing ? existing.hasDeposited : false),
                                isBlocked: !!u.isBlocked,
                                lastCheckInDate: u.lastCheckInDate || (existing ? existing.lastCheckInDate : null),
                                checkInStreak: Number(u.checkInStreak !== undefined ? u.checkInStreak : (existing ? existing.checkInStreak : 0)),
                                checkInHistory: Array.isArray(u.checkInHistory) ? u.checkInHistory : (existing && Array.isArray(existing.checkInHistory) ? existing.checkInHistory : []),
                                totalReferralCommission: Number(u.totalReferralCommission !== undefined ? u.totalReferralCommission : (existing ? existing.totalReferralCommission : 0)),
                                betCommissionEarned: Number(u.betCommissionEarned !== undefined ? u.betCommissionEarned : (existing ? existing.betCommissionEarned : 0)),
                                awardedMilestones: Array.isArray(u.awardedMilestones) ? u.awardedMilestones : (existing && Array.isArray(existing.awardedMilestones) ? existing.awardedMilestones : []),
                                bonusBalance: Number(u.bonusBalance !== undefined ? u.bonusBalance : (existing ? existing.bonusBalance : 0)),
                                createdAt: u.createdAt || (existing ? existing.createdAt : new Date().toISOString()),
                                updatedAt: u.updatedAt || new Date().toISOString()
                            };

                            this.engine.users.set(uid, updatedUser);
                            if (updatedUser.inviteCode) {
                                this.engine.referralCodes.set(updatedUser.inviteCode.toUpperCase(), uid);
                            }
                            updatedCount++;
                        }
                    }
                });
                if (updatedCount > 0 && typeof this.engine._saveUsersToDisk === 'function') {
                    this.engine._saveUsersToDisk();
                }
            }, (err) => {
                console.warn('[Firebase] Users snapshot listener error:', err.message);
            });
        } catch (e) {
            console.warn('[Firebase] Users listener setup error:', e.message);
        }
    }

    async fetchUserFromFirestore(userId) {
        if (!userId) return null;
        try {
            const userRef = doc(db, 'users', userId);
            const snap = await getDoc(userRef);
            if (snap.exists()) {
                const u = snap.data();
                const userData = {
                    id: u.id,
                    username: u.username || `usr_${u.phone || 'VIP'}`,
                    phone: u.phone || '',
                    passwordHash: u.passwordHash || '',
                    securityPin: u.securityPin || (u.phone ? u.phone.slice(-4) : '1234'),
                    balance: Number(u.balance !== undefined ? u.balance : 0),
                    requiredTurnover: Number(u.requiredTurnover !== undefined ? u.requiredTurnover : 0),
                    inviteCode: u.inviteCode || '',
                    referredBy: u.referredBy || null,
                    hasDeposited: !!u.hasDeposited,
                    isBlocked: !!u.isBlocked,
                    lastCheckInDate: u.lastCheckInDate || null,
                    checkInStreak: Number(u.checkInStreak || 0),
                    checkInHistory: Array.isArray(u.checkInHistory) ? u.checkInHistory : [],
                    totalReferralCommission: Number(u.totalReferralCommission || 0),
                    betCommissionEarned: Number(u.betCommissionEarned || 0),
                    awardedMilestones: Array.isArray(u.awardedMilestones) ? u.awardedMilestones : [],
                    createdAt: u.createdAt || new Date().toISOString()
                };
                this.engine.users.set(userData.id, userData);
                if (userData.inviteCode) {
                    this.engine.referralCodes.set(userData.inviteCode, userData.id);
                }
                if (typeof this.engine._saveUsersToDisk === 'function') {
                    this.engine._saveUsersToDisk();
                }
                return userData;
            }
        } catch (e) {
            console.warn('[Firebase] fetchUserFromFirestore error:', e.message);
        }
        return null;
    }

    async fetchUserByPhoneFromFirestore(phone) {
        if (!phone) return null;
        try {
            const cleanPhone = String(phone).trim();
            const usersCol = collection(db, 'users');
            const q = query(usersCol, where('phone', '==', cleanPhone), limit(1));
            const querySnap = await getDocs(q);
            if (!querySnap.empty) {
                const docSnap = querySnap.docs[0];
                const u = docSnap.data();
                const userData = {
                    id: u.id,
                    username: u.username || `usr_${u.phone || 'VIP'}`,
                    phone: u.phone || '',
                    passwordHash: u.passwordHash || '',
                    securityPin: u.securityPin || (u.phone ? u.phone.slice(-4) : '1234'),
                    balance: Number(u.balance !== undefined ? u.balance : 0),
                    requiredTurnover: Number(u.requiredTurnover !== undefined ? u.requiredTurnover : 0),
                    inviteCode: u.inviteCode || '',
                    referredBy: u.referredBy || null,
                    hasDeposited: !!u.hasDeposited,
                    isBlocked: !!u.isBlocked,
                    lastCheckInDate: u.lastCheckInDate || null,
                    checkInStreak: Number(u.checkInStreak || 0),
                    checkInHistory: Array.isArray(u.checkInHistory) ? u.checkInHistory : [],
                    totalReferralCommission: Number(u.totalReferralCommission || 0),
                    betCommissionEarned: Number(u.betCommissionEarned || 0),
                    awardedMilestones: Array.isArray(u.awardedMilestones) ? u.awardedMilestones : [],
                    createdAt: u.createdAt || new Date().toISOString()
                };
                this.engine.users.set(userData.id, userData);
                if (userData.inviteCode) {
                    this.engine.referralCodes.set(userData.inviteCode, userData.id);
                }
                if (typeof this.engine._saveUsersToDisk === 'function') {
                    this.engine._saveUsersToDisk();
                }
                return userData;
            }
        } catch (e) {
            console.warn('[Firebase] fetchUserByPhoneFromFirestore error:', e.message);
        }
        return null;
    }

    async deleteUserFromFirestore(userId) {
        if (!this._checkQuota()) return;
        try {
            // 1. Delete user profile document
            const userRef = doc(db, 'users', userId);
            await deleteDoc(userRef);
            console.log(`[Firebase] Deleted user ${userId} profile from Firestore`);

            // 2. Delete all historical bets for this user
            try {
                const betsCol = collection(db, 'bets');
                const betsQuery = query(betsCol, where('userId', '==', userId));
                const betsSnap = await getDocs(betsQuery);
                const deleteBetsPromises = [];
                betsSnap.forEach(docSnap => {
                    deleteBetsPromises.push(deleteDoc(docSnap.ref));
                });
                if (deleteBetsPromises.length > 0) {
                    await Promise.all(deleteBetsPromises);
                    console.log(`[Firebase] Deleted ${deleteBetsPromises.length} bets for user ${userId} from Firestore`);
                }
            } catch (err) {
                console.warn(`[Firebase] Error deleting bets for user ${userId}:`, err.message);
            }

            // 3. Delete all transactions / ledger documents for this user
            try {
                const txCol = collection(db, 'transactions');
                const txQuery = query(txCol, where('userId', '==', userId));
                const txSnap = await getDocs(txQuery);
                const deleteTxPromises = [];
                txSnap.forEach(docSnap => {
                    deleteTxPromises.push(deleteDoc(docSnap.ref));
                });
                if (deleteTxPromises.length > 0) {
                    await Promise.all(deleteTxPromises);
                    console.log(`[Firebase] Deleted ${deleteTxPromises.length} transactions for user ${userId} from Firestore`);
                }
            } catch (err) {
                console.warn(`[Firebase] Error deleting transactions for user ${userId}:`, err.message);
            }
        } catch (err) {
            console.error(`[Firebase] Error deleting user ${userId} from Firestore:`, err.message);
        }
    }

    async deleteAllUsersFromFirestore() {
        if (!this._checkQuota()) return;
        try {
            console.log('[Firebase] Starting full wipe of all users, bets, and transactions from Firestore...');
            
            // 1. Delete all documents in 'users' collection
            try {
                const usersCol = collection(db, 'users');
                const usersSnap = await getDocs(usersCol);
                const deletePromises = [];
                usersSnap.forEach(docSnap => {
                    deletePromises.push(deleteDoc(docSnap.ref));
                });
                if (deletePromises.length > 0) {
                    await Promise.all(deletePromises);
                    console.log(`[Firebase] Deleted ${deletePromises.length} users from Firestore`);
                }
            } catch (e) {
                console.warn('[Firebase] Error deleting all users:', e.message);
            }

            // 2. Delete all documents in 'bets' collection
            try {
                const betsCol = collection(db, 'bets');
                const betsSnap = await getDocs(betsCol);
                const deletePromises = [];
                betsSnap.forEach(docSnap => {
                    deletePromises.push(deleteDoc(docSnap.ref));
                });
                if (deletePromises.length > 0) {
                    await Promise.all(deletePromises);
                    console.log(`[Firebase] Deleted ${deletePromises.length} bets from Firestore`);
                }
            } catch (e) {
                console.warn('[Firebase] Error deleting all bets:', e.message);
            }

            // 3. Delete all documents in 'transactions' collection
            try {
                const txCol = collection(db, 'transactions');
                const txSnap = await getDocs(txCol);
                const deletePromises = [];
                txSnap.forEach(docSnap => {
                    deletePromises.push(deleteDoc(docSnap.ref));
                });
                if (deletePromises.length > 0) {
                    await Promise.all(deletePromises);
                    console.log(`[Firebase] Deleted ${deletePromises.length} transactions from Firestore`);
                }
            } catch (e) {
                console.warn('[Firebase] Error deleting all transactions:', e.message);
            }

            console.log('[Firebase] Full wipe of Firestore users & data completed.');
        } catch (err) {
            console.error('[Firebase] Error in deleteAllUsersFromFirestore:', err.message);
        }
    }

    _listenToAdminOverrides() {
        try {
            const overridesCol = collection(db, 'game_overrides');
            onSnapshot(overridesCol, (snapshot) => {
                snapshot.forEach(docSnap => {
                    const mode = docSnap.id;
                    const data = docSnap.data();
                    if (this.engine.modes[mode]) {
                        const prev = this.engine.adminOverrides[mode];
                        this.engine.adminOverrides[mode] = data.forcedOutcome !== undefined ? data.forcedOutcome : null;
                        if (prev !== this.engine.adminOverrides[mode] && this.engine.adminOverrides[mode] !== null) {
                            console.log(`[Firebase Override Triggered] Mode ${mode} forced result set to: ${this.engine.adminOverrides[mode]}`);
                        }
                    }
                });
            }, (err) => {
                console.warn('[Firebase] Overrides listener warning:', err.message);
            });
        } catch (e) {
            console.warn('[Firebase] Overrides setup error:', e.message);
        }
    }

    async savePeriodState(mode, periodData) {
        try {
            const periodRef = doc(db, 'game_periods', mode);
            await setDoc(periodRef, {
                mode,
                periodId: periodData.currentPeriodId,
                remainingSeconds: periodData.remainingSeconds,
                isLocked: periodData.isLocked,
                isPaused: !!periodData.isPaused,
                pausePending: !!periodData.pausePending,
                currentEndTimeMs: periodData.currentEndTimeMs,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            // non-blocking
        }
    }

    async saveSettledRound(mode, roundRecord) {
        if (!this._checkQuota()) return;
        try {
            const historyId = `${mode}_${roundRecord.period}`;
            const historyRef = doc(db, 'game_history', historyId);
            await setDoc(historyRef, {
                id: historyId,
                mode,
                periodId: roundRecord.period,
                number: roundRecord.number,
                color: roundRecord.color,
                size: roundRecord.size,
                colorLabel: roundRecord.colorLabel,
                timestamp: Date.now(),
                settledAt: roundRecord.settledAt,
                isOverridden: !!roundRecord.isOverridden
            });

            // Maintain latest 50 rounds summary document for instant 1-read retrieval
            const summaryRef = doc(db, 'game_history_summary', mode);
            const currentHistory = (this.engine.modes[mode] && this.engine.modes[mode].history) ? this.engine.modes[mode].history.slice(0, 50) : [roundRecord];
            await setDoc(summaryRef, {
                mode,
                rounds: currentHistory,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            // If this round was overridden, clear the override document in Firestore
            if (roundRecord.isOverridden) {
                const overrideRef = doc(db, 'game_overrides', mode);
                await setDoc(overrideRef, {
                    mode,
                    forcedOutcome: null,
                    updatedAt: new Date().toISOString()
                });
            }
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async saveBet(betOrder) {
        if (!this._checkQuota()) return;
        try {
            const betRef = doc(db, 'bets', betOrder.id);
            await setDoc(betRef, {
                ...betOrder,
                updatedAt: new Date().toISOString()
            });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async updateBetSettlement(betOrder) {
        if (!this._checkQuota()) return;
        try {
            const betRef = doc(db, 'bets', betOrder.id);
            await setDoc(betRef, {
                id: betOrder.id,
                ...betOrder,
                status: betOrder.status,
                payoutAmount: betOrder.payoutAmount,
                resultNumber: betOrder.resultNumber,
                resultColor: betOrder.resultColor,
                resultSize: betOrder.resultSize,
                settledAt: betOrder.settledAt,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async batchUpdateBetSettlements(bets) {
        if (!Array.isArray(bets) || bets.length === 0 || !this._checkQuota()) return;
        try {
            const batch = writeBatch(db);
            let count = 0;
            for (const bet of bets.slice(0, 450)) {
                if (bet && bet.id) {
                    const betRef = doc(db, 'bets', bet.id);
                    batch.set(betRef, {
                        id: bet.id,
                        status: bet.status,
                        payoutAmount: Number(bet.payoutAmount || 0),
                        resultNumber: bet.resultNumber,
                        resultColor: bet.resultColor,
                        resultSize: bet.resultSize,
                        settledAt: bet.settledAt || new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    }, { merge: true });
                    count++;
                }
            }
            if (count > 0) {
                await batch.commit();
            }
        } catch (e) {
            this._handleQuotaError(e);
            console.warn('[Firebase] batchUpdateBetSettlements note:', e.message);
        }
    }

    async placeBetTransaction(userId, totalAmount, betOrder, ledgerEntry) {
        if (!this._checkQuota()) throw new Error('System busy');
        return await runTransaction(db, async (transaction) => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await transaction.get(userRef);
            if (!userSnap.exists()) {
                throw new Error("User account not found in database");
            }

            const userData = userSnap.data();
            const currentBalance = Number(userData.balance || 0);
            
            if (currentBalance < totalAmount) {
                throw new Error("Insufficient wallet balance");
            }

            const newBalance = Number((currentBalance - totalAmount).toFixed(2));
            
            // Deduct balance
            transaction.update(userRef, { 
                balance: newBalance,
                lastUpdatedReason: 'Bet placed',
                updatedAt: new Date().toISOString()
            });

            // Save Bet
            const betRef = doc(db, 'bets', betOrder.id);
            transaction.set(betRef, {
                ...betOrder,
                updatedAt: new Date().toISOString()
            });

            // Save Ledger
            if (ledgerEntry) {
                const ledgerRef = doc(db, 'transactions', ledgerEntry.id);
                transaction.set(ledgerRef, {
                    ...ledgerEntry,
                    balanceBefore: currentBalance,
                    balanceAfter: newBalance,
                    timestamp: Date.now(),
                    updatedAt: new Date().toISOString()
                });
            }

            return newBalance;
        });
    }

    async settleWinningBetTransaction(userId, payoutAmount, betOrder, ledgerEntry) {
        if (!this._checkQuota()) return;
        try {
            return await runTransaction(db, async (transaction) => {
                const userRef = doc(db, 'users', userId);
                const userSnap = await transaction.get(userRef);
                
                let currentBalance = 0;
                if (userSnap.exists()) {
                    currentBalance = Number(userSnap.data().balance || 0);
                } else {
                    const engineUser = this.engine.users.get(userId);
                    currentBalance = engineUser ? Number(engineUser.balance || 0) : 0;
                }

                const newBalance = Number((currentBalance + payoutAmount).toFixed(2));
                
                transaction.set(userRef, {
                    id: userId,
                    balance: newBalance,
                    lastBalanceUpdate: new Date().toISOString(),
                    lastUpdatedReason: 'Round win payout',
                    updatedAt: new Date().toISOString()
                }, { merge: true });

                const betRef = doc(db, 'bets', betOrder.id);
                transaction.set(betRef, {
                    id: betOrder.id,
                    ...betOrder,
                    status: betOrder.status,
                    payoutAmount: betOrder.payoutAmount,
                    resultNumber: betOrder.resultNumber,
                    resultColor: betOrder.resultColor,
                    resultSize: betOrder.resultSize,
                    settledAt: betOrder.settledAt,
                    updatedAt: new Date().toISOString()
                }, { merge: true });

                if (ledgerEntry) {
                    const ledgerRef = doc(db, 'transactions', ledgerEntry.id);
                    transaction.set(ledgerRef, {
                        ...ledgerEntry,
                        balanceBefore: currentBalance,
                        balanceAfter: newBalance,
                        timestamp: Date.now(),
                        updatedAt: new Date().toISOString()
                    }, { merge: true });
                }
            });
        } catch (err) {
            console.warn(`[Firebase] Settle win fallback for user ${userId}:`, err.message);
            const engineUser = this.engine.users.get(userId);
            const fallbackBal = engineUser ? engineUser.balance : 0;
            await this.updateUserBalance(userId, fallbackBal, 'Round win payout fallback');
            await this.updateBetSettlement(betOrder);
        }
    }

    async saveUser(user) {
        if (!user || !this._checkQuota()) return;
        try {
            const canonicalId = (user.id && !user.id.startsWith('usr_') && !isNaN(Number(user.id)) && user.id !== 'default_user') ? 'usr_' + user.id : user.id;
            const userRef = doc(db, 'users', canonicalId);
            await setDoc(userRef, {
                id: canonicalId,
                username: user.username,
                phone: user.phone || (canonicalId.startsWith('usr_') ? canonicalId.replace('usr_', '') : ''),
                passwordHash: user.passwordHash || '',
                securityPin: user.securityPin || '',
                balance: Number(user.balance !== undefined ? user.balance : 0),
                requiredTurnover: Number(user.requiredTurnover !== undefined ? user.requiredTurnover : 0),
                inviteCode: user.inviteCode || '',
                referredBy: user.referredBy || null,
                hasDeposited: !!user.hasDeposited,
                isBlocked: !!user.isBlocked,
                lastCheckInDate: user.lastCheckInDate || null,
                checkInStreak: Number(user.checkInStreak || 0),
                checkInHistory: Array.isArray(user.checkInHistory) ? user.checkInHistory.slice(-30) : [],
                totalReferralCommission: Number(user.totalReferralCommission || 0),
                betCommissionEarned: Number(user.betCommissionEarned || 0),
                awardedMilestones: Array.isArray(user.awardedMilestones) ? user.awardedMilestones : [],
                bonusBalance: Number(user.bonusBalance || 0),
                createdAt: user.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async getUserBets(userId, mode) {
        if (!this._checkQuota()) return [];
        try {
            const betsCol = collection(db, 'bets');
            // Query by userId (simple single-field index always exists by default in Firestore)
            const q = query(betsCol, where('userId', '==', userId));
            const querySnap = await getDocs(q);
            const userBets = [];
            
            const targetMode = mode ? String(mode).toLowerCase().replace('wingo', '').trim() : null;

            querySnap.forEach(docSnap => {
                const data = docSnap.data();
                if (data) {
                    if (targetMode) {
                        const betMode = String(data.mode || '').toLowerCase().replace('wingo', '').trim();
                        if (betMode === targetMode || data.mode === mode) {
                            userBets.push(data);
                        }
                    } else {
                        userBets.push(data);
                    }
                }
            });
            
            // Sort in-memory descending by placedAt
            userBets.sort((a, b) => {
                const timeA = a.placedAt ? (typeof a.placedAt === 'string' ? new Date(a.placedAt).getTime() : a.placedAt) : 0;
                const timeB = b.placedAt ? (typeof b.placedAt === 'string' ? new Date(b.placedAt).getTime() : b.placedAt) : 0;
                return timeB - timeA;
            });
            
            return userBets.slice(0, 500);
        } catch (e) {
            console.warn('[Firebase] getUserBets error:', e.message);
            return [];
        }
    }

    async _syncUserToFirestore(user) {
        return this.saveUser(user);
    }

    async updateUserBalance(userId, newBalance, reason = '', bonusBalance = undefined) {
        if (!this._checkQuota() || !userId) return;
        try {
            const canonicalId = (typeof userId === 'string' && !userId.startsWith('usr_') && !isNaN(Number(userId)) && userId !== 'default_user') ? 'usr_' + userId : userId;
            const userRef = doc(db, 'users', canonicalId);
            const updatePayload = {
                id: canonicalId,
                balance: Number(newBalance),
                lastUpdatedReason: reason,
                updatedAt: new Date().toISOString()
            };
            if (bonusBalance !== undefined) {
                updatePayload.bonusBalance = Number(bonusBalance);
            }
            await setDoc(userRef, updatePayload, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async incrementUserBalance(userId, amount, reason = '') {
        if (!this._checkQuota() || !userId) return;
        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount === 0) return;
        try {
            const canonicalId = (typeof userId === 'string' && !userId.startsWith('usr_') && !isNaN(Number(userId)) && userId !== 'default_user') ? 'usr_' + userId : userId;
            const userRef = doc(db, 'users', canonicalId);
            await updateDoc(userRef, {
                balance: increment(numAmount),
                lastUpdatedReason: reason,
                updatedAt: new Date().toISOString()
            });
        } catch (e) {
            console.warn('[Firebase] incrementUserBalance error, attempting setDoc fallback:', e.message);
            try {
                const canonicalId = (typeof userId === 'string' && !userId.startsWith('usr_') && !isNaN(Number(userId)) && userId !== 'default_user') ? 'usr_' + userId : userId;
                const userRef = doc(db, 'users', canonicalId);
                await setDoc(userRef, {
                    id: canonicalId,
                    balance: increment(numAmount),
                    lastUpdatedReason: reason,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            } catch (err) {
                this._handleQuotaError(err);
            }
        }
    }

    async logAdminAction(action, details) {
        if (!this._checkQuota()) return;
        try {
            const logId = 'LOG_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const logRef = doc(db, 'audit_logs', logId);
            await setDoc(logRef, {
                id: logId,
                action,
                details,
                timestamp: Date.now(),
                createdAt: new Date().toISOString()
            });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async setAdminOverride(mode, outcome) {
        if (!this._checkQuota()) return;
        try {
            const overrideRef = doc(db, 'game_overrides', mode);
            await setDoc(overrideRef, {
                mode,
                forcedOutcome: outcome !== null && outcome !== undefined ? Number(outcome) : null,
                updatedAt: new Date().toISOString()
            });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async saveTransaction(tx) {
        if (!this._checkQuota()) return;
        try {
            const txRef = doc(db, 'transactions', tx.id);
            await setDoc(txRef, {
                ...tx,
                timestamp: Date.now(),
                updatedAt: new Date().toISOString()
            });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async updateTransaction(tx) {
        if (!this._checkQuota()) return;
        try {
            const txRef = doc(db, 'transactions', tx.id);
            await setDoc(txRef, {
                status: tx.status,
                processedAt: tx.processedAt || new Date().toISOString(),
                adminRemarks: tx.adminRemarks || '',
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async saveSystemConfig(config) {
        if (!this._checkQuota()) return;
        try {
            const configRef = doc(db, 'game_config', 'system');
            await setDoc(configRef, {
                multipliers: config.multipliers,
                serviceFeePercent: config.serviceFeePercent,
                minBetAmount: config.minBetAmount,
                maxBetAmount: config.maxBetAmount,
                riskEngine: config.riskEngine,
                probabilities: config.probabilities,
                modes: config.modes,
                upiId: config.upiId || '6289140468@axl',
                upiName: config.upiName || 'Smarty91',
                upiQrImage: config.upiQrImage || '',
                usdtAddress: config.usdtAddress || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
                usdtQrImage: config.usdtQrImage || 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
                usdtUrl: config.usdtUrl || '',
                usdtBep20Address: config.usdtBep20Address || '0xce0b6eecaf9Ff7Cb6c58092cD4b1C5Feb945fF8c',
                usdtBep20QrImage: config.usdtBep20QrImage || 'https://cdn.imageurlgenerator.com/uploads/cc15bb4b-e40a-403f-a63b-70b59d4e14ba.jpg',
                usdtBep20Url: config.usdtBep20Url || '',
                usdtRate: config.usdtRate || 102,
                referralStars: config.referralStars || null,
                gameMaintenance: config.gameMaintenance || {
                    enabled: false,
                    noticeTitle: 'System Upgrade in Progress',
                    noticeMessage: 'We are currently undergoing scheduled system maintenance and major game upgrades for the next 2 days! A big surprise awaits you. Stay tuned!',
                    whitelistedUsers: []
                },
                universalSync: false,
                syncApiUrl: '',
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async fetchPendingBetsForPeriod(mode, periodId) {
        if (!this._checkQuota()) return [];
        try {
            const betsCol = collection(db, 'bets');
            const q = query(
                betsCol,
                where('mode', '==', mode),
                where('periodId', '==', periodId),
                where('status', '==', 'PENDING')
            );
            const querySnap = await getDocs(q);
            const bets = [];
            querySnap.forEach(docSnap => {
                const b = docSnap.data();
                if (b && b.id) {
                    bets.push(b);
                }
            });
            return bets;
        } catch (err) {
            this._handleQuotaError(err);
            console.warn(`[Firebase] fetchPendingBetsForPeriod error for mode=${mode} period=${periodId}:`, err.message);
            return [];
        }
    }

    async savePreDecidedOutcome(mode, periodId, outcomeResult) {
        if (!this._checkQuota()) return;
        try {
            const outcomeId = `${mode}_${periodId}`;
            const outcomeRef = doc(db, 'game_predecided_outcomes', outcomeId);
            await setDoc(outcomeRef, {
                id: outcomeId,
                mode,
                periodId,
                number: outcomeResult.number,
                isOverridden: !!outcomeResult.isOverridden,
                reason: outcomeResult.reason || 'PRE_DECIDED_LOCK',
                lockedAt: new Date().toISOString()
            });
        } catch (err) {
            this._handleQuotaError(err);
            console.warn(`[Firebase] savePreDecidedOutcome error for ${mode} period ${periodId}:`, err.message);
        }
    }

    async fetchPreDecidedOutcome(mode, periodId) {
        if (!this._checkQuota()) return null;
        try {
            const outcomeId = `${mode}_${periodId}`;
            const outcomeRef = doc(db, 'game_predecided_outcomes', outcomeId);
            const snap = await getDoc(outcomeRef);
            if (snap.exists()) {
                const data = snap.data();
                return {
                    number: Number(data.number),
                    isOverridden: !!data.isOverridden,
                    reason: data.reason || 'PRE_DECIDED_FIRESTORE'
                };
            }
            return null;
        } catch (err) {
            this._handleQuotaError(err);
            console.warn(`[Firebase] fetchPreDecidedOutcome error for ${mode} period ${periodId}:`, err.message);
            return null;
        }
    }
}

export const firebaseSync = new FirebaseSyncManager();
