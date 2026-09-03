// events.js - Primary Event Handler & Betting Interaction Orchestrator

import { placeBet, initSubtabs, renderMyHistory } from './gameEngine.js';
import { getCurrentGameType, getCurrentIssueNumber, switchGameMode, isBettingLocked, getRemainingSeconds } from './gameRecord.js';
import { initWinDialogEvents } from './updateWin.js';
import { showToast } from './wallet.js';
import {
    playClickSound,
    playStepperSound,
    playChipSelectSound,
    playBetPopupOpenSound,
    playBetPlacedSound,
    playModalCloseSound,
    playSpinTick,
    playWinChime
} from './audio.js';

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
    const bettingPopup = document.querySelector('div[role="dialog"][data-v-7f36fe93]');
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

// Update all betting popup values and chip states cleanly
export function updateBetState({ balance, quantity, skipInputFieldUpdate = false }) {
    if (balance !== undefined) {
        currentBetContext.baseBalance = parseInt(balance, 10) || 1;
    }
    if (quantity !== undefined) {
        let q = parseInt(quantity, 10);
        if (isNaN(q) || q < 1) q = 1;
        if (q > 100000) q = 100000;
        currentBetContext.multiplier = q;
        preSelectedMultiplier = q;
    }

    const currentBal = currentBetContext.baseBalance || 1;
    const currentQty = currentBetContext.multiplier || 1;

    // Update Input field unless user is actively typing into it
    const inputField = document.querySelector("#van-field-5-input");
    if (inputField && !skipInputFieldUpdate) {
        inputField.value = currentQty;
    }

    // Update Balance Chips (1, 10, 100, 1000)
    const allItems = document.querySelectorAll('.Betting__Popup-body-line-item');
    const balanceItems = Array.from(allItems).filter((item) => /^\d+$/.test(item.textContent.trim()));
    balanceItems.forEach(chip => {
        const val = parseInt(chip.textContent.trim(), 10);
        const isActive = val === currentBal;
        chip.classList.toggle('bgcolor', isActive);
        chip.classList.toggle('active', isActive);
    });

    // Update Quantity Chips (X1, X5, X10, X20, X50, X100)
    const quantityItems = Array.from(allItems).filter((item) => /^X\d+$/.test(item.textContent.trim()));
    quantityItems.forEach(chip => {
        const multVal = parseInt(chip.textContent.trim().replace('X', ''), 10);
        chip.classList.toggle('bgcolor', multVal === currentQty);
    });

    // Update Outer Multiplier Chips
    const outerMultipleChips = document.querySelectorAll('.Betting__C-multiple-r');
    outerMultipleChips.forEach(outerChip => {
        const outerVal = parseInt(outerChip.textContent.trim().replace('X', ''), 10);
        outerChip.classList.toggle('active', outerVal === currentQty);
    });

    // Update Total Amount Text
    const total = currentBal * currentQty;
    const totalAmountDiv = document.querySelector(".Betting__Popup-foot-s");
    if (totalAmountDiv) {
        totalAmountDiv.textContent = `Total amount ₹${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
}

// Global Stepper Adjust Quantity Helper for + / - buttons (1-by-1 increments)
window.adjustBetQuantity = function(delta, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    playStepperSound(delta);

    let currentQty = currentBetContext.multiplier || 1;
    const inputField = document.querySelector("#van-field-5-input");
    if (inputField && inputField.value !== '') {
        const parsed = parseInt(inputField.value, 10);
        if (!isNaN(parsed) && parsed >= 1) {
            currentQty = parsed;
        }
    }

    let newQty = currentQty + delta;
    if (newQty < 1) newQty = 1;
    if (newQty > 100000) newQty = 100000;

    updateBetState({ quantity: newQty, skipInputFieldUpdate: false });
};

export function openBettingForSelection({ type, selection, selectionLabel, classSuffix }) {
    if (isBettingLocked()) {
        showToast('Betting is locked for the draw', 'error');
        return;
    }

    currentBetContext.type = type;
    currentBetContext.selection = selection;
    currentBetContext.selectionLabel = selectionLabel;
    currentBetContext.baseBalance = currentBetContext.baseBalance || 1;
    currentBetContext.multiplier = preSelectedMultiplier || 1;

    const bettingPopup = document.querySelector('div[role="dialog"][data-v-7f36fe93]');
    const overlay = document.querySelector('.van-overlay[data-v-7f36fe93]');

    if (bettingPopup) {
        bettingPopup.className = bettingPopup.className.replace(/Betting__Popup-\d+/, '');
        bettingPopup.classList.add(`Betting__Popup-${classSuffix}`);
        bettingPopup.classList.remove('van-popup--closing');
        bettingPopup.style.display = 'block';
    }

    updateBettingPopupTheme(type, selection, selectionLabel);
    updateBetState({ balance: currentBetContext.baseBalance, quantity: currentBetContext.multiplier });

    playBetPopupOpenSound();
    if (overlay) {
        overlay.classList.remove('van-overlay--closing');
        overlay.style.display = 'block';
    }
    document.body.classList.add('van-overflow-hidden');
}

export function handleBettingOverlay() {
    const cancelButton = document.querySelector('.Betting__Popup-foot-c');
    const numCItems = document.querySelectorAll('.Betting__C-numC > div, .Betting__C-numC-item');
    const bigButton = document.querySelector('.Betting__C-foot-b');
    const smallButton = document.querySelector('.Betting__C-foot-s');
    const greenBtn = document.querySelector('.Betting__C-head-g');
    const redBtn = document.querySelector('.Betting__C-head-r');
    const violetBtn = document.querySelector('.Betting__C-head-p');
    const overlay = document.querySelector('.van-overlay[data-v-7f36fe93]');

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
    greenBtn?.addEventListener('click', () => {
        openBettingForSelection({
            type: 'color',
            selection: 'green',
            selectionLabel: 'Green',
            classSuffix: '11'
        });
    });

    redBtn?.addEventListener('click', () => {
        openBettingForSelection({
            type: 'color',
            selection: 'red',
            selectionLabel: 'Red',
            classSuffix: '10'
        });
    });

    violetBtn?.addEventListener('click', () => {
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
    playModalCloseSound();
    const overlay = document.querySelector('.van-overlay[data-v-7f36fe93]');
    const dialogDiv = document.querySelector('div[role="dialog"][data-v-7f36fe93]');
    
    if (dialogDiv && dialogDiv.style.display !== 'none') {
        dialogDiv.classList.add('van-popup--closing');
        if (overlay) overlay.classList.add('van-overlay--closing');
        
        document.body.classList.remove('van-overflow-hidden');
        
        setTimeout(() => {
            if (dialogDiv) {
                dialogDiv.style.display = 'none';
                dialogDiv.classList.remove('van-popup--closing');
            }
            if (overlay) {
                overlay.style.display = 'none';
                overlay.classList.remove('van-overlay--closing');
            }
        }, 500); // 500ms matches the smooth CSS animation curve
    } else {
        if (overlay) overlay.style.display = 'none';
        if (dialogDiv) dialogDiv.style.display = 'none';
        document.body.classList.remove('van-overflow-hidden');
    }
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
            playChipSelectSound();
            const val = parseInt(chip.textContent.trim().replace('X', ''), 10) || 1;
            updateBetState({ quantity: val });
        });
    });

    // Balance select chips (1, 10, 100, 1000)
    balanceItems.forEach(item => {
        item.addEventListener("click", () => {
            playChipSelectSound();
            const val = parseInt(item.textContent.trim(), 10) || 1;
            updateBetState({ balance: val });
        });
    });

    // Popup Multiplier chips (X1, X5, X10, X20, X50, X100)
    quantityItems.forEach(item => {
        item.addEventListener("click", () => {
            playChipSelectSound();
            const val = parseInt(item.textContent.trim().replace('X', ''), 10) || 1;
            updateBetState({ quantity: val });
        });
    });

    // Manual Input field handler
    if (inputField) {
        // Auto-select text on focus so user can immediately type their desired number or backspace
        inputField.addEventListener("focus", function () {
            setTimeout(() => {
                try {
                    this.select();
                } catch (e) {}
            }, 50);
        });

        inputField.addEventListener("input", function () {
            const raw = this.value.trim();
            const currentBal = currentBetContext.baseBalance || 1;
            const totalAmountDiv = document.querySelector(".Betting__Popup-foot-s");

            // Allow the field to be completely cleared during typing so leading "1" can be deleted
            if (raw === '') {
                const allItems = document.querySelectorAll('.Betting__Popup-body-line-item');
                const quantityItems = Array.from(allItems).filter((item) => /^X\d+$/.test(item.textContent.trim()));
                quantityItems.forEach(chip => chip.classList.remove('bgcolor'));

                const outerMultipleChips = document.querySelectorAll('.Betting__C-multiple-r');
                outerMultipleChips.forEach(chip => chip.classList.remove('active'));

                if (totalAmountDiv) {
                    totalAmountDiv.textContent = `Total amount ₹0.00`;
                }
                return;
            }

            let val = parseInt(raw.replace(/\D/g, ''), 10);
            if (isNaN(val)) return;

            if (val > 100000) {
                val = 100000;
                this.value = 100000;
            }

            updateBetState({ quantity: val, skipInputFieldUpdate: true });
        });

        inputField.addEventListener("blur", function () {
            const raw = this.value.trim();
            let val = parseInt(raw.replace(/\D/g, ''), 10);
            if (isNaN(val) || val < 1) {
                val = 1;
            }
            if (val > 100000) {
                val = 100000;
            }
            this.value = val;
            updateBetState({ quantity: val, skipInputFieldUpdate: false });
        });
    }

    // Increment and Decrement Stepper Buttons (1-by-1 step)
    const decrementBtn = document.querySelector("#bet-pop-decrement");
    const incrementBtn = document.querySelector("#bet-pop-increment");

    decrementBtn?.addEventListener("click", (e) => {
        window.adjustBetQuantity(-1, e);
    });

    incrementBtn?.addEventListener("click", (e) => {
        window.adjustBetQuantity(1, e);
    });

    // Agreement Checkbox Toggle
    const agreeContainer = document.querySelector('.Betting__Popup-agree');
    const agreeCheckbox = document.querySelector('.Betting__Popup-agree-c');

    agreeContainer?.addEventListener('click', (e) => {
        if (e.target.closest('.Betting__Popup-preSaleShow')) {
            return;
        }
        playClickSound();
        if (agreeCheckbox) {
            agreeCheckbox.classList.toggle('active');
        }
    });

    // Submit Bet Button
    let isSubmittingBet = false;
    const totalAmountDiv = document.querySelector(".Betting__Popup-foot-s");
    totalAmountDiv?.addEventListener("click", async function () {
        if (isSubmittingBet) return;
        if (isBettingLocked()) {
            showToast('Betting is locked for the draw', 'error');
            return;
        }

        // Validate Pre-sale agreement checkbox
        if (agreeCheckbox && !agreeCheckbox.classList.contains('active')) {
            showToast('Please agree to the Pre-sale rules', 'warn');
            return;
        }

        isSubmittingBet = true;
        if (totalAmountDiv) {
            totalAmountDiv.style.pointerEvents = 'none';
            totalAmountDiv.style.opacity = '0.6';
        }

        try {
            const bal = currentBetContext.baseBalance || 1;
            let qty = currentBetContext.multiplier || 1;
            
            // Ensure manual input quantity is accurately read even if blur hasn't fired
            if (inputField && inputField.value.trim() !== '') {
                const parsed = parseInt(inputField.value.trim().replace(/\D/g, ''), 10);
                if (!isNaN(parsed) && parsed >= 1) {
                    qty = Math.min(parsed, 100000);
                }
            }
            currentBetContext.multiplier = qty;

            const total = bal * qty;
            const gameType = getCurrentGameType();
            const periodId = getCurrentIssueNumber();

            const result = await placeBet({
                periodId,
                gameType,
                type: currentBetContext.type,
                selection: currentBetContext.selection,
                selectionLabel: currentBetContext.selectionLabel,
                betAmount: total,
                quantity: qty,
                balanceUnit: bal
            });

            if (!result.success) {
                const errorMsg = result.message || 'Failed to place bet. Please try again.';
                const InsufficientBalance = document.querySelector(".van-toast--fail");
                if (InsufficientBalance) {
                    const toastText = InsufficientBalance.querySelector('.van-toast__text');
                    if (toastText) toastText.textContent = errorMsg;
                    InsufficientBalance.style.display = "";
                    InsufficientBalance.style.opacity = "1";
                    setTimeout(() => {
                        InsufficientBalance.style.opacity = "0";
                        InsufficientBalance.style.display = "none";
                    }, 2500);
                } else {
                    showToast(errorMsg, 'error');
                }
                return;
            }

            // Success toast & audio
            playBetPlacedSound();
            const betTextToast = document.querySelector(".van-toast--text");
            if (betTextToast) {
                betTextToast.style.display = "";
                setTimeout(() => {
                    betTextToast.style.display = "none";
                }, 2000);
            } else {
                showToast('Bet placed successfully!', 'success');
            }

            renderMyHistory();
            closeBettingPopup();
        } finally {
            isSubmittingBet = false;
            if (totalAmountDiv) {
                totalAmountDiv.style.pointerEvents = '';
                totalAmountDiv.style.opacity = '';
            }
        }
    });
}

// "How to play" Rule Dialog
export function initRuleModal() {
    const ruleDialog = document.querySelector("div[role='dialog'][data-v-0bba67ea]");
    const vanOverlay = document.querySelector(".van-overlay[data-v-7f36fe93]");
    const ruleCloseBtn = document.querySelector(".TimeLeft__C-PreSale-foot-btn");

    // Force hidden on initial load
    if (ruleDialog) ruleDialog.style.display = 'none';

    const ruleTriggers = document.querySelectorAll('.TimeLeft__C-rule, .Betting__Popup-preSaleShow');
    ruleTriggers.forEach(btn => {
        btn.style.cursor = 'pointer';
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            playClickSound();
            const rDialog = document.querySelector("div[role='dialog'][data-v-0bba67ea]");
            const vOverlay = document.querySelector(".van-overlay[data-v-7f36fe93]");
            if (rDialog) rDialog.style.display = 'flex';
            if (vOverlay) vOverlay.style.display = 'block';
            document.body.classList.add('van-overflow-hidden');
        });
    });

    const closeRule = (e) => {
        if (e) e.stopPropagation();
        playClickSound();
        const rDialog = document.querySelector("div[role='dialog'][data-v-0bba67ea]");
        const vOverlay = document.querySelector(".van-overlay[data-v-7f36fe93]");
        const dialogDiv = document.querySelector('div[role="dialog"][data-v-7f36fe93]');
        if (rDialog) rDialog.style.display = 'none';
        
        // Only hide overlay if betting popup is not currently open
        const isBettingOpen = dialogDiv && dialogDiv.style.display !== 'none';
        if (!isBettingOpen) {
            if (vOverlay) vOverlay.style.display = 'none';
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

