// audio.js - High Precision Single-Channel Audio System

let isMuted = false;
let audioCtx = null;
const audioBuffers = {
    di1: null,
    di2: null
};
let activeSources = [];
let lastPlayedSecond = null;
let lastPlayedTimestamp = 0;

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}

// Preload sound files into memory for instant, glitch-free, single-shot playback
async function loadAudioBuffers() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const files = [
            { key: 'di1', url: './assets/mp3/di1-0f3d86cb.mp3' },
            { key: 'di2', url: './assets/mp3/di2-ad9aa8fb.mp3' }
        ];

        for (const file of files) {
            if (!audioBuffers[file.key]) {
                const response = await fetch(file.url);
                const arrayBuffer = await response.arrayBuffer();
                audioBuffers[file.key] = await ctx.decodeAudioData(arrayBuffer);
            }
        }
    } catch (e) {
        // Fallback to HTML5 audio if fetch fails
    }
}

// Play preloaded AudioBuffer cleanly
function playBuffer(bufferKey) {
    if (isMuted) return false;
    const ctx = getAudioContext();
    if (!ctx || ctx.state === 'suspended') return false;

    const buffer = audioBuffers[bufferKey];
    if (!buffer) return false;

    try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0.85, ctx.currentTime);
        source.connect(gainNode);
        gainNode.connect(ctx.destination);

        source.onended = () => {
            activeSources = activeSources.filter(s => s !== source);
        };

        activeSources.push(source);
        source.start(0);
        return true;
    } catch (e) {
        return false;
    }
}

// Fallback synthetic beeps for strict autoplay restrictions
export function playSynthBeep(freq = 880, duration = 0.08, type = 'sine') {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx || ctx.state === 'suspended') return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        // Ignore
    }
}

export function stopCountdownAudio() {
    // 1. Stop all active Web Audio sources
    activeSources.forEach(source => {
        try {
            source.stop();
        } catch (e) {}
    });
    activeSources = [];

    // 2. Stop HTML5 audio elements
    try {
        const voice1 = document.getElementById('voice1');
        if (voice1) {
            voice1.pause();
            voice1.currentTime = 0;
        }
        const voice2 = document.getElementById('voice2');
        if (voice2) {
            voice2.pause();
            voice2.currentTime = 0;
        }
    } catch (e) {
        // Safe ignore
    }
    lastPlayedSecond = null;
}

// Helper to check if game screen is currently active and visible to user
export function isGameViewActive() {
    const wingoView = document.getElementById('wingo-game-view');
    const homeView = document.getElementById('home-dashboard-view');
    if (!wingoView) return false;

    // If home view is visible, game view is NOT active
    if (homeView && homeView.style.display !== 'none' && homeView.offsetParent !== null) {
        return false;
    }

    // Check if wingo view is currently displayed
    const isWingoVisible = wingoView.style.display !== 'none' && wingoView.offsetParent !== null;
    return isWingoVisible;
}

export function playTickSound(secondsLeft) {
    if (isMuted) return;

    // Audio MUST only play when user has actually opened and is inside the active game view
    if (!isGameViewActive()) {
        stopCountdownAudio();
        return;
    }

    const now = Date.now();
    // Guard against multiple rapid calls in the same second
    if (lastPlayedSecond === secondsLeft && (now - lastPlayedTimestamp) < 600) {
        return;
    }
    lastPlayedSecond = secondsLeft;
    lastPlayedTimestamp = now;

    // Stop any previously playing audio before starting a new tick
    stopCountdownAudio();

    if (secondsLeft > 1) {
        // Try Web Audio buffer first
        const played = playBuffer('di1');
        if (!played) {
            const voice1 = document.getElementById('voice1');
            if (voice1) {
                voice1.currentTime = 0;
                voice1.play().catch(() => {});
            }
        }
    } else if (secondsLeft === 1) {
        // Try Web Audio buffer first
        const played = playBuffer('di2');
        if (!played) {
            const voice2 = document.getElementById('voice2');
            if (voice2) {
                voice2.currentTime = 0;
                voice2.play().catch(() => {});
            }
        }
    }
}

export function playSpinTick(step = 0) {
    if (isMuted || !isGameViewActive()) return;
    const baseFreq = 700 + ((step % 10) * 60);
    playSynthBeep(baseFreq, 0.04, 'triangle');
}

export function playWinChime() {
    if (isMuted || !isGameViewActive()) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            setTimeout(() => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, ctx.currentTime);
                gain.gain.setValueAtTime(0.25, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.35);
            }, idx * 90);
        });
    } catch (e) {
        console.warn('Win chime failed:', e);
    }
}

export function playClickSound() {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.025);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.025);
    } catch (e) {
        // Safe ignore
    }
}

// Crisp pitch-modulated click for stepper (+ / -)
export function playStepperSound(delta = 1) {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const baseFreq = delta > 0 ? 1400 : 900;
        const endFreq = delta > 0 ? 900 : 450;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.035);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
    } catch (e) {}
}

