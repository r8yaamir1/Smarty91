// js/homeNavigation.js - Smarty91 VIP Home Dashboard & Bottom Nav Controller
import { syncServerBalance, showToast, formatCurrency } from './wallet.js';
import { stopCountdownAudio } from './audio.js';
import { showCongratulationsModal } from './congratulationsModal.js';

let checkInState = {
    hasDeposited: false,
    claimedToday: false,
    streakDay: 1,
    rewardsTable: [],
    totalClaimedAmount: 0
};

let referralState = {
    inviteCode: '',
    totalInvites: 0,
    activeDepositors: 0,
    totalCommissionEarned: 0,
    referrals: []
};

// Switch between Home Dashboard and Live Colour Prediction
export function showDepositRequiredModal() {
    let modal = document.getElementById('deposit-required-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'deposit-required-modal';
        modal.className = 'van-overlay';
        modal.style.cssText = 'display: flex; position: fixed; inset: 0; background: rgba(10, 14, 23, 0.82); z-index: 99999; align-items: center; justify-content: center; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); padding: 16px; opacity: 0; transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);';
        modal.innerHTML = `
            <div id="deposit-required-modal-box" style="background: #171c28; border: 1px solid rgba(243, 186, 47, 0.35); border-radius: 4px; padding: 24px 20px 20px 20px; width: 100%; max-width: 340px; text-align: center; box-shadow: 0 16px 40px rgba(0,0,0,0.85), 0 0 20px rgba(243, 186, 47, 0.12); transform: scale(0.92); transition: transform 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275); position: relative;">
                <button id="deposit-modal-close-x" style="position: absolute; top: 10px; right: 12px; background: transparent; border: none; color: #718096; font-size: 18px; cursor: pointer; line-height: 1; padding: 4px; display: flex; align-items: center; justify-content: center;">&times;</button>
                <div style="width: 52px; height: 52px; margin: 0 auto 16px; background: rgba(243, 186, 47, 0.1); border-radius: 4px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(243, 186, 47, 0.3);">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#f3ba2f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                </div>
                <h3 style="color: #f3ba2f; font-size: 17px; font-weight: 800; margin: 0 0 8px 0; letter-spacing: 0.3px;">First Deposit Required</h3>
                <p style="color: #94a3b8; font-size: 13px; line-height: 1.55; margin: 0 0 22px 0;">
                    Please complete your first deposit to unlock all live games and start playing.
                </p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="deposit-modal-cancel-btn" style="flex: 1; background: rgba(255, 255, 255, 0.05); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.12); padding: 11px; border-radius: 4px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.15s ease;">Cancel</button>
                    <a href="payment.html?tab=deposit" style="flex: 1.3; background: linear-gradient(135deg, #f3ba2f 0%, #e1a116 100%); color: #0d1117; text-decoration: none; padding: 11px; border-radius: 4px; font-weight: 800; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 4px 14px rgba(243, 186, 47, 0.25); border: none; transition: all 0.15s ease;">
                        <span>Deposit Now</span>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    </a>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeModalFunc = () => {
            modal.style.opacity = '0';
            const box = document.getElementById('deposit-required-modal-box');
            if (box) box.style.transform = 'scale(0.92)';
            setTimeout(() => {
                modal.style.display = 'none';
            }, 200);
        };

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModalFunc();
        });

        const cancelBtn = document.getElementById('deposit-modal-cancel-btn');
        if (cancelBtn) cancelBtn.onclick = closeModalFunc;

        const closeX = document.getElementById('deposit-modal-close-x');
        if (closeX) closeX.onclick = closeModalFunc;
    }

    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        const box = document.getElementById('deposit-required-modal-box');
        if (box) box.style.transform = 'scale(1)';
    });
}
window.showDepositRequiredModal = showDepositRequiredModal;

export async function verifyDepositStatus() {
    const token = localStorage.getItem('smarty91_auth_token');
    if (!token) {
        window.location.href = 'login.html';
        return false;
    }
    try {
        const resp = await fetch('/api/user/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data && data.success && data.user) {
                const hasDep = Boolean(data.user.hasDeposited || (data.user.depositCount && data.user.depositCount > 0));
                if (hasDep) {
                    localStorage.setItem('smarty91_has_deposited', 'true');
                    return true;
                } else {
                    localStorage.setItem('smarty91_has_deposited', 'false');
                    return false;
                }
            }
        }
    } catch (e) {
        console.warn('Failed to verify deposit status:', e);
    }
    return localStorage.getItem('smarty91_has_deposited') === 'true';
}

export function switchView(viewName) {
    const homeView = document.getElementById('home-dashboard-view');
    const wingoView = document.getElementById('wingo-game-view');
    const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
    const floatingToast = document.getElementById('home-floating-toast');
    const bottomNav = document.querySelector('.app-bottom-nav');

    if (viewName === 'game') {
        if (floatingToast) floatingToast.classList.remove('show');
        if (homeView) homeView.style.display = 'none';
        if (wingoView) {
            wingoView.style.display = 'block';
            if (window.applyTabAnimation) window.applyTabAnimation(wingoView);
        }
        if (bottomNav) {
            bottomNav.classList.add('nav-hidden');
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
        // Leaving game view: Immediately kill all audio
        stopCountdownAudio();
        if (homeView) {
            homeView.style.display = 'flex';
            if (window.applyTabAnimation) window.applyTabAnimation(homeView);
        }
        if (wingoView) wingoView.style.display = 'none';
        if (bottomNav) {
            bottomNav.classList.remove('nav-hidden');
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    bottomNavItems.forEach(item => {
        const tab = item.getAttribute('data-tab');
        if (tab === 'home' && viewName !== 'game') {
            item.classList.add('active');
        } else if (tab === 'home' && viewName === 'game') {
            item.classList.remove('active');
        }
    });
}

// VIP Game Opening with Sync Loader
export async function openGameWithLoader(targetView = 'game') {
    const isDeposited = await verifyDepositStatus();
    if (!isDeposited) {
        showDepositRequiredModal();
        return; // Stop execution: Game will not open without at least 1 deposit!
    }

    const overlay = document.getElementById('game-sync-overlay');
    const meterBar = document.getElementById('game-sync-meter-bar');
    const statusText = document.getElementById('game-sync-status-text');

    // Immediate switch without waiting
    switchView(targetView);

    // Background sync of wallet balance
    try {
        syncServerBalance(false).catch(() => {});
    } catch (e) {}

    if (!overlay) return;

    overlay.style.display = 'flex';
    if (meterBar) meterBar.style.width = '35%';
    if (statusText) statusText.textContent = 'Connecting to VIP Arena...';
    overlay.classList.add('active');

    // Quick subtle transition
    setTimeout(() => {
        if (meterBar) meterBar.style.width = '100%';
        if (statusText) statusText.textContent = 'Entering Live Game...';
    }, 120);

    setTimeout(() => {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
        if (meterBar) meterBar.style.width = '0%';
    }, 280);
}

// Fetch Daily Sign-in status
export async function loadCheckInStatus() {
    try {
        const token = localStorage.getItem('smarty91_auth_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const resp = await fetch('/api/user/checkin/status', { headers });
        if (resp.ok) {
            const data = await resp.json();
            if (data && data.success) {
                checkInState = data;
                renderCheckInModal();
            }
        }
    } catch (err) {
        console.warn('Failed to fetch check-in status:', err);
    }
}

// Claim Daily Sign-in bonus
export async function claimCheckInBonus() {
    const claimBtn = document.getElementById('modal-claim-btn');
    if (claimBtn) {
        claimBtn.disabled = true;
        claimBtn.innerHTML = `<span>Claiming...</span>`;
    }

    try {
        const token = localStorage.getItem('smarty91_auth_token');
        if (!token) {
            showToast('Please log in first to claim daily bonuses!', 'warn');
            setTimeout(() => { window.location.href = 'login.html'; }, 1000);
            return;
        }

        const resp = await fetch('/api/user/checkin/claim', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await resp.json();
        if (data && data.success) {
            await syncServerBalance(true);
            await loadCheckInStatus();
            showCongratulationsModal({
                amount: data.amount,
                streakDay: data.streakDay,
                newBalance: data.newBalance
            });
        } else {
            if (data && data.code === 'DEPOSIT_REQUIRED') {
                showToast('Recharge required! Daily bonus unlocks after your first deposit.', 'warn');
            } else {
                showToast(data.message || 'Unable to claim bonus', 'warn');
            }
            if (claimBtn) {
                claimBtn.disabled = false;
                claimBtn.innerHTML = `<span>Claim Today's Bonus</span>`;
            }
        }
    } catch (err) {
        showToast('Network error while claiming bonus', 'warn');
        if (claimBtn) {
            claimBtn.disabled = false;
            claimBtn.innerHTML = `<span>Claim Today's Bonus</span>`;
        }
    }
}

