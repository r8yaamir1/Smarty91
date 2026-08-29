// main.js - Application Entrypoint

import { initAudio } from './audio.js';
import { initWalletModals } from './wallet.js';
import { initGameRecord } from './gameRecord.js';
import { initAllEvents } from './events.js';
import { initAdminPanel } from './adminPanel.js';

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

function bootstrap() {
    console.log('Initializing Smarty91 VIP...');
    initViewportLock();
    initAudio();
    initWalletModals();
    initAllEvents();
    initGameRecord();
    initAdminPanel();
    console.log('Smarty91 VIP ready!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
