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
    const historyCol = collection(db, 'game_history');
    const q = query(
        historyCol,
        where('mode', '==', mode),
        orderBy('timestamp', 'desc'),
        limit(50)
    );
    return onSnapshot(q, (snapshot) => {
        const history = [];
        snapshot.forEach(doc => history.push(doc.data()));
        callback(history);
    }, (err) => {
        console.warn(`Firestore history sync warning [${mode}]:`, err);
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
