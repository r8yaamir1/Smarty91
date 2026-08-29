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

export function calculateTotalPeriods(date, interval) {
    const midnight = new Date(date).setUTCHours(0, 0, 0, 0);
    const msSinceMidnight = date.getTime() - midnight;
    return Math.floor(msSinceMidnight / interval);
}

export function formatIssueNumber(date, totalPeriods) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}1000${50001 + totalPeriods}`;
}

export function generateOfflinePeriodData(gameType, targetTime = new Date()) {
    const mode = normalizeMode(gameType);
    const interval = getGameInterval(mode);

    const nowMs = targetTime.getTime();
    const nextIntervalTime = nowMs + interval - (nowMs % interval);
    const endTime = new Date(nextIntervalTime);

    const totalPeriods = calculateTotalPeriods(targetTime, interval);
    const issueNumber = formatIssueNumber(targetTime, totalPeriods);

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
