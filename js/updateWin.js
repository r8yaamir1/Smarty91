// updateWin.js - Win / Loss Result Dialog Manager

import { formatCurrency } from "./wallet.js";

let autoCloseTimer = null;
let isAutoCloseEnabled = true;

export function showEvaluationDialog(summary) {
    const winDialog = document.querySelector(".WinningTip__C");
    if (!summary || !winDialog) return;

    const { isWin, totalWon, totalBet, result, lastBet, mode } = summary;

    // Display overlay
    winDialog.style.display = 'flex';
    document.body.classList.add('van-overflow-hidden');

    const bodyEl = winDialog.querySelector('.WinningTip__C-body');
    const titleEl = winDialog.querySelector('.WinningTip__C-body-l1');
    const headLabel = winDialog.querySelector('.WinningTip__C-body-l3 .head');
    const winDetail = winDialog.querySelector(".gameDetail, .WinningTip__C-body-l3 .gameDetail");
    const winningNum = winDialog.querySelector(".tip-num-val, .WinningNum");
    const winSmallBig = winDialog.querySelector(".tip-size-val");
    const winColor = winDialog.querySelector(".tip-color-val");
    const winBonus = winDialog.querySelector(".bonus, .WinningTip__C-body-l3 .bonus");
    const colorType = winDialog.querySelector(".WinningTip__C-body-l2");

    if (bodyEl) {
        bodyEl.classList.toggle('isL', !isWin);
    }
    if (titleEl) {
        titleEl.classList.toggle('isL', !isWin);
        titleEl.textContent = isWin ? 'Congratulations' : 'Sorry';
    }
    if (headLabel) {
        headLabel.textContent = isWin ? 'Bonus' : 'Lose';
    }

    const modeName = mode ? (mode.toUpperCase().includes('MIN') || mode.toUpperCase().includes('SEC') || mode.toUpperCase().includes('30S') ? mode : `${mode.toUpperCase()}`) : (lastBet?.gameType || 'Smarty91');
    if (winDetail) {
        winDetail.textContent = `Period: ${modeName} ${result.periodId}`;
    }
    if (winSmallBig) {
        winSmallBig.textContent = result.isBig ? 'Big' : 'Small';
    }
    if (winningNum) {
        winningNum.textContent = result.number;
    }
    if (winColor) {
        winColor.textContent = result.colorName || (result.color ? result.color.toUpperCase() : 'Green');
    }
    if (winBonus) {
        if (isWin) {
            winBonus.textContent = `+${formatCurrency(totalWon)}`;
        } else {
            const lostAmount = totalBet || lastBet?.betAmount || 0;
            winBonus.textContent = `-${formatCurrency(lostAmount)}`;
        }
    }

    // Update color badge class
    if (colorType) {
        colorType.className = 'WinningTip__C-body-l2';
        if (result.number === 0) colorType.classList.add('type0');
        else if (result.number === 5) colorType.classList.add('type5');
        else if ([1, 3, 7, 9].includes(result.number)) colorType.classList.add('type3'); // green
        else colorType.classList.add('type4'); // red
    }

    // Auto close setup
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    if (isAutoCloseEnabled) {
        autoCloseTimer = setTimeout(() => {
            closeWinDialog();
        }, 3500);
    }
}

export function closeWinDialog() {
    const winDialog = document.querySelector(".WinningTip__C");
    if (winDialog) {
        winDialog.style.display = 'none';
        document.body.classList.remove('van-overflow-hidden');
    }
    if (autoCloseTimer) {
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
    }
}

export function initWinDialogEvents() {
    const winDialog = document.querySelector(".WinningTip__C");
    const closeBtns = document.querySelectorAll(".WinningTip__C-icon, .closeBtn, .WinningTip__C .closeBtn");
    const autoCloseBtn = document.querySelector(".acitveBtn, .WinningTip__C-body-l4 .acitveBtn, .WinningTip__C-body-l4");

    closeBtns.forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            closeWinDialog();
        };
    });

    if (autoCloseBtn) {
        const toggleIcon = autoCloseBtn.classList.contains('acitveBtn') ? autoCloseBtn : autoCloseBtn.querySelector('.acitveBtn');
        if (toggleIcon) toggleIcon.classList.add('active'); // active by default
        
        autoCloseBtn.onclick = (e) => {
            e.stopPropagation();
            if (toggleIcon) {
                toggleIcon.classList.toggle('active');
                isAutoCloseEnabled = toggleIcon.classList.contains('active');
            }
        };
    }

    // Close on backdrop click
    if (winDialog) {
        winDialog.onclick = (e) => {
            if (e.target === winDialog) closeWinDialog();
        };
    }
}


