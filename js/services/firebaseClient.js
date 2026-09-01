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

function parseRecordTime(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
}

function sortHistoryItems(items) {
    return [...items].sort((a, b) => {
        const tA = parseRecordTime(a.timestamp || a.settledAt);
        const tB = parseRecordTime(b.timestamp || b.settledAt);
        if (tA !== tB && tA > 0 && tB > 0) return tB - tA;
        const pA = String(a.period || a.periodId || '');
        const pB = String(b.period || b.periodId || '');
        return pB.localeCompare(pA);
    });
}

export function subscribeToGameHistory(mode, callback) {
    const summaryDoc = doc(db, 'game_history_summary', mode);
    return onSnapshot(summaryDoc, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            if (data && Array.isArray(data.rounds)) {
                callback(sortHistoryItems(data.rounds));
            }
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

export function subscribeToUserTransactions(userId, callback) {
    if (!userId) return null;
    const col = collection(db, 'transactions');
    const q = query(col, where('userId', '==', userId));
    return onSnapshot(q, (snapshot) => {
        const items = [];
        snapshot.forEach(docSnap => {
            items.push(docSnap.data());
        });
        items.sort((a, b) => {
            const timeA = new Date(a.createdAt || a.timestamp || 0).getTime();
            const timeB = new Date(b.createdAt || b.timestamp || 0).getTime();
            return timeB - timeA;
        });
        callback(items);
    }, (err) => {
        console.warn(`Firestore user transactions sync warning [${userId}]:`, err);
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
