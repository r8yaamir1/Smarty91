// offlineTimer.js - Deterministic Period & Timestamp Generator per Mode

export const MODE_INTERVALS = {
    "30s": 30000,
    "1m": 60000,
    "3m": 180000,
    "5m": 300000
};

export const MODE_DISPLAY_NAMES = {
    "30s": "Smarty91 30s",
    "1m": "Smarty91 1Min",
    "3m": "Smarty91 3Min",
    "5m": "Smarty91 5Min"
};

export function normalizeMode(modeInput) {
    if (!modeInput) return "30s";
    const str = String(modeInput).toLowerCase();
    if (str.includes("30s") || str === "30") return "30s";
    if (str.includes("1m") || str.includes("1min") || str === "1") return "1m";
    if (str.includes("3m") || str.includes("3min") || str === "3") return "3m";
    if (str.includes("5m") || str.includes("5min") || str === "5") return "5m";
    return "30s";
}

export function getGameInterval(modeInput) {
    const mode = normalizeMode(modeInput);
    return MODE_INTERVALS[mode] || 30000;
}

export function calculateTotalPeriods(date, interval, useIST = false) {
    if (useIST) {
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = date.getTime() + istOffset;
        const istDate = new Date(istTime);
        const y = istDate.getUTCFullYear();
        const m = istDate.getUTCMonth();
        const d = istDate.getUTCDate();
        const midnightIST = Date.UTC(y, m, d);
        const elapsed = istTime - midnightIST;
        return Math.floor(elapsed / interval);
    } else {
        const midnight = new Date(date).setUTCHours(0, 0, 0, 0);
        const msSinceMidnight = date.getTime() - midnight;
        return Math.floor(msSinceMidnight / interval);
    }
}

export function formatIssueNumber(date, totalPeriods, mode = "30s", useIST = false) {
    let year = date.getUTCFullYear();
    let month = String(date.getUTCMonth() + 1).padStart(2, '0');
    let day = String(date.getUTCDate()).padStart(2, '0');

    if (useIST) {
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = date.getTime() + istOffset;
        const istDate = new Date(istTime);
        year = istDate.getUTCFullYear();
        month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
        day = String(istDate.getUTCDate()).padStart(2, '0');
    }
    
    let modeCode = '30';
    if (useIST) {
        modeCode = '10030';
        if (mode === '1m') modeCode = '10001';
        else if (mode === '3m') modeCode = '10003';
        else if (mode === '5m') modeCode = '10005';
    } else {
        if (mode === '1m') modeCode = '01';
        else if (mode === '3m') modeCode = '03';
        else if (mode === '5m') modeCode = '05';
    }

    const periodOffset = String(totalPeriods + 1).padStart(4, '0');
    return `${year}${month}${day}${modeCode}${periodOffset}`;
}

export function generateOfflinePeriodData(gameType, targetTime = new Date()) {
    const mode = normalizeMode(gameType);
    const interval = getGameInterval(mode);

    const nowMs = targetTime.getTime();
    const nextIntervalTime = nowMs + interval - (nowMs % interval);
    const endTime = new Date(nextIntervalTime);

    const useIST = localStorage.getItem('universal_sync_active') === 'true';
    const totalPeriods = calculateTotalPeriods(targetTime, interval, useIST);
    const issueNumber = formatIssueNumber(targetTime, totalPeriods, mode, useIST);

    return {
        mode,
        displayName: MODE_DISPLAY_NAMES[mode] || `Smarty91 ${mode}`,
        interval,
        endTime: endTime.toISOString(),
        endTimeMs: nextIntervalTime,
        issueNumber,
        remainingSeconds: Math.max(0, Math.ceil((nextIntervalTime - nowMs) / 1000)),
        offline: true
    };
}
