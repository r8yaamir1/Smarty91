// events.js - Primary Event Handler & Betting Interaction Orchestrator

import {
    overlay, dialogDiv, bettingPopup, totalAmountDiv, isAgree,
    howtoBtn, ruleDialog, ruleCloseBtn, vanOverlay, betTextToast,
    InsufficientBalance, selectedNum,
    bettingOn_red, bettingOn_violet, bettingOn_green
} from './elements.js';
import { placeBet, initSubtabs } from './gameEngine.js';
import { getCurrentGameType, getCurrentIssueNumber, switchGameMode, isBettingLocked, getRemainingSeconds } from './gameRecord.js';
import { initWinDialogEvents } from './updateWin.js';
import { showToast } from './wallet.js';
import { playClickSound, playSpinTick, playWinChime } from './audio.js';

// Pre-selected multiplier from outside quick buttons (default 1)
let preSelectedMultiplier = 1;

// Current active bet selection state
let currentBetContext = {
    type: 'color',
    selection: 'green',
    selectionLabel: 'Green',
    baseBalance: 1,
    multiplier: 1,
};

let isSpinning = false;

export function initGameListEvents() {
    const gameListContainer = document.querySelector('.GameList__C, .WinGo__C-gameList');
    const timeLeftName = document.querySelector('.TimeLeft__C .TimeLeft__C-name');

    if (gameListContainer) {
        const gameItems = gameListContainer.querySelectorAll('.GameList__C-item, .WinGo__C-gameList-item');

        gameItems.forEach(item => {
            item.addEventListener('click', () => {
                playClickSound();
                gameItems.forEach(innerItem => innerItem.classList.remove('active'));
                item.classList.add('active');

                const textContent = item.textContent.trim();
                let formatted = textContent;
                if (formatted.includes('30s') || formatted.includes('30S')) formatted = 'Smarty91 30s';
                else if (formatted.includes('1Min') || formatted.includes('1min') || formatted.includes('1M')) formatted = 'Smarty91 1Min';
                else if (formatted.includes('3Min') || formatted.includes('3min') || formatted.includes('3M')) formatted = 'Smarty91 3Min';
                else if (formatted.includes('5Min') || formatted.includes('5min') || formatted.includes('5M')) formatted = 'Smarty91 5Min';

                if (timeLeftName) {
                    timeLeftName.textContent = formatted;
                }

                const popupHeadTitle = document.querySelector('.Betting__Popup-head-title');
                if (popupHeadTitle) popupHeadTitle.textContent = formatted;

                switchGameMode(formatted);
            });
        });
    }
}

// Update the visual theme, title, and badge inside the betting popup
function updateBettingPopupTheme(type, selection, selectionLabel) {
    if (!bettingPopup) return;

    const popupHead = bettingPopup.querySelector('.Betting__Popup-head');
    const popupTitle = bettingPopup.querySelector('.Betting__Popup-head-title');
    const popupSelect = bettingPopup.querySelector('.Betting__Popup-head-select');
    const submitBtn = document.querySelector('.Betting__Popup-foot-s');

    if (popupTitle) {
        popupTitle.textContent = getCurrentGameType();
    }

    if (popupSelect) {
        popupSelect.innerHTML = `<span class="select-label">Select </span><span class="Betting__Popup-head-selectName select-badge select-${type}-${selection}">${selectionLabel}</span>`;
    }

    // Dynamic color gradient styling on header
    if (popupHead) {
        if (selection === 'green' || ['1', '3', '7', '9'].includes(selection)) {
            popupHead.style.background = 'linear-gradient(135deg, #00B977 0%, #038A56 100%)';
            if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg, #00D084 0%, #00B977 100%)';
        } else if (selection === 'red' || ['2', '4', '6', '8'].includes(selection)) {
            popupHead.style.background = 'linear-gradient(135deg, #FF2E4D 0%, #E51837 100%)';
            if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg, #FF2E4D 0%, #E51837 100%)';
        } else if (selection === 'violet') {
            popupHead.style.background = 'linear-gradient(135deg, #A259FF 0%, #7B2CBF 100%)';
            if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg, #B575FF 0%, #903BE0 100%)';
        } else if (selection === '0') {
            popupHead.style.background = 'linear-gradient(135deg, #E51837 0%, #A259FF 100%)';
            if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg, #E51837 0%, #A259FF 100%)';
        } else if (selection === '5') {
            popupHead.style.background = 'linear-gradient(135deg, #00B977 0%, #A259FF 100%)';
            if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg, #00B977 0%, #A259FF 100%)';
        } else if (selection === 'big') {
            popupHead.style.background = 'linear-gradient(135deg, #FF9900 0%, #E67E00 100%)';
            if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg, #FFA928 0%, #FF9900 100%)';
        } else if (selection === 'small') {
            popupHead.style.background = 'linear-gradient(135deg, #2196F3 0%, #1565C0 100%)';
            if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)';
        } else {
            popupHead.style.background = 'linear-gradient(135deg, #E51837 0%, #B80A22 100%)';
            if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg, #FF2E4D 0%, #E51837 100%)';
        }
    }
}

