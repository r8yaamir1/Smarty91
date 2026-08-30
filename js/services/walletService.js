// js/services/walletService.js - VIP Wallet & Cashier Service
import { apiClient } from './apiClient.js';

class WalletService {
    async getBalance() {
        return await apiClient.get('/wallet/balance');
    }

    async getSummary() {
        return await apiClient.get('/wallet/summary');
    }

    async getLedger() {
        return await apiClient.get('/wallet/ledger');
    }

    async getTransactions() {
        return await apiClient.get('/wallet/transactions');
    }

    async initDeposit({ amount, channel = 'UPI_FAST' }) {
        return await apiClient.post('/wallet/deposit-init', { amount, channel });
    }

    async submitDepositRequest({ amount, utrNumber, upiId, channel = 'UPI_FAST' }) {
        return await apiClient.post('/wallet/deposit-request', {
            amount: Number(amount),
            utrNumber: String(utrNumber).trim(),
            upiId,
            channel
        });
    }

    async submitBankWithdrawal({ amount, accountHolderName, bankName, accountNumber, ifsc, securityPin, upiId }) {
        return await apiClient.post('/wallet/withdraw-bank', {
            amount: Number(amount),
            accountHolderName: String(accountHolderName).trim(),
            bankName: String(bankName).trim(),
            accountNumber: String(accountNumber).trim(),
            ifsc: String(ifsc).trim().toUpperCase(),
            securityPin: securityPin ? String(securityPin).trim() : '',
            upiId: upiId ? String(upiId).trim() : ''
        });
    }

    async createInstamojoOrder(amount) {
        return await apiClient.post('/wallet/instamojo/create-order', { amount: Number(amount) });
    }
}

export const walletService = new WalletService();
