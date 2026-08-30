// js/services/gameService.js - Game & Round Synchronization Service
import { apiClient } from './apiClient.js';

class GameService {
    // Background polling: strictly silent (no UI blocking)
    async getGameStatus() {
        return await apiClient.get('/games/status', {}, { showLoader: false });
    }

    // Fetches full 50-round FIFO history
    async getGameHistory(mode, page = 1, limit = 50) {
        return await apiClient.get(`/games/history/${mode}`, { page, limit }, { showLoader: false });
    }

    async getChartData(mode) {
        return await apiClient.get(`/games/chart/${mode}`, {}, { showLoader: false });
    }

    // Manual user action: place bet (shows minimal circle loader during placement)
    async placeBet({ mode, periodId, type, selection, unitAmount, multiplier, quantity = 1 }) {
        return await apiClient.post('/bets/place', {
            mode,
            periodId,
            type,
            selection,
            unitAmount,
            multiplier,
            quantity
        }, { showLoader: true, loaderMsg: 'Placing Bet...' });
    }

    async getMyBetHistory(mode, page = 1, limit = 10) {
        return await apiClient.get(`/bets/my-history/${mode}`, { page, limit }, { showLoader: false });
    }
}

export const gameService = new GameService();
