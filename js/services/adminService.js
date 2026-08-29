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
}

export const adminService = new AdminService();