// Render Daily Sign-in Modal UI
export function renderCheckInModal() {
    const grid = document.getElementById('rewards-7day-grid');
    const lockBox = document.getElementById('checkin-deposit-lock');
    const claimBtn = document.getElementById('modal-claim-btn');
    const streakLabel = document.getElementById('modal-streak-count');

    if (streakLabel) {
        streakLabel.textContent = `Day ${checkInState.streakDay || 1} of 7 Streak`;
    }

    if (lockBox) {
        if (!checkInState.hasDeposited) {
            lockBox.style.display = 'flex';
        } else {
            lockBox.style.display = 'none';
        }
    }

    if (grid) {
        const rewards = checkInState.rewardsTable && checkInState.rewardsTable.length > 0 
            ? checkInState.rewardsTable 
            : [
                { day: 1, amount: 5, label: 'Day 1' },
                { day: 2, amount: 10, label: 'Day 2' },
                { day: 3, amount: 15, label: 'Day 3' },
                { day: 4, amount: 20, label: 'Day 4' },
                { day: 5, amount: 25, label: 'Day 5' },
                { day: 6, amount: 30, label: 'Day 6' },
                { day: 7, amount: 50, label: 'Day 7 (Mega)' }
            ];

        grid.innerHTML = rewards.map((r) => {
            const isMega = r.day === 7;
            const isToday = r.day === checkInState.streakDay;
            const isPast = r.day < checkInState.streakDay || (isToday && checkInState.claimedToday);
            let cardClasses = `day-reward-card ${isMega ? 'day-7-mega' : ''}`;
            if (isToday && !checkInState.claimedToday) cardClasses += ' active-today';
            if (isPast) cardClasses += ' claimed';

            return `
                <div class="${cardClasses}">
                    ${isPast ? `<span class="day-claimed-badge">✓</span>` : ''}
                    <div class="day-card-label">Day ${r.day}</div>
                    <div class="day-card-icon">${isMega ? '👑' : '🎁'}</div>
                    <div class="day-card-val">₹${r.amount}</div>
                </div>
            `;
        }).join('');
    }

    if (claimBtn) {
        if (!checkInState.hasDeposited) {
            claimBtn.disabled = false;
            claimBtn.innerHTML = `<span>⚡ Recharge to Unlock Daily Bonus</span>`;
            claimBtn.onclick = () => {
                window.location.href = 'payment.html?tab=deposit';
            };
        } else if (checkInState.claimedToday) {
            claimBtn.disabled = true;
            claimBtn.innerHTML = `<span>✓ Already Claimed Today (Come back tomorrow)</span>`;
            claimBtn.onclick = null;
        } else {
            claimBtn.disabled = false;
            const todayReward = checkInState.rewardsTable && checkInState.rewardsTable[checkInState.streakDay - 1] 
                ? checkInState.rewardsTable[checkInState.streakDay - 1].amount 
                : 5;
            claimBtn.innerHTML = `<span>🎁 Claim Day ${checkInState.streakDay} Bonus (₹${todayReward})</span>`;
            claimBtn.onclick = claimCheckInBonus;
        }
    }
}

