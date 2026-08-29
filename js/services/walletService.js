// js/services/walletService.js - Wallet Ledger Service
import { apiClient } from './apiClient.js';

class WalletService {
    async getBalance() {
        return await apiClient.get('/wallet/balance');
    }

    async getLedger() {
        return await apiClient.get('/wallet/ledger');
    }

    async deposit(amount) {
        return await apiClient.post('/wallet/deposit', { amount });
    }

    async withdraw(amount) {
        return await apiClient.post('/wallet/withdraw', { amount });
    }
}

export const walletService = new WalletService();
