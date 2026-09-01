// js/congratulationsModal.js - Celebratory pop-up modal for Daily Sign-In bonuses and achievements
import { playCongratulationSound, playClickSound } from './audio.js';

export function showCongratulationsModal({
    amount = 0,
    streakDay = 1,
    newBalance = null,
    title = 'CONGRATULATIONS!',
    subtitle = 'Daily VIP Sign-In Bonus Credited',
    onClose = null
}) {
    // Play celebratory triumphant fanfare
    try {
        if (typeof playCongratulationSound === 'function') {
            playCongratulationSound();
        } else if (typeof window.playCongratulationSound === 'function') {
            window.playCongratulationSound();
        }
    } catch (e) {}

    // Remove any existing congrats modal
    const existing = document.getElementById('smarty-congrats-modal');
    if (existing) existing.remove();

    const nextRewardDay = (streakDay % 7) + 1;
    const rewardsMap = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30, 7: 50 };
    const nextRewardAmount = rewardsMap[nextRewardDay] || 5;

    const modal = document.createElement('div');
    modal.id = 'smarty-congrats-modal';
    modal.className = 'congrats-modal-overlay';
    modal.innerHTML = `
        <div class="congrats-card">
            <div class="congrats-glow-rays"></div>
            <div class="congrats-icon-box">🎁</div>
            <div class="congrats-title">${title}</div>
            <div class="congrats-subtitle">${subtitle}</div>

            <div class="congrats-reward-badge">
                <div class="congrats-reward-label">Reward Amount Credited</div>
                <div class="congrats-reward-amount">₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>

            <div class="congrats-streak-box">
                <div class="congrats-streak-info">
                    <span>🔥</span>
                    <span>Day ${streakDay} of 7 Streak Active!</span>
                </div>
                <div class="congrats-streak-badge">Next: ₹${nextRewardAmount} Tomorrow</div>
            </div>

            ${newBalance !== null && newBalance !== undefined ? `
                <div style="font-size: 13px; color: #94A3B8; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); padding: 8px 14px; border-radius: 10px;">
                    <span>Updated Wallet Balance:</span>
                    <span style="color: #FFD700; font-weight: 800; font-family: 'JetBrains Mono', monospace;">₹${Number(newBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            ` : ''}

            <button id="btn-congrats-collect" class="congrats-btn">
                <span>COLLECT & CONTINUE</span>
                <span>✨</span>
            </button>
        </div>
    `;

    document.body.appendChild(modal);

    // Trigger smooth entrance animation
    requestAnimationFrame(() => {
        modal.classList.add('active');
    });

    const closeHandler = () => {
        try {
            if (typeof playClickSound === 'function') {
                playClickSound();
            } else if (typeof window.playClickSound === 'function') {
                window.playClickSound();
            }
        } catch (e) {}
        modal.classList.remove('active');
        setTimeout(() => {
            modal.remove();
            if (typeof onClose === 'function') onClose();
        }, 300);
    };

    const btn = modal.querySelector('#btn-congrats-collect');
    if (btn) btn.addEventListener('click', closeHandler);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeHandler();
    });
}

// Expose globally to window
if (typeof window !== 'undefined') {
    window.showCongratulationsModal = showCongratulationsModal;
}