export function openBettingForSelection({ type, selection, selectionLabel, classSuffix }) {
    if (isBettingLocked()) {
        showToast('Betting is locked for the draw', 'error');
        return;
    }

    currentBetContext.type = type;
    currentBetContext.selection = selection;
    currentBetContext.selectionLabel = selectionLabel;
    currentBetContext.multiplier = preSelectedMultiplier || 1;

    if (bettingPopup) {
        bettingPopup.className = bettingPopup.className.replace(/Betting__Popup-\d+/, '');
        bettingPopup.classList.add(`Betting__Popup-${classSuffix}`);
    }

    updateBettingPopupTheme(type, selection, selectionLabel);

    // Sync input field & multiplier chips inside popup
    const inputField = document.querySelector("#van-field-5-input");
    if (inputField) {
        inputField.value = currentBetContext.multiplier;
    }

    const popupMultiplierChips = document.querySelectorAll('.Betting__Popup-body-line-list .Betting__Popup-body-line-item');
    popupMultiplierChips.forEach(chip => {
        if (/^X\d+$/.test(chip.textContent.trim())) {
            const multVal = parseInt(chip.textContent.trim().replace('X', ''), 10);
            chip.classList.toggle('bgcolor', multVal === currentBetContext.multiplier);
        }
    });

    // Update total amount calculation
    const total = currentBetContext.baseBalance * currentBetContext.multiplier;
    if (totalAmountDiv) {
        totalAmountDiv.textContent = `Total amount ₹${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    playClickSound();
    if (overlay) overlay.style.display = 'block';
    if (dialogDiv) dialogDiv.style.display = 'block';
    document.body.classList.add('van-overflow-hidden');
}

export function handleBettingOverlay() {
    const cancelButton = document.querySelector('.Betting__Popup-foot-c');
    const numCItems = document.querySelectorAll('.Betting__C-numC > div, .Betting__C-numC-item');
    const bigButton = document.querySelector('.Betting__C-foot-b');
    const smallButton = document.querySelector('.Betting__C-foot-s');

    // Big Button (13)
    bigButton?.addEventListener('click', () => {
        openBettingForSelection({
            type: 'size',
            selection: 'big',
            selectionLabel: 'Big',
            classSuffix: '13'
        });
    });

    // Small Button (14)
    smallButton?.addEventListener('click', () => {
        openBettingForSelection({
            type: 'size',
            selection: 'small',
            selectionLabel: 'Small',
            classSuffix: '14'
        });
    });

    // Number Buttons (0 to 9)
    numCItems.forEach((item, index) => {
        item.addEventListener('click', () => {
            const match = item.className.match(/\d+$/);
            const numStr = match ? match[0] : index.toString();
            openBettingForSelection({
                type: 'number',
                selection: numStr,
                selectionLabel: `Number ${numStr}`,
                classSuffix: numStr
            });
        });
    });

    // Color Buttons
    bettingOn_green?.addEventListener('click', () => {
        openBettingForSelection({
            type: 'color',
            selection: 'green',
            selectionLabel: 'Green',
            classSuffix: '11'
        });
    });

    bettingOn_red?.addEventListener('click', () => {
        openBettingForSelection({
            type: 'color',
            selection: 'red',
            selectionLabel: 'Red',
            classSuffix: '10'
        });
    });

    bettingOn_violet?.addEventListener('click', () => {
        openBettingForSelection({
            type: 'color',
            selection: 'violet',
            selectionLabel: 'Violet',
            classSuffix: '12'
        });
    });

    // Cancel Button
    cancelButton?.addEventListener('click', () => {
        closeBettingPopup();
    });

    // Close on overlay backdrop click
    overlay?.addEventListener('click', () => {
        closeBettingPopup();
    });
}

export function closeBettingPopup() {
    if (overlay) overlay.style.display = 'none';
    if (dialogDiv) dialogDiv.style.display = 'none';
    document.body.classList.remove('van-overflow-hidden');
}

export function handleBettingOverlay_clicks() {
    const inputField = document.querySelector("#van-field-5-input");
    const allItems = document.querySelectorAll('.Betting__Popup-body-line-item');

    const balanceItems = Array.from(allItems).filter((item) =>
        /^\d+$/.test(item.textContent.trim())
    );
    const quantityItems = Array.from(allItems).filter((item) =>
        /^X\d+$/.test(item.textContent.trim())
    );

    // Outer Multiplier Chips (X1, X5, X10, X20, X50, X100)
    const outerMultipleChips = document.querySelectorAll('.Betting__C-multiple-r');
    outerMultipleChips.forEach(chip => {
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            playClickSound();
            outerMultipleChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            const val = parseInt(chip.textContent.trim().replace('X', ''), 10) || 1;
            preSelectedMultiplier = val;
            currentBetContext.multiplier = val;

            if (inputField) inputField.value = val;
            quantityItems.forEach(q => {
                const qVal = parseInt(q.textContent.trim().replace('X', ''), 10);
                q.classList.toggle('bgcolor', qVal === val);
            });

            updateTotalAmount();
        });
    });

    // Agree toggle
    isAgree?.addEventListener('click', () => {
        isAgree.classList.toggle('active');
    });

    let selectedBalance = 1;
    let selectedQuantity = preSelectedMultiplier || 1;

    if (inputField) inputField.value = selectedQuantity;

    const updateTotalAmount = () => {
        currentBetContext.baseBalance = selectedBalance;
        currentBetContext.multiplier = selectedQuantity;
        const total = selectedBalance * selectedQuantity;
        if (totalAmountDiv) {
            totalAmountDiv.textContent = `Total amount ₹${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
    };

    // Balance select chips (1, 10, 100, 1000)
    balanceItems.forEach(item => {
        item.addEventListener("click", () => {
            playClickSound();
            balanceItems.forEach(b => b.classList.remove('bgcolor'));
            item.classList.add('bgcolor');
            selectedBalance = parseInt(item.textContent.trim(), 10) || 1;
            updateTotalAmount();
        });
    });

    // Popup Multiplier chips (X1, X5, X10, X20, X50, X100)
    quantityItems.forEach(item => {
        item.addEventListener("click", () => {
            playClickSound();
            quantityItems.forEach(q => q.classList.remove('bgcolor'));
            item.classList.add('bgcolor');
            const val = parseInt(item.textContent.trim().replace('X', ''), 10) || 1;
            selectedQuantity = val;
            preSelectedMultiplier = val;
            if (inputField) inputField.value = val;

            // Sync outer multiple chips
            outerMultipleChips.forEach(outerChip => {
                const outerVal = parseInt(outerChip.textContent.trim().replace('X', ''), 10);
                outerChip.classList.toggle('active', outerVal === val);
            });

            updateTotalAmount();
        });
    });

    // Input field change
    if (inputField) {
        inputField.addEventListener("input", function () {
            let val = parseInt(this.value.replace(/\D/g, ''), 10) || 1;
            val = Math.min(1000, Math.max(1, val));
            this.value = val;
            selectedQuantity = val;
            preSelectedMultiplier = val;

            quantityItems.forEach(item => {
                const multiplierValue = parseInt(item.textContent.trim().replace('X', ''), 10);
                item.classList.toggle('bgcolor', multiplierValue === val);
            });

            outerMultipleChips.forEach(outerChip => {
                const outerVal = parseInt(outerChip.textContent.trim().replace('X', ''), 10);
                outerChip.classList.toggle('active', outerVal === val);
            });

            updateTotalAmount();
        });
    }

    // Increment and Decrement Stepper Buttons
    const decrementBtn = document.querySelector(".Betting__Popup-btn:first-child");
    const incrementBtn = document.querySelector(".Betting__Popup-btn:last-child");

    decrementBtn?.addEventListener("click", () => {
        playClickSound();
        selectedQuantity = Math.max(1, selectedQuantity - 1);
        preSelectedMultiplier = selectedQuantity;
        if (inputField) inputField.value = selectedQuantity;

        quantityItems.forEach(item => {
            const multiplierValue = parseInt(item.textContent.trim().replace('X', ''), 10);
            item.classList.toggle('bgcolor', multiplierValue === selectedQuantity);
        });

        outerMultipleChips.forEach(outerChip => {
            const outerVal = parseInt(outerChip.textContent.trim().replace('X', ''), 10);
            outerChip.classList.toggle('active', outerVal === selectedQuantity);
        });

        updateTotalAmount();
    });

    incrementBtn?.addEventListener("click", () => {
        playClickSound();
        selectedQuantity = Math.min(1000, selectedQuantity + 1);
        preSelectedMultiplier = selectedQuantity;
        if (inputField) inputField.value = selectedQuantity;

        quantityItems.forEach(item => {
            const multiplierValue = parseInt(item.textContent.trim().replace('X', ''), 10);
            item.classList.toggle('bgcolor', multiplierValue === selectedQuantity);
        });

        outerMultipleChips.forEach(outerChip => {
            const outerVal = parseInt(outerChip.textContent.trim().replace('X', ''), 10);
            outerChip.classList.toggle('active', outerVal === selectedQuantity);
        });

        updateTotalAmount();
    });

    // Agreement Checkbox Toggle
    const agreeContainer = document.querySelector('.Betting__Popup-agree');
    const agreeCheckbox = document.querySelector('.Betting__Popup-agree-c');

    agreeContainer?.addEventListener('click', (e) => {
        // If clicking on "Pre-sale rules" link, don't toggle (it opens rule modal)
        if (e.target.closest('.Betting__Popup-preSaleShow')) {
            return;
        }
        playClickSound();
        if (agreeCheckbox) {
            agreeCheckbox.classList.toggle('active');
        }
    });

    // Submit Bet Button
    totalAmountDiv?.addEventListener("click", function () {
        if (isBettingLocked()) {
            showToast('Betting is locked for the draw', 'error');
            return;
        }

        // Validate Pre-sale agreement checkbox
        if (agreeCheckbox && !agreeCheckbox.classList.contains('active')) {
            showToast('Please agree to the Pre-sale rules', 'warn');
            return;
        }

        const total = selectedBalance * selectedQuantity;
        const gameType = getCurrentGameType();
        const periodId = getCurrentIssueNumber();

        const result = placeBet({
            periodId,
            gameType,
            type: currentBetContext.type,
            selection: currentBetContext.selection,
            selectionLabel: currentBetContext.selectionLabel,
            betAmount: total,
            quantity: selectedQuantity,
            balanceUnit: selectedBalance
        });

        if (!result.success) {
            if (InsufficientBalance) {
                InsufficientBalance.style.display = "";
                InsufficientBalance.style.opacity = "1";
                setTimeout(() => {
                    InsufficientBalance.style.opacity = "0";
                    InsufficientBalance.style.display = "none";
                }, 2200);
            } else {
                showToast(result.message || 'Insufficient balance', 'error');
            }
            return;
        }

        // Success toast
        if (betTextToast) {
            betTextToast.style.display = "";
            setTimeout(() => {
                betTextToast.style.display = "none";
            }, 2000);
        } else {
            showToast('Bet placed successfully!', 'success');
        }

        closeBettingPopup();
    });

    updateTotalAmount();
}

// "How to play" Rule Dialog
export function initRuleModal() {
    // Force hidden on initial load
    if (ruleDialog) ruleDialog.style.display = 'none';

    const ruleTriggers = document.querySelectorAll('.TimeLeft__C-rule, .Betting__Popup-preSaleShow');
    ruleTriggers.forEach(btn => {
        btn.style.cursor = 'pointer';
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            playClickSound();
            if (ruleDialog) ruleDialog.style.display = 'flex';
            if (vanOverlay) vanOverlay.style.display = 'block';
            document.body.classList.add('van-overflow-hidden');
        });
    });

    const closeRule = (e) => {
        if (e) e.stopPropagation();
        playClickSound();
        if (ruleDialog) ruleDialog.style.display = 'none';
        
        // Only hide overlay if betting popup is not currently open
        const isBettingOpen = dialogDiv && dialogDiv.style.display !== 'none';
        if (!isBettingOpen) {
            if (vanOverlay) vanOverlay.style.display = 'none';
            document.body.classList.remove('van-overflow-hidden');
        }
    };

    if (ruleCloseBtn) {
        ruleCloseBtn.addEventListener("click", closeRule);
    }
}

