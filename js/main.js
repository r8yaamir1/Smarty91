// main.js - Application Entrypoint

// Clean legacy localStorage keys to permanently eliminate fake/stale history on reload
try {
    localStorage.removeItem('smarty91_multi_game_state');
    localStorage.removeItem('smarty91_game_history');
    localStorage.removeItem('smarty91_seed_history');
    localStorage.removeItem('smarty91_user_bets');
} catch (e) {
    // Ignore in restricted environments
}

import { initAudio } from './audio.js';
import { initWalletModals, updateHeaderUserUI, renderBalance, syncServerBalance, setupBalanceListener } from './wallet.js';
import { initGameRecord } from './gameRecord.js';
import { initAllEvents } from './events.js';
import { initAdminPanel } from './adminPanel.js';
import { initHomeNavigation } from './homeNavigation.js';

function initViewportLock() {
    // Prevent double-tap zoom
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, { passive: false });

    // Prevent pinch-zoom gestures
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('gesturechange', (e) => e.preventDefault());
    document.addEventListener('gestureend', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
}

async function bootstrap() {
    console.log('Initializing Smarty91 VIP...');
    initViewportLock();
    initAudio();
    updateHeaderUserUI();
    
    // Ensure real-time Firestore subscription starts with current user credentials
    setupBalanceListener();

    // Block initial UI rendering if token exists to fetch 100% accurate, up-to-date balance from the server/database
    const token = localStorage.getItem('smarty91_auth_token');
    if (token) {
        try {
            await syncServerBalance(false);
        } catch (e) {
            console.warn('Initial balance sync on startup failed:', e);
        }
    }

    renderBalance();
    initWalletModals();
    initAllEvents();
    initGameRecord();
    initAdminPanel();
    initHomeNavigation();
    console.log('Smarty91 VIP ready!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