// Smooth casino-grade chip select sound
export function playChipSelectSound() {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;

        // Primary tap
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(1600, now);
        osc1.frequency.exponentialRampToValueAtTime(800, now + 0.03);
        gain1.gain.setValueAtTime(0.18, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.03);

        // Secondary subtle bounce
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1100, now + 0.02);
        osc2.frequency.exponentialRampToValueAtTime(600, now + 0.05);
        gain2.gain.setValueAtTime(0.12, now + 0.02);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.02);
        osc2.stop(now + 0.05);
    } catch (e) {}
}

// Ascending opening swoop for betting popup
export function playBetPopupOpenSound() {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        const notes = [587.33, 880.00]; // D5, A5
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + (idx * 0.04));
            gain.gain.setValueAtTime(0.16, now + (idx * 0.04));
            gain.gain.exponentialRampToValueAtTime(0.001, now + (idx * 0.04) + 0.12);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + (idx * 0.04));
            osc.stop(now + (idx * 0.04) + 0.12);
        });
    } catch (e) {}
}

// Affirmative bet placed sound
export function playBetPlacedSound() {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        const notes = [659.25, 987.77, 1318.51]; // E5, B5, E6
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + (idx * 0.05));
            gain.gain.setValueAtTime(0.2, now + (idx * 0.05));
            gain.gain.exponentialRampToValueAtTime(0.001, now + (idx * 0.05) + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + (idx * 0.05));
            osc.stop(now + (idx * 0.05) + 0.2);
        });
    } catch (e) {}
}

// Soft modal cancel / close sound
export function playModalCloseSound() {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(250, now + 0.05);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
    } catch (e) {}
}

// Triumphant celebratory fanfare for Congratulations / Daily bonus claim
export function playCongratulationSound() {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        // Celebratory chord progression: C5 -> E5 -> G5 -> C6 -> E6
        const fanfare = [
            { f: 523.25, d: 0.12, t: 0.00 },
            { f: 659.25, d: 0.12, t: 0.08 },
            { f: 783.99, d: 0.14, t: 0.16 },
            { f: 1046.50, d: 0.35, t: 0.24 },
            { f: 1318.51, d: 0.45, t: 0.32 }
        ];

        fanfare.forEach(item => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(item.f, now + item.t);
            gain.gain.setValueAtTime(0.24, now + item.t);
            gain.gain.exponentialRampToValueAtTime(0.001, now + item.t + item.d);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + item.t);
            osc.stop(now + item.t + item.d);
        });
    } catch (e) {}
}

// Expose globally to window
if (typeof window !== 'undefined') {
    window.playClickSound = playClickSound;
    window.playStepperSound = playStepperSound;
    window.playChipSelectSound = playChipSelectSound;
    window.playBetPopupOpenSound = playBetPopupOpenSound;
    window.playBetPlacedSound = playBetPlacedSound;
    window.playModalCloseSound = playModalCloseSound;
    window.playCongratulationSound = playCongratulationSound;
    window.playWinChime = playWinChime;
}

export function updateVoiceUI() {
    const voiceIcons = document.querySelectorAll('.WinGo__C-head-more > div:last-child, .voice-btn, .disableVoice');
    voiceIcons.forEach(icon => {
        if (isMuted) {
            icon.classList.remove('active');
            icon.classList.add('disableVoice');
        } else {
            icon.classList.add('active');
            icon.classList.remove('disableVoice');
        }
    });
}

export function toggleAudio(forcedState) {
    if (typeof forcedState === 'boolean') {
        isMuted = !forcedState;
    } else {
        isMuted = !isMuted;
    }
    updateVoiceUI();
    localStorage.setItem('smarty91_muted', isMuted ? 'true' : 'false');
    if (!isMuted) {
        playSynthBeep(1000, 0.06, 'sine');
    }
    return !isMuted;
}

export function isAudioMuted() {
    return isMuted;
}

export function initAudio() {
    const saved = localStorage.getItem('smarty91_muted');
    if (saved === 'true') {
        isMuted = true;
    } else {
        isMuted = false;
    }
    updateVoiceUI();
    loadAudioBuffers();

    const voiceIcons = document.querySelectorAll('.WinGo__C-head-more > div:last-child, .voice-btn, .disableVoice');
    voiceIcons.forEach(icon => {
        icon.style.cursor = 'pointer';
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            getAudioContext();
            loadAudioBuffers();
            toggleAudio();
        });
    });

    // Resume AudioContext on first user interaction
    const unlockAudio = () => {
        getAudioContext();
        loadAudioBuffers();
        window.removeEventListener('click', unlockAudio);
        window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });

    // Global listener for interactive buttons and nav items
    document.addEventListener('click', (e) => {
        const interactiveBtn = e.target.closest('button, .bottom-nav-item, .quick-action-card, .tab-item, .nav-btn, .action-btn');
        if (interactiveBtn && !e.defaultPrevented) {
            // Avoid double playing if already handled by custom popup/stepper sounds
            if (!interactiveBtn.closest('.Betting__Popup') && !interactiveBtn.closest('.Betting__C-numC') && !interactiveBtn.closest('.Betting__C-foot')) {
                playClickSound();
            }
        }
    }, { capture: true, passive: true });
}