// 3-Second Spin Animation & Random Selection
export function initRandomSpin() {
    const randomBtn = document.querySelector('.Betting__C-multiple-l');
    if (!randomBtn) return;
    randomBtn.style.cursor = 'pointer';

    randomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isSpinning) return;

        // Rule: Only works when betting time remaining is > 9 seconds
        const remSeconds = getRemainingSeconds();
        if (isBettingLocked() || remSeconds <= 9) {
            showToast('Random spin is only available when remaining time is > 9s', 'error');
            return;
        }

        isSpinning = true;
        playClickSound();
        randomBtn.classList.add('spinning');

        const numBalls = Array.from(document.querySelectorAll('.Betting__C-numC > div, .Betting__C-numC-item0, .Betting__C-numC-item1, .Betting__C-numC-item2, .Betting__C-numC-item3, .Betting__C-numC-item4, .Betting__C-numC-item5, .Betting__C-numC-item6, .Betting__C-numC-item7, .Betting__C-numC-item8, .Betting__C-numC-item9'));
        
        if (numBalls.length === 0) {
            isSpinning = false;
            randomBtn.classList.remove('spinning');
            return;
        }

        // Target chosen random number from 0 to 9
        const targetNumber = Math.floor(Math.random() * 10);
        let currentIndex = 0;
        const totalDuration = 3000; // Exactly 3 seconds
        const startTime = Date.now();

        const step = () => {
            const now = Date.now();
            const elapsed = now - startTime;

            // Remove highlight from all
            numBalls.forEach(b => b.classList.remove('spin-active-ball', 'random-pulse'));

            // Highlight current ball
            const activeBall = numBalls[currentIndex % numBalls.length];
            if (activeBall) {
                activeBall.classList.add('spin-active-ball');
            }

            playSpinTick(currentIndex);
            currentIndex++;

            if (elapsed < totalDuration) {
                // Smooth easing deceleration at the end
                let nextDelay = 70;
                if (elapsed > 2000) {
                    const progress = (elapsed - 2000) / 1000;
                    nextDelay = 70 + Math.floor(progress * 130);
                }
                setTimeout(step, nextDelay);
            } else {
                // 3 seconds finished: Land on targetNumber
                numBalls.forEach(b => b.classList.remove('spin-active-ball'));
                const chosenBall = numBalls[targetNumber];
                if (chosenBall) {
                    chosenBall.classList.add('random-pulse', 'spin-winner-ball');
                    setTimeout(() => {
                        chosenBall.classList.remove('spin-winner-ball', 'random-pulse');
                    }, 1500);
                }

                isSpinning = false;
                randomBtn.classList.remove('spinning');
                playWinChime();

                // Open betting popup for chosen number
                setTimeout(() => {
                    openBettingForSelection({
                        type: 'number',
                        selection: targetNumber.toString(),
                        selectionLabel: `Number ${targetNumber}`,
                        classSuffix: targetNumber.toString()
                    });
                }, 300);
            }
        };

        step();
    });
}

// Global initialization of all event listeners
export function initAllEvents() {
    initGameListEvents();
    handleBettingOverlay();
    handleBettingOverlay_clicks();
    initRuleModal();
    initRandomSpin();
    initWinDialogEvents();
    initSubtabs();
}
