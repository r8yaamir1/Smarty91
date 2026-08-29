// js/services/gameService.js - Game & Round Synchronization Service
import { apiClient } from './apiClient.js';

class GameService {
    async getGameStatus() {
        return await apiClient.get('/games/status');
    }

    async getGameHistory(mode, page = 1, limit = 10) {
        return await apiClient.get(`/games/history/${mode}`, { page, limit });
    }

    async getChartData(mode) {
        return await apiClient.get(`/games/chart/${mode}`);
    }

    async placeBet({ mode, periodId, type, selection, unitAmount, multiplier, quantity = 1 }) {
        return await apiClient.post('/bets/place', {
            mode,
            periodId,
            type,
            selection,
            unitAmount,
            multiplier,
            quantity
        });
    }

    async getMyBetHistory(mode, page = 1, limit = 10) {
        return await apiClient.get(`/bets/my-history/${mode}`, { page, limit });
    }
}

export const gameService = new GameService();
