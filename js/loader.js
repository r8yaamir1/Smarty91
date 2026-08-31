// js/loader.js - High Performance Circular Loader & Ultra-Smooth Page/Tab Transitions

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
                background: rgba(8, 10, 15, 0.75);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0.16s ease;
                visibility: hidden;
                will-change: opacity, visibility;
            }
            .smarty-transparent-loader-overlay.active {
                opacity: 1;
                pointer-events: auto;
                visibility: visible;
            }
            .smarty-spinner-container {
                position: relative;
                width: 50px;
                height: 50px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .smarty-minimal-circle-spinner {
                width: 44px;
                height: 44px;
                border: 3px solid rgba(255, 215, 0, 0.15);
                border-top: 3px solid #FFD700;
                border-right: 3px solid #FF2524;
                border-radius: 50%;
                animation: smartyCircleSpin 0.7s linear infinite;
                will-change: transform;
                transform: translateZ(0);
                filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.5));
            }
            .smarty-loader-subtext {
                margin-top: 12px;
                color: #FFFFFF;
                font-size: 12.5px;
                font-weight: 700;
                letter-spacing: 0.4px;
                text-shadow: 0 2px 6px rgba(0,0,0,0.85);
                font-family: 'Outfit', 'Plus Jakarta Sans', -apple-system, sans-serif;
                background: linear-gradient(135deg, #FFFFFF 0%, #FFD700 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                text-align: center;
            }
            @keyframes smartyCircleSpin {
                0% { transform: rotate(0deg) translateZ(0); }
                100% { transform: rotate(360deg) translateZ(0); }
            }

            /* Smooth View Transitions */
            @keyframes smartyTabFadeIn {
                0% {
                    opacity: 0;
                    transform: translateY(4px) translateZ(0);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) translateZ(0);
                }
            }

            @keyframes smartyPageFadeIn {
                0% {
                    opacity: 0;
                    transform: translateY(6px) scale(0.998) translateZ(0);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1) translateZ(0);
                }
            }

            .tab-smooth-enter {
                animation: smartyTabFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
                will-change: opacity, transform;
            }

            .page-smooth-enter {
                animation: smartyPageFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
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
                transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease;
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
    let autoSafetyTimer = null;

    function ensureElements() {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'smarty-transparent-loader';
            overlay.className = 'smarty-transparent-loader-overlay';
            overlay.innerHTML = `
                <div class="smarty-spinner-container">
                    <div class="smarty-minimal-circle-spinner"></div>
                </div>
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

    // High performance circular loader helper
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

            // Automatic Safety Timeout (5 seconds max to prevent any stuck state)
            if (autoSafetyTimer) clearTimeout(autoSafetyTimer);
            autoSafetyTimer = setTimeout(() => {
                if (overlay && overlay.classList.contains('active')) {
                    window.SmartyLoader.hide(true);
                }
            }, 5000);
        },

        hide: function(force = false) {
            if (!overlay) return;
            if (autoSafetyTimer) {
                clearTimeout(autoSafetyTimer);
                autoSafetyTimer = null;
            }
            if (force) activeCounter = 0;
            else activeCounter = Math.max(0, activeCounter - 1);

            if (activeCounter === 0) {
                hideTimer = setTimeout(() => {
                    if (overlay && activeCounter === 0) {
                        overlay.classList.remove('active');
                        if (labelEl) labelEl.innerText = '';
                    }
                }, 20);
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

        const now = Date.now();
        if (now - lastNavClickTime < 250) {
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

        // Show circular loader for smooth navigation feedback
        if (window.SmartyLoader) {
            window.SmartyLoader.show(msg || '');
        }

        window.location.href = url;
    };

    // Auto-reveal on load
    if (typeof document !== 'undefined') {
        window.revealPageReady();
    }
})();
