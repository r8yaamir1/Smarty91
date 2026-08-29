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
    getDocs
} from 'firebase/firestore';

export const firebaseConfig = {
    projectId: "gen-lang-client-0741491943",
    appId: "1:609525333469:web:38d4a4133c9d733345ca34",
    apiKey: "AIzaSyCHcQ5xllJMeM4MfcL_Iqm_kyTeZav0-Kw",
    authDomain: "gen-lang-client-0741491943.firebaseapp.com",
    firestoreDatabaseId: "ai-studio-smarty91-c085ecfd-c192-460f-a360-f400d1df3690",
    storageBucket: "gen-lang-client-0741491943.firebasestorage.app",
    messagingSenderId: "609525333469"
};

let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

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

            // 2. Listen in real-time to Admin Overrides from Firestore
            this._listenToAdminOverrides();

            // 3. Sync default user
            await this._syncUserToFirestore(this.engine.users.get('default_user'));

            this.isInitialized = true;
            console.log('[Firebase] Firestore Server sync ready & live!');
        } catch (err) {
            this._handleQuotaError(err);
            console.error('[Firebase] Init error (will retry in background):', err.message);
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
            } else {
                await setDoc(configRef, {
                    multipliers: this.engine.config.multipliers,
                    serviceFeePercent: this.engine.config.serviceFeePercent,
                    minBetAmount: this.engine.config.minBetAmount,
                    maxBetAmount: this.engine.config.maxBetAmount,
                    updatedAt: new Date().toISOString()
                });
            }
        } catch (e) {
            console.warn('[Firebase] Config sync warning:', e.message);
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

    async _syncUserToFirestore(user) {
        if (!user || !this._checkQuota()) return;
        try {
            const userRef = doc(db, 'users', user.id);
            await setDoc(userRef, {
                id: user.id,
                username: user.username,
                phone: user.phone || '9876543210',
                balance: user.balance,
                isBlocked: !!user.isBlocked,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }

    async updateUserBalance(userId, newBalance, reason = '') {
        if (!this._checkQuota()) return;
        try {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
                balance: newBalance,
                lastUpdatedReason: reason,
                updatedAt: new Date().toISOString()
            });
        } catch (e) {
            this._handleQuotaError(e);
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
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            this._handleQuotaError(e);
        }
    }
}

export const firebaseSync = new FirebaseSyncManager();
