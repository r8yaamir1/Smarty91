// js/services/firebaseClient.js - Client Firebase & Firestore Realtime Integration
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
    serverTimestamp
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

// Helper functions for Realtime Subscriptions
export function subscribeToGamePeriod(mode, callback) {
    const periodDoc = doc(db, 'game_periods', mode);
    return onSnapshot(periodDoc, (snapshot) => {
        if (snapshot.exists()) {
            callback(snapshot.data());
        }
    }, (err) => {
        console.warn(`Firestore period sync warning [${mode}]:`, err);
    });
}

export function subscribeToGameHistory(mode, callback) {
    const summaryDoc = doc(db, 'game_history_summary', mode);
    return onSnapshot(summaryDoc, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            if (data && Array.isArray(data.rounds)) {
                // Return pre-compiled history sorted by timestamp/settledAt descending
                const sorted = [...data.rounds].sort((a, b) => {
                    const tA = Number(a.timestamp || a.settledAt || 0);
                    const tB = Number(b.timestamp || b.settledAt || 0);
                    return tB - tA;
                });
                callback(sorted);
                return;
            }
        }
        
        // Fallback: query game_history collection without orderBy to avoid index errors, then sort in-memory
        try {
            const historyCol = collection(db, 'game_history');
            const q = query(historyCol, where('mode', '==', mode), limit(100));
            onSnapshot(q, (snap) => {
                const history = [];
                snap.forEach(d => history.push(d.data()));
                history.sort((a, b) => {
                    const tA = Number(a.timestamp || a.settledAt || 0);
                    const tB = Number(b.timestamp || b.settledAt || 0);
                    return tB - tA;
                });
                if (history.length > 0) {
                    callback(history.slice(0, 50));
                }
            }, (err) => {
                console.warn(`Firestore history fallback sync warning [${mode}]:`, err);
            });
        } catch (e) {
            console.warn(`Firestore history fallback setup error [${mode}]:`, e);
        }
    }, (err) => {
        console.warn(`Firestore history summary sync warning [${mode}]:`, err);
    });
}

export function subscribeToUserBalance(userId, callback) {
    const userDoc = doc(db, 'users', userId || 'default_user');
    return onSnapshot(userDoc, (snapshot) => {
        if (snapshot.exists()) {
            callback(snapshot.data());
        }
    }, (err) => {
        console.warn(`Firestore user sync warning [${userId}]:`, err);
    });
}

export function subscribeToAdminOverrides(callback) {
    const col = collection(db, 'game_overrides');
    return onSnapshot(col, (snapshot) => {
        const overrides = {};
        snapshot.forEach(doc => {
            overrides[doc.id] = doc.data().forcedOutcome;
        });
        callback(overrides);
    }, (err) => {
        console.warn('Firestore overrides sync warning:', err);
    });
}

export function subscribeToGameConfig(callback) {
    const configDoc = doc(db, 'game_config', 'system');
    return onSnapshot(configDoc, (snapshot) => {
        if (snapshot.exists()) {
            callback(snapshot.data());
        }
    }, (err) => {
        console.warn('Firestore config sync warning:', err);
    });
}

export {
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
    serverTimestamp
};