// Fetch Referral stats
export async function loadReferralStats() {
    try {
        const token = localStorage.getItem('smarty91_auth_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const resp = await fetch('/api/user/referral/stats', { headers });
        if (resp.ok) {
            const data = await resp.json();
            if (data && data.success) {
                referralState = data;
                renderReferralModal();
            }
        }
    } catch (err) {
        console.warn('Failed to load referral stats:', err);
    }
}

// Render Referral Modal
export function renderReferralModal() {
    const codeEl = document.getElementById('ref-code-val');
    const linkEl = document.getElementById('ref-link-val');
    const totalInvEl = document.getElementById('ref-total-invites');
    const activeDepEl = document.getElementById('ref-active-deps');
    const commissionEl = document.getElementById('ref-total-commission');

    const code = referralState.inviteCode || localStorage.getItem('smarty91_invite_code') || 'SM9101';
    const inviteUrl = `${window.location.origin}/login.html?ref=${code}`;

    if (codeEl) codeEl.textContent = code;
    if (linkEl) linkEl.textContent = inviteUrl;
    if (totalInvEl) totalInvEl.textContent = referralState.totalInvites || 0;
    if (activeDepEl) activeDepEl.textContent = referralState.activeDepositors || 0;
    if (commissionEl) commissionEl.textContent = `₹${(referralState.totalCommissionEarned || 0).toLocaleString('en-IN')}`;

    const invPhoneEl = document.getElementById('modal-inviter-phone');
    if (invPhoneEl && referralState.myInviter) {
        invPhoneEl.textContent = referralState.myInviter.phone || 'Smarty91 Official';
    }
}

// Copy Helper
export function copyText(text, successMsg = 'Copied to clipboard!') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(successMsg, 'success');
        }).catch(() => {
            legacyCopy(text, successMsg);
        });
    } else {
        legacyCopy(text, successMsg);
    }
}

