// audio.js - Audio system with HTML5 audio and Web Audio API fallback

let isMuted = false;
let audioCtx = null;

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

// Fallback synthetic beeps for strict autoplay restrictions
export function playSynthBeep(freq = 880, duration = 0.08, type = 'sine') {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.warn('Synth beep failed:', e);
    }
}

export function playTickSound(secondsLeft) {
    if (isMuted) return;

    if (secondsLeft > 1) {
        const voice1 = document.getElementById('voice1');
        if (voice1) {
            voice1.currentTime = 0;
            voice1.play().catch(() => {
                playSynthBeep(700, 0.09, 'sine');
            });
        } else {
            playSynthBeep(700, 0.09, 'sine');
        }
    } else if (secondsLeft === 1) {
        const voice2 = document.getElementById('voice2');
        if (voice2) {
            voice2.currentTime = 0;
            voice2.play().catch(() => {
                playSynthBeep(1200, 0.25, 'triangle');
            });
        } else {
            playSynthBeep(1200, 0.25, 'triangle');
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

    const voiceIcons = document.querySelectorAll('.WinGo__C-head-more > div:last-child, .voice-btn, .disableVoice');
    voiceIcons.forEach(icon => {
        icon.style.cursor = 'pointer';
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            getAudioContext();
            toggleAudio();
        });
    });

    // Resume AudioContext on first user interaction
    const unlockAudio = () => {
        getAudioContext();
        window.removeEventListener('click', unlockAudio);
        window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
}
