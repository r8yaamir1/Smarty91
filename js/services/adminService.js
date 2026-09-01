// js/services/adminService.js - Admin Controller Client
import { apiClient } from './apiClient.js';

class AdminService {
    async login(pin) {
        sessionStorage.setItem('smarty91_admin_pin', pin);
        return await apiClient.post('/admin/auth/login', { pin });
    }

    async getOverview() {
        return await apiClient.get('/admin/overview');
    }

    async setNextOutcome(mode, targetNumber) {
        return await apiClient.post('/admin/game-control', { mode, targetNumber });
    }

    async updateModeConfig(mode, { enabled, paused, lockoutSeconds }) {
        return await apiClient.post('/admin/mode-config', { mode, enabled, paused, lockoutSeconds });
    }

    async updatePayoutRules(payload) {
        return await apiClient.post('/admin/payout-rules', payload);
    }

    async getUsers() {
        return await apiClient.get('/admin/users');
    }

    async adjustUserBalance(userId, amount, action, remarks) {
        return await apiClient.post('/admin/users/adjust-balance', { userId, amount, action, remarks });
    }

    async processTransaction(txId, action, adminRemarks) {
        return await apiClient.post('/admin/transactions/process', { txId, action, adminRemarks });
    }

    async getTransactions(params = {}) {
        return await apiClient.get('/admin/transactions', params);
    }

    async updateProbabilities(payload) {
        return await apiClient.post('/admin/probabilities', payload);
    }

    async setModePauseState(mode, action) {
        return await apiClient.post('/admin/mode-pause', { mode, action });
    }

    async resetUserPassword(userId, newPassword) {
        return await apiClient.post('/admin/users/reset-password', { userId, newPassword });
    }

    async sendTelegramTest() {
        return await apiClient.post('/admin/telegram/test', {});
    }

    async registerTelegramWebhook() {
        return await apiClient.post('/admin/telegram/register-webhook', {});
    }

    async updateTelegramConfig(botToken, chatId) {
        return await apiClient.post('/admin/telegram/config', { botToken, chatId });
    }

    async getProfitStars() {
        return await apiClient.get('/game/profit-stars');
    }

    async updateProfitStars(stars) {
        return await apiClient.post('/admin/profit-stars', stars);
    }

    async getReferralStars() {
        return await apiClient.get('/game/referral-stars');
    }

    async updateReferralStars(stars) {
        return await apiClient.post('/admin/referral-stars', stars);
    }

    async getRiskEngineStatus() {
        return await apiClient.get('/admin/risk-engine/status');
    }

    async updateRiskEngineConfig(payload) {
        return await apiClient.post('/admin/risk-engine/config', payload);
    }

    async updateTargetedUser(userIdOrPhone, status) {
        return await apiClient.post('/admin/risk-engine/targeted-users', { userIdOrPhone, status });
    }
}

export const adminService = new AdminService();
