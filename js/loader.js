// js/loader.js - Minimal Transparent Circular Loader & Network Reconnection Listener

(function() {
    // Inject clean transparent spinner styles
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
                background: rgba(0, 0, 0, 0.35);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
            }
            .smarty-transparent-loader-overlay.active {
                opacity: 1;
                pointer-events: auto;
            }
            .smarty-minimal-circle-spinner {
                width: 46px;
                height: 46px;
                border: 3.5px solid rgba(245, 158, 11, 0.2);
                border-top: 3.5px solid #f59e0b;
                border-right: 3.5px solid #fbbf24;
                border-radius: 50%;
                animation: smartyCircleSpin 0.75s linear infinite;
                filter: drop-shadow(0 0 10px rgba(245, 158, 11, 0.4));
            }
            .smarty-loader-subtext {
                margin-top: 12px;
                color: #ffffff;
                font-size: 13px;
                font-weight: 600;
                letter-spacing: 0.5px;
                text-shadow: 0 2px 4px rgba(0,0,0,0.8);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            @keyframes smartyCircleSpin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            /* Offline / Slow Network Status Banner */
            .smarty-offline-banner {
                position: fixed;
                top: 12px;
                left: 50%;
                transform: translateX(-50%) translateY(-60px);
                background: rgba(220, 38, 38, 0.92);
                backdrop-filter: blur(6px);
                color: #ffffff;
                padding: 8px 18px;
                border-radius: 24px;
                font-size: 12px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 8px 20px rgba(0,0,0,0.4);
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
            offlineBanner.style.background = 'rgba(22, 163, 74, 0.92)';
            setTimeout(() => {
                offlineBanner.classList.remove('visible');
                offlineBanner.style.background = 'rgba(220, 38, 38, 0.92)';
            }, 1800);
        }
    });

    window.SmartyLoader = {
        // Show ONLY on explicit manual actions
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
                }, 80);
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
})();