function legacyCopy(text, successMsg) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast(successMsg, 'success');
    } catch (e) {
        showToast('Please copy manually', 'warn');
    }
    document.body.removeChild(textarea);
}

// Open / Close Modals
export function openDailyCheckInModal() {
    const modal = document.getElementById('daily-signin-modal');
    if (modal) {
        modal.classList.add('active');
        loadCheckInStatus();
    }
}

export function closeDailyCheckInModal() {
    const modal = document.getElementById('daily-signin-modal');
    if (modal) modal.classList.remove('active');
}

export function openReferralModal() {
    const modal = document.getElementById('referral-modal');
    if (modal) {
        modal.classList.add('active');
        loadReferralStats();
    }
}

export function closeReferralModal() {
    const modal = document.getElementById('referral-modal');
    if (modal) modal.classList.remove('active');
}

export function openNoticeModal() {
    const modal = document.getElementById('notice-modal');
    if (modal) modal.classList.add('active');
}

export function closeNoticeModal() {
    const modal = document.getElementById('notice-modal');
    if (modal) modal.classList.remove('active');
}

export function showUpcomingGameToast() {
    showToast('🎮 Coming Soon! This game is in final development for the next update.', 'warn');
}

// Initialize Navigation Listeners
export function initHomeNavigation() {
    // Check URL parameters (e.g. ?view=game or ?tab=checkin or ?tab=referral)
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const tabParam = urlParams.get('tab');

    if (viewParam === 'game') {
        verifyDepositStatus().then(hasDep => {
            if (hasDep) {
                switchView('game');
            } else {
                switchView('home');
                showDepositRequiredModal();
            }
        });
    } else {
        switchView('home');
    }

    if (tabParam === 'checkin') {
        openDailyCheckInModal();
    } else if (tabParam === 'referral') {
        openReferralModal();
    }

    // Attach direct click and touch handlers for Colour Prediction game card
    const cpCard = document.getElementById('game-card-colour-prediction');
    if (cpCard) {
        cpCard.onclick = (e) => {
            if (e) e.preventDefault();
            openGameWithLoader('game');
        };
        cpCard.addEventListener('click', (e) => {
            if (e) e.preventDefault();
            openGameWithLoader('game');
        }, { passive: false });
    }

    // Attach global hooks
    window.switchAppView = switchView;
    window.openGameWithLoader = openGameWithLoader;
    window.openDailyCheckInModal = openDailyCheckInModal;
    window.closeDailyCheckInModal = closeDailyCheckInModal;
    window.openReferralModal = openReferralModal;
    window.closeReferralModal = closeReferralModal;
    window.openNoticeModal = openNoticeModal;
    window.closeNoticeModal = closeNoticeModal;
    window.showUpcomingGameToast = showUpcomingGameToast;
    window.copyReferralCode = () => {
        const code = referralState.inviteCode || localStorage.getItem('smarty91_invite_code') || 'SM9101';
        copyText(code, `Invite Code ${code} copied!`);
    };
    window.copyReferralLink = () => {
        const code = referralState.inviteCode || localStorage.getItem('smarty91_invite_code') || 'SM9101';
        const link = `${window.location.origin}/login.html?ref=${code}`;
        copyText(link, 'VIP Referral link copied!');
    };

    // Load initial check-in data in background
    loadCheckInStatus();

    // Load Today's Profit Stars from server
    loadProfitStars();

    // Initialize Social Proof & Multi-User Live Winning Engine
    initSocialProofEngine();
}

