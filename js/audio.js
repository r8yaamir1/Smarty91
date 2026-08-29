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

export function playTickSound(secondsLeft) {
    if (isMuted) return;

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
    if (isMuted) return;
    const baseFreq = 700 + ((step % 10) * 60);
    playSynthBeep(baseFreq, 0.04, 'triangle');
}

export function playWinChime() {
    if (isMuted) return;
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
    playSynthBeep(900, 0.04, 'sine');
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
}
