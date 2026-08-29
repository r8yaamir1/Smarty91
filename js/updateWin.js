// updateWin.js - Win / Loss Result Dialog Manager

import { winDialog, winBonus, winDetail, winningNum, winSmallBig, winColor, colorType, closeBtn, sec3Btn } from "./elements.js";
import { formatCurrency } from "./wallet.js";

let autoCloseTimer = null;
let isAutoCloseEnabled = true;

export function showEvaluationDialog(summary) {
    if (!summary || !winDialog) return;

    const { isWin, totalWon, result, lastBet } = summary;

    // Reset styles
    winDialog.style.display = 'block';
    document.body.classList.add('van-overflow-hidden');

    const bodyEl = winDialog.querySelector('.WinningTip__C-body');
    const titleEl = winDialog.querySelector('.WinningTip__C-body-l1');

    if (bodyEl) {
        bodyEl.classList.toggle('isL', !isWin);
    }
    if (titleEl) {
        titleEl.classList.toggle('isL', !isWin);
        titleEl.textContent = isWin ? 'Congratulations' : 'Sorry';
    }

    if (winDetail) {
        winDetail.textContent = `Period: ${lastBet?.gameType || 'Smarty91'} ${result.periodId}`;
    }
    if (winSmallBig) {
        winSmallBig.textContent = result.isBig ? 'Big' : 'Small';
    }
    if (winningNum) {
        winningNum.textContent = result.number;
    }
    if (winColor) {
        winColor.textContent = result.colorName;
    }
    if (winBonus) {
        winBonus.textContent = isWin ? `+${formatCurrency(totalWon)}` : '₹0.00';
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
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeWinDialog();
        };
    }

    if (sec3Btn) {
        sec3Btn.classList.add('active'); // active by default
        sec3Btn.onclick = (e) => {
            e.stopPropagation();
            sec3Btn.classList.toggle('active');
            isAutoCloseEnabled = sec3Btn.classList.contains('active');
        };
    }

    // Close on backdrop click
    if (winDialog) {
        winDialog.onclick = (e) => {
            if (e.target === winDialog) closeWinDialog();
        };
    }
}