export async function loadProfitStars() {
    try {
        const resp = await fetch('/api/game/profit-stars');
        if (resp.ok) {
            const data = await resp.json();
            if (data && data.success && data.profitStars) {
                renderProfitStars(data.profitStars);
            }
        }
    } catch (e) {
        console.warn('Failed to load profit stars:', e);
    }
}

export function renderProfitStars(stars) {
    if (!stars) return;

    // Rank 1
    const u1 = document.getElementById('podium-user-1');
    const v1 = document.getElementById('podium-val-1');
    if (stars.rank1) {
        const f1 = stars.rank1.first2 || '98';
        const l1 = stars.rank1.last2 || '71';
        if (u1) u1.textContent = `User ${f1}***${l1}`;
        if (v1) {
            const amt1 = stars.rank1.amount || '₹1,84,500';
            v1.textContent = amt1.startsWith('₹') ? amt1 : `₹${amt1}`;
        }
    }

    // Rank 2
    const u2 = document.getElementById('podium-user-2');
    const v2 = document.getElementById('podium-val-2');
    if (stars.rank2) {
        const f2 = stars.rank2.first2 || '91';
        const l2 = stars.rank2.last2 || '04';
        if (u2) u2.textContent = `User ${f2}***${l2}`;
        if (v2) {
            const amt2 = stars.rank2.amount || '₹1,12,800';
            v2.textContent = amt2.startsWith('₹') ? amt2 : `₹${amt2}`;
        }
    }

    // Rank 3
    const u3 = document.getElementById('podium-user-3');
    const v3 = document.getElementById('podium-val-3');
    if (stars.rank3) {
        const f3 = stars.rank3.first2 || '88';
        const l3 = stars.rank3.last2 || '51';
        if (u3) u3.textContent = `User ${f3}***${l3}`;
        if (v3) {
            const amt3 = stars.rank3.amount || '₹76,400';
            v3.textContent = amt3.startsWith('₹') ? amt3 : `₹${amt3}`;
        }
    }
}

/* ==========================================================
   MULTI-USER SOCIAL PROOF & LIVE WINNING ENGINE (MASSIVE TRUST)
   ========================================================== */

const RANDOM_USERS = [
    '98***412', '91***892', '70***419', '88***531', '99***712',
    '63***881', '96***240', '84***915', '93***607', '79***118',
    '95***432', '87***619', '90***328', '73***805', '92***114',
    '86***993', '97***552', '89***401', '94***726', '76***389',
    '91***543', '98***908', '80***144', '77***632', '93***219',
    '85***467', '96***830', '74***991', '98***315', '91***220',
    '70***984', '88***410', '99***129', '63***701', '94***556'
];

const GAME_MODES = ['Smarty91 30s', 'Smarty91 1Min', 'Smarty91 3Min', 'Smarty91 5Min'];

const WIN_OUTCOMES = [
    { type: 'RED', label: 'Red', colorClass: 'red', icon: '🔴', multiplier: '2X', minAmt: 980, maxAmt: 7840 },
    { type: 'GREEN', label: 'Green', colorClass: 'green', icon: '🟢', multiplier: '2X', minAmt: 1470, maxAmt: 9800 },
    { type: 'VIOLET', label: 'Violet', colorClass: 'violet', icon: '🟣', multiplier: '4.5X', minAmt: 3920, maxAmt: 19600 },
    { type: 'NUMBER', label: 'Number 7', colorClass: 'gold', icon: '🎯', multiplier: '9X', minAmt: 8820, maxAmt: 35280 },
    { type: 'NUMBER', label: 'Number 3', colorClass: 'gold', icon: '🎯', multiplier: '9X', minAmt: 4410, maxAmt: 26460 },
    { type: 'NUMBER', label: 'Number 8', colorClass: 'gold', icon: '🎯', multiplier: '9X', minAmt: 6860, maxAmt: 39200 },
    { type: 'NUMBER', label: 'Violet 0', colorClass: 'violet', icon: '👑', multiplier: '9X', minAmt: 14700, maxAmt: 58800 },
    { type: 'WITHDRAWAL_UPI', label: 'Instant UPI Cashout', isWithdrawal: true, colorClass: 'gold', icon: '⚡', minAmt: 5000, maxAmt: 35000 },
    { type: 'WITHDRAWAL_USDT', label: 'USDT TRC20 Cashout', isWithdrawal: true, colorClass: 'green', icon: '💎', minAmt: 15000, maxAmt: 90000 }
];

function getRandomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomAmount(min, max, step = 50) {
    const raw = Math.floor(Math.random() * (max - min + 1)) + min;
    return Math.floor(raw / step) * step;
}

function generateRandomEvent() {
    const user = getRandomElement(RANDOM_USERS);
    const game = getRandomElement(GAME_MODES);
    const outcome = getRandomElement(WIN_OUTCOMES);
    const amount = getRandomAmount(outcome.minAmt, outcome.maxAmt, 10);

    return {
        user,
        game,
        outcome,
        amount,
        time: 'Just now'
    };
}

function initSocialProofEngine() {
    // 1. Populate Top Marquee Ticker
    const marqueeTrack = document.getElementById('home-live-marquee');
    if (marqueeTrack) {
        let marqueeHTML = '';
        for (let i = 0; i < 20; i++) {
            const ev = generateRandomEvent();
            if (ev.outcome.isWithdrawal) {
                marqueeHTML += `<span>⚡ User ${ev.user} withdrew ₹${ev.amount.toLocaleString('en-IN')} via ${ev.outcome.label.split(' ')[0]}</span>`;
            } else {
                marqueeHTML += `<span>${ev.outcome.icon} User ${ev.user} won ₹${ev.amount.toLocaleString('en-IN')} on ${ev.outcome.label}</span>`;
            }
        }
        marqueeTrack.innerHTML = marqueeHTML;
    }

    // 2. Populate Initial Live Stream Feed
    const streamContainer = document.getElementById('home-live-stream-list');
    if (streamContainer) {
        let streamHTML = '';
        const initialTimes = ['Just now', '14s ago', '32s ago', '55s ago', '1m ago', '2m ago', '3m ago'];
        for (let i = 0; i < initialTimes.length; i++) {
            const ev = generateRandomEvent();
            ev.time = initialTimes[i];
            streamHTML += createStreamItemHTML(ev);
        }
        streamContainer.innerHTML = streamHTML;

        // Start Auto-Prepend Loop (every 3.6s)
        setInterval(() => {
            if (document.hidden) return;
            const newEv = generateRandomEvent();
            const newItemNode = document.createElement('div');
            newItemNode.innerHTML = createStreamItemHTML(newEv);
            const firstChild = newItemNode.firstElementChild;
            if (firstChild && streamContainer) {
                streamContainer.insertBefore(firstChild, streamContainer.firstChild);
                // Keep stream size bounded to 8 items
                while (streamContainer.children.length > 8) {
                    streamContainer.removeChild(streamContainer.lastChild);
                }
            }
        }, 3600);
    }

    // 3. Start Floating Social Proof Toast Loop (every 5.2s)
    initFloatingToastLoop();

    // 4. Start Live Online Players Counter for Colour Prediction Banner
    initLivePlayerCounter();
}

function initLivePlayerCounter() {
    const countEl = document.getElementById('cp-live-count-text');
    if (!countEl) return;

    // Minimum boundary: 20,000 | Maximum peak: ~105,000
    const MIN_PLAYERS = 20850;
    const MAX_PLAYERS = 104500;

    // Time of day peak calculation (higher traffic during afternoon & evening/night)
    const hour = new Date().getHours();
    let baseTarget = 26500;
    if (hour >= 18 && hour <= 23) {
        baseTarget = 55000 + Math.floor(Math.random() * 35000); // 55k to 90k peak evening
    } else if (hour >= 12 && hour < 18) {
        baseTarget = 38000 + Math.floor(Math.random() * 25000); // 38k to 63k afternoon
    } else {
        baseTarget = 22000 + Math.floor(Math.random() * 12000); // 22k to 34k late night / morning
    }

    let saved = parseInt(sessionStorage.getItem('cp_live_players_count') || '0', 10);
    if (!saved || saved < MIN_PLAYERS || saved > MAX_PLAYERS) {
        saved = baseTarget;
    }

    let currentPlayers = saved;

    function renderCount() {
        if (countEl) {
            countEl.textContent = `${currentPlayers.toLocaleString('en-IN')}`;
        }
        try {
            sessionStorage.setItem('cp_live_players_count', String(currentPlayers));
        } catch (e) {}
    }

    renderCount();

    // Smooth organic drift every 3.2s to 4.5s
    setInterval(() => {
        if (document.hidden) return;

        // Realistic small delta change (±12 to ±86 players)
        const isUp = Math.random() > 0.46; // slight upward bias
        const delta = Math.floor(Math.random() * 75) + 12;

        if (isUp) {
            currentPlayers += delta;
        } else {
            currentPlayers -= delta;
        }

        // Hard bounds: never below 20,000, never exceeding 1,05,000
        if (currentPlayers < MIN_PLAYERS) {
            currentPlayers = MIN_PLAYERS + Math.floor(Math.random() * 300);
        } else if (currentPlayers > MAX_PLAYERS) {
            currentPlayers = MAX_PLAYERS - Math.floor(Math.random() * 500);
        }

        renderCount();
    }, 3500);
}

