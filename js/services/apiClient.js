// js/services/apiClient.js - Centralized Fetch Client

class ApiClient {
    constructor() {
        this.baseUrl = '/api';
    }

    async get(endpoint, params = {}) {
        const url = new URL(this.baseUrl + endpoint, window.location.origin);
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.append(key, params[key]);
            }
        });

        const headers = { 'Accept': 'application/json' };
        const adminPin = sessionStorage.getItem('smarty91_admin_pin') || localStorage.getItem('smarty91_admin_pin');
        if (adminPin) {
            headers['x-admin-pin'] = adminPin;
        }

        const res = await fetch(url.toString(), { credentials: 'same-origin', headers });
        const data = await res.json().catch(() => ({ success: false, message: 'Invalid response' }));
        if (!res.ok) {
            throw new Error(data.message || `Request failed with status ${res.status}`);
        }
        return data;
    }

    async post(endpoint, body = {}) {
        const url = this.baseUrl + endpoint;
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        const adminPin = sessionStorage.getItem('smarty91_admin_pin') || localStorage.getItem('smarty91_admin_pin');
        if (adminPin) {
            headers['x-admin-pin'] = adminPin;
        }

        const res = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify(body)
        });

        const data = await res.json().catch(() => ({ success: false, message: 'Invalid response' }));
        if (!res.ok) {
            throw new Error(data.message || `Request failed with status ${res.status}`);
        }
        return data;
    }
}

export const apiClient = new ApiClient();
