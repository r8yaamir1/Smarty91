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
    runTransaction
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

            // 4. Hydrate real game history from Firestore for all 4 modes
            await this._hydrateHistoryFromFirestore();

            // 5. Sync default user if not already existing
            await this._syncUserToFirestore(this.engine.users.get('default_user'));

            this.isInitialized = true;
            console.log('[Firebase] Firestore Server sync ready & live!');
        } catch (err) {
            this._handleQuotaError(err);
            console.error('[Firebase] Init error (will retry in background):', err.message);
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
                            this.engine.modes[mode].history = data.rounds.slice(0, 50);
                            console.log(`[Firebase] Hydrated ${this.engine.modes[mode].history.length} real history rounds for mode ${mode}`);
                        }
                    }
                } catch (e) {
                    // Non-blocking fallback
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
                if (u && u.id && u.id !== 'default_user') {
                    this.engine.users.set(u.id, {
                        id: u.id,
                        username: u.username || `usr_${u.phone || 'VIP'}`,
                        phone: u.phone || '',
                        passwordHash: u.passwordHash || '',
                        securityPin: u.securityPin || (u.phone ? u.phone.slice(-4) : '1234'),
                        balance: Number(u.balance !== undefined ? u.balance : 0),
                        inviteCode: u.inviteCode || '',
                        referredBy: u.referredBy || null,
                        hasDeposited: !!u.hasDeposited,
                        isBlocked: !!u.isBlocked,
                        createdAt: u.createdAt || new Date().toISOString()
                    });
                    if (u.inviteCode) {
                        this.engine.referralCodes.set(u.inviteCode, u.id);
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
            } else {
                await setDoc(configRef, {
                    multipliers: this.engine.config.multipliers,
                    serviceFeePercent: this.engine.config.serviceFeePercent,
                    minBetAmount: this.engine.config.minBetAmount,
                    maxBetAmount: this.engine.config.maxBetAmount,
                    upiId: this.engine.config.upiId || '6289140468@axl',
                    upiName: this.engine.config.upiName || 'Smarty91',
                    updatedAt: new Date().toISOString()
                });
            }

            // Real-time listener for live updates across replicas / portal changes
            onSnapshot(configRef, (docSnap) => {
                if (docSnap.exists()) {
                    const d = docSnap.data();
                    if (d.upiId) this.engine.config.upiId = d.upiId;
                    if (d.upiName) this.engine.config.upiName = d.upiName;
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
                        if (u && u.id && u.id !== 'default_user') {
                            this.engine.users.set(u.id, {
                                id: u.id,
                                username: u.username || `usr_${u.phone || 'VIP'}`,
                                phone: u.phone || '',
                                passwordHash: u.passwordHash || '',
                                securityPin: u.securityPin || (u.phone ? u.phone.slice(-4) : '1234'),
                                balance: Number(u.balance !== undefined ? u.balance : 0),
                                inviteCode: u.inviteCode || '',
                                referredBy: u.referredBy || null,
                                hasDeposited: !!u.hasDeposited,
                                isBlocked: !!u.isBlocked,
                                createdAt: u.createdAt || new Date().toISOString()
                            });
                            if (u.inviteCode) {
                                this.engine.referralCodes.set(u.inviteCode, u.id);
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
                    inviteCode: u.inviteCode || '',
                    referredBy: u.referredBy || null,
                    hasDeposited: !!u.hasDeposited,
                    isBlocked: !!u.isBlocked,
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
                    inviteCode: u.inviteCode || '',
                    referredBy: u.referredBy || null,
                    hasDeposited: !!u.hasDeposited,
                    isBlocked: !!u.isBlocked,
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
            await updateDoc(betRef, {
                status: betOrder.status,
                payoutAmount: betOrder.payoutAmount,
                resultNumber: betOrder.resultNumber,
                resultColor: betOrder.resultColor,
                resultSize: betOrder.resultSize,
                settledAt: betOrder.settledAt,
                updatedAt: new Date().toISOString()
            });
        } catch (e) {
            this._handleQuotaError(e);
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
        return await runTransaction(db, async (transaction) => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await transaction.get(userRef);
            
            let currentBalance = 0;
            if (userSnap.exists()) {
                currentBalance = Number(userSnap.data().balance || 0);
            } else {
                // If the user somehow doesn't exist, we must recreate their profile securely
                // However, they placed a bet, so they must exist. 
                throw new Error("User account not found for settlement");
            }

            const newBalance = Number((currentBalance + payoutAmount).toFixed(2));
            
            transaction.update(userRef, {
                balance: newBalance,
                lastUpdatedReason: 'Round win payout',
                updatedAt: new Date().toISOString()
            });

            const betRef = doc(db, 'bets', betOrder.id);
            transaction.update(betRef, {
                status: betOrder.status,
                payoutAmount: betOrder.payoutAmount,
                resultNumber: betOrder.resultNumber,
                resultColor: betOrder.resultColor,
                resultSize: betOrder.resultSize,
                settledAt: betOrder.settledAt,
                updatedAt: new Date().toISOString()
            });

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
        });
    }

    async saveUser(user) {
        if (!user || !this._checkQuota()) return;
        try {
            const userRef = doc(db, 'users', user.id);
            await setDoc(userRef, {
                id: user.id,
                username: user.username,
                phone: user.phone || '',
                passwordHash: user.passwordHash || '',
                securityPin: user.securityPin || '',
                balance: Number(user.balance !== undefined ? user.balance : 0),
                inviteCode: user.inviteCode || '',
                referredBy: user.referredBy || null,
                hasDeposited: !!user.hasDeposited,
                isBlocked: !!user.isBlocked,
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
            // Query without orderBy to eliminate the requirement for composite index
            const q = query(betsCol, where('userId', '==', userId), where('mode', '==', mode));
            const querySnap = await getDocs(q);
            const userBets = [];
            querySnap.forEach(docSnap => {
                userBets.push(docSnap.data());
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

    async updateUserBalance(userId, newBalance, reason = '') {
        if (!this._checkQuota()) return;
        try {
            const userRef = doc(db, 'users', userId);
            await setDoc(userRef, {
                id: userId,
                balance: Number(newBalance),
                lastUpdatedReason: reason,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async incrementUserBalance(userId, amount, reason = '') {
        if (!this._checkQuota()) return;
        try {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
                balance: increment(Number(amount)),
                lastUpdatedReason: reason,
                updatedAt: new Date().toISOString()
            });
        } catch (e) {
            console.warn('[Firebase] incrementUserBalance error, attempting setDoc fallback:', e.message);
            try {
                const userRef = doc(db, 'users', userId);
                await setDoc(userRef, {
                    id: userId,
                    balance: increment(Number(amount)),
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
            await updateDoc(txRef, {
                status: tx.status,
                processedAt: tx.processedAt,
                adminRemarks: tx.adminRemarks,
                updatedAt: new Date().toISOString()
            });
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
                probabilities: config.probabilities,
                modes: config.modes,
                upiId: config.upiId || '6289140468@axl',
                upiName: config.upiName || 'Smarty91',
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }
}

export const firebaseSync = new FirebaseSyncManager();