function createStreamItemHTML(ev) {
    const isW = !!ev.outcome.isWithdrawal;
    const colorClass = ev.outcome.colorClass || 'red';
    const amountStr = `+₹${ev.amount.toLocaleString('en-IN')}`;
    const statusText = isW ? 'Approved' : 'Won Payout';

    return `
        <div class="stream-item-row">
            <div class="stream-user-side">
                <div class="stream-user-icon ${colorClass}">${ev.outcome.icon}</div>
                <div class="stream-user-info">
                    <div class="stream-phone">User ${ev.user}</div>
                    <div class="stream-meta">
                        <span class="stream-game-tag">${isW ? ev.outcome.label : ev.game}</span>
                        <span>•</span>
                        <span>${ev.time}</span>
                    </div>
                </div>
            </div>
            <div class="stream-payout-side">
                <div class="stream-won-amt ${isW ? 'withdrawal' : ''}">${amountStr}</div>
                <div class="stream-status-pill ${isW ? 'withdrawal' : ''}">${statusText}</div>
            </div>
        </div>
    `;
}

function initFloatingToastLoop() {
    const toastEl = document.getElementById('home-floating-toast');
    const toastIcon = document.getElementById('toast-avatar-icon');
    const toastText = document.getElementById('toast-main-text');
    const toastSub = document.getElementById('toast-sub-text');

    if (!toastEl) return;

    function triggerToast() {
        if (document.hidden) return;

        // ONLY trigger popup toast if the user is strictly on the HOME tab (not in game view, modals, or other tabs)
        const homeView = document.getElementById('home-dashboard-view');
        const wingoView = document.getElementById('wingo-game-view');
        const checkinModal = document.getElementById('daily-signin-modal');
        const referralModal = document.getElementById('referral-modal');
        const noticeModal = document.getElementById('notice-modal');

        if (!homeView || homeView.style.display === 'none') {
            toastEl.classList.remove('show');
            return;
        }
        if (wingoView && wingoView.style.display !== 'none') {
            toastEl.classList.remove('show');
            return;
        }
        if ((checkinModal && checkinModal.classList.contains('active')) ||
            (referralModal && referralModal.classList.contains('active')) ||
            (noticeModal && noticeModal.classList.contains('active'))) {
            toastEl.classList.remove('show');
            return;
        }

        const ev = generateRandomEvent();
        const isW = !!ev.outcome.isWithdrawal;

        if (toastIcon) toastIcon.textContent = ev.outcome.icon;
        if (toastText) {
            if (isW) {
                toastText.innerHTML = `User ${ev.user} withdrew <span class="green">₹${ev.amount.toLocaleString('en-IN')}</span>`;
            } else {
                toastText.innerHTML = `User ${ev.user} won <span class="green">₹${ev.amount.toLocaleString('en-IN')}</span> on ${ev.outcome.label}`;
            }
        }
        if (toastSub) {
            toastSub.textContent = `${isW ? 'Instant Payout' : ev.game} • Just now`;
        }

        toastEl.classList.add('show');

        setTimeout(() => {
            toastEl.classList.remove('show');
        }, 3000);
    }

    // First toast after 2.5s, then every 5.8s
    setTimeout(triggerToast, 2500);
    setInterval(triggerToast, 5800);
}

