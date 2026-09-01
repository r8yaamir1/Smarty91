// elements.js - Dynamic Element Reference Helpers

export const getElement = (selector) => document.querySelector(selector);
export const getAllElements = (selector) => document.querySelectorAll(selector);

// Dynamic getters ensuring no stale null references
export const getPeriodNumber = () => document.querySelector('.TimeLeft__C-id');
export const getPeriodTime = () => document.querySelector('.TimeLeft__C-time');
export const getGameRecordBody = () => document.querySelector('.GameRecord__C-body');
export const getMoney = () => document.querySelector('.Wallet__C-balance-l1 > div[data-v-7dd1adab]');

// Color / Number Buttons
export const getBettingRed = () => document.querySelector('.Betting__C-head-r');
export const getBettingViolet = () => document.querySelector('.Betting__C-head-p');
export const getBettingGreen = () => document.querySelector('.Betting__C-head-g');
export const getBettingNumParent = () => document.querySelector('.Betting__C-numC');
export const getSelectedNum = () => document.querySelector('.Betting__Popup-head-selectName');

// Overlays and Popups
export const getBettingOverlay = () => document.querySelector('.van-overlay[data-v-7f36fe93]');
export const getBettingDialog = () => document.querySelector('div[role="dialog"][data-v-7f36fe93]');
export const getBettingPopup = () => document.querySelector('[data-v-7f36fe93][class*="Betting__Popup-"]');
export const getIsAgree = () => document.querySelector(".Betting__Popup-agree");
export const getInsufficientBalance = () => document.querySelector(".van-toast--fail");

// Amounts & Toasts
export const getTotalAmountDiv = () => document.querySelector(".Betting__Popup-foot-s");
export const getBetTextToast = () => document.querySelector(".van-toast--text");
export const getWinDialog = () => document.querySelector(".WinningTip__C");
export const getWinBonus = () => document.querySelector(".bonus");
export const getWinDetail = () => document.querySelector(".gameDetail");
export const getWinningNum = () => document.querySelector(".WinningNum");
export const getColorType = () => document.querySelector(".WinningTip__C-body-l2");
export const getWinSmallBig = () => document.querySelector(".WinningTip__C-body-l2 > div:nth-child(3)");
export const getWinColor = () => document.querySelector(".WinningTip__C-body-l2 > div:nth-child(1)");
export const getCloseBtn = () => document.querySelector(".closeBtn");
export const getSec3Btn = () => document.querySelector(".acitveBtn");

// Rules Dialog
export const getRuleDialog = () => document.querySelector("div[role='dialog'][data-v-0bba67ea]");
export const getHowtoBtn = () => document.querySelector(".TimeLeft__C-rule");
export const getRuleCloseBtn = () => document.querySelector(".TimeLeft__C-PreSale-foot-btn");
export const getVanOverlay = () => document.querySelector(".van-overlay[data-v-7f36fe93]");
export const getTokenParent = () => document.querySelector(".TimeLeft__C-num");

// Legacy bindings for compatibility
export let period_number = null;
export let period_time = null;
export let gameRecord_body = null;
export var money = null;
export let bettingOn_red = null;
export let bettingOn_violet = null;
export let bettingOn_green = null;
export let bettingOnNum_parent = null;
export let selectedNum = null;
export let overlay = null;
export let dialogDiv = null;
export let bettingPopup = null;
export const isAgree = null;
export const InsufficientBalance = null;
export const totalAmountDiv = null;
export const betTextToast = null;
export const winDialog = null;
export const winBonus = null;
export const winDetail = null;
export const winningNum = null;
export const colorType = null;
export const winSmallBig = null;
export const winColor = null;
export const closeBtn = null;
export const sec3Btn = null;
export const ruleDialog = null;
export const howtoBtn = null;
export const ruleCloseBtn = null;
export const vanOverlay = null;
export const tokenParent = null;
