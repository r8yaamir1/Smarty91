// js/loader.js - Minimal Transparent Circular Loader & Ultra-Smooth Page Transitions

(function() {
    // Inject clean transparent spinner and ultra-smooth transition styles
    if (!document.getElementById('smarty-loader-styles')) {
        const style = document.createElement('style');
        style.id = 'smarty-loader-styles';
        style.innerHTML = `
            .smarty-transparent-loader-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(10, 12, 18, 0.65);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.22s ease;
                visibility: hidden;
            }
            .smarty-transparent-loader-overlay.active {
                opacity: 1;
                pointer-events: auto;
                visibility: visible;
            }
            .smarty-minimal-circle-spinner {
                width: 48px;
                height: 48px;
                border: 3.5px solid rgba(255, 215, 0, 0.15);
                border-top: 3.5px solid #FFD700;
                border-right: 3.5px solid #FF2E4D;
                border-radius: 50%;
                animation: smartyCircleSpin 0.7s linear infinite;
                filter: drop-shadow(0 0 12px rgba(255, 215, 0, 0.5));
            }
            .smarty-loader-subtext {
                margin-top: 14px;
                color: #FFFFFF;
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 0.5px;
                text-shadow: 0 2px 6px rgba(0,0,0,0.8);
                font-family: 'Outfit', 'Plus Jakarta Sans', -apple-system, sans-serif;
                background: linear-gradient(135deg, #FFFFFF 0%, #FFD700 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            @keyframes smartyCircleSpin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            /* Smooth View Transitions */
            @keyframes smartyTabFadeIn {
                0% {
                    opacity: 0;
                    transform: translateY(6px);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @keyframes smartyPageFadeIn {
                0% {
                    opacity: 0;
                    transform: translateY(8px) scale(0.995);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            .tab-smooth-enter {
                animation: smartyTabFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
                will-change: opacity, transform;
            }

            .page-smooth-enter {
                animation: smartyPageFadeIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
                will-change: opacity, transform;
            }

            /* Offline / Slow Network Status Banner */
            .smarty-offline-banner {
                position: fixed;
                top: 12px;
                left: 50%;
                transform: translateX(-50%) translateY(-60px);
                background: rgba(220, 38, 38, 0.94);
                backdrop-filter: blur(8px);
                color: #ffffff;
                padding: 8px 18px;
                border-radius: 24px;
                font-size: 12px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                z-index: 100000;
                transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
                opacity: 0;
                pointer-events: none;
            }
            .smarty-offline-banner.visible {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
                pointer-events: auto;
            }
            .smarty-offline-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #fef08a;
                animation: smartyPulse 1s infinite;
            }
            @keyframes smartyPulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.4; transform: scale(0.8); }
            }
        `;
        document.head.appendChild(style);
    }

    let overlay = null;
    let labelEl = null;
    let offlineBanner = null;
    let activeCounter = 0;
    let hideTimer = null;

    function ensureElements() {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'smarty-transparent-loader';
            overlay.className = 'smarty-transparent-loader-overlay';
            overlay.innerHTML = `
                <div class="smarty-minimal-circle-spinner"></div>
                <div class="smarty-loader-subtext" id="smarty-loader-subtext"></div>
            `;
            document.body.appendChild(overlay);
            labelEl = document.getElementById('smarty-loader-subtext');
        }

        if (!offlineBanner) {
            offlineBanner = document.createElement('div');
            offlineBanner.id = 'smarty-offline-banner';
            offlineBanner.className = 'smarty-offline-banner';
            offlineBanner.innerHTML = `
                <div class="smarty-offline-dot"></div>
                <span id="smarty-offline-text">Reconnecting network...</span>
            `;
            document.body.appendChild(offlineBanner);
        }
    }

    // Network connection monitors
    window.addEventListener('offline', () => {
        ensureElements();
        const text = document.getElementById('smarty-offline-text');
        if (text) text.innerText = 'Network disconnected. Reconnecting...';
        offlineBanner.classList.add('visible');
    });

    window.addEventListener('online', () => {
        if (offlineBanner) {
            const text = document.getElementById('smarty-offline-text');
            if (text) text.innerText = 'Network restored!';
            offlineBanner.style.background = 'rgba(22, 163, 74, 0.94)';
            setTimeout(() => {
                offlineBanner.classList.remove('visible');
                offlineBanner.style.background = 'rgba(220, 38, 38, 0.94)';
            }, 1800);
        }
    });

    window.SmartyLoader = {
        show: function(msg = '') {
            if (typeof document === 'undefined') return;
            ensureElements();
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
            activeCounter++;
            if (labelEl) {
                labelEl.innerText = msg || '';
                labelEl.style.display = msg ? 'block' : 'none';
            }
            overlay.classList.add('active');
        },

        hide: function(force = false) {
            if (!overlay) return;
            if (force) activeCounter = 0;
            else activeCounter = Math.max(0, activeCounter - 1);

            if (activeCounter === 0) {
                hideTimer = setTimeout(() => {
                    if (overlay && activeCounter === 0) {
                        overlay.classList.remove('active');
                        if (labelEl) labelEl.innerText = '';
                    }
                }, 60);
            }
        },

        with: async function(promiseOrFn, msg = '') {
            this.show(msg);
            try {
                if (typeof promiseOrFn === 'function') {
                    return await promiseOrFn();
                }
                return await promiseOrFn;
            } finally {
                this.hide();
            }
        }
    };

    // Helper to animate an element smoothly when switching tabs
    window.applyTabAnimation = function(targetEl) {
        if (!targetEl) return;
        targetEl.classList.remove('tab-smooth-enter');
        // Trigger reflow to restart CSS animation
        void targetEl.offsetWidth;
        targetEl.classList.add('tab-smooth-enter');
    };

    // Helper to trigger page entrance fade after data render
    window.revealPageReady = function(targetContainerSelector = '.profile-container, .cashier-page-container, .referral-container, .checkin-container, #app, .app-shell, .home-tab-container') {
        const applyFade = () => {
            const elements = document.querySelectorAll(targetContainerSelector);
            elements.forEach(el => {
                el.classList.add('page-smooth-enter');
            });
            if (window.SmartyLoader) {
                window.SmartyLoader.hide(true);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', applyFade, { once: true });
        } else {
            setTimeout(applyFade, 10);
        }
    };

    let lastNavClickTime = 0;

    window.navigateToPage = function(url, msg) {
        if (!url) return;

        // Navigation Switch Throttle (1.2s gap between tab switches to avoid glitches)
        const now = Date.now();
        if (now - lastNavClickTime < 1200) {
            return;
        }

        const currentPath = window.location.pathname;
        const isCurrentHome = (url === 'index.html' || url === '/') && (currentPath === '/' || currentPath.endsWith('index.html'));
        const isSamePage = currentPath.endsWith(url) || isCurrentHome;

        if (isSamePage) {
            if (url === 'index.html' || url === '/') {
                if (typeof window.switchAppView === 'function') {
                    window.switchAppView('home');
                }
            }
            return;
        }

        lastNavClickTime = now;

        // Show single clean VIP loader with appropriate subtitle
        if (window.SmartyLoader) {
            let label = msg || 'Loading VIP Arena...';
            if (url.includes('checkin')) label = 'Loading Daily Sign In...';
            else if (url.includes('referral')) label = 'Loading VIP Agent Hub...';
            else if (url.includes('payment')) label = 'Loading Cashier & Wallet...';
            else if (url.includes('profile')) label = 'Loading VIP Profile...';
            else if (url.includes('index') || url === '/') label = 'Loading Smarty91...';

            window.SmartyLoader.show(label);
        }

        // Smooth immediate navigation
        setTimeout(() => {
            window.location.href = url;
        }, 120);
    };

    // Auto-reveal on load
    if (typeof document !== 'undefined') {
        window.revealPageReady();
    }
})();
