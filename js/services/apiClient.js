// js/services/apiClient.js - High Reliability API Transport Client

class ApiClient {
    constructor() {
        this.baseUrl = '/api';
    }

    async get(endpoint, params = {}, options = {}) {
        if (options.showLoader && window.SmartyLoader) {
            window.SmartyLoader.show(options.loaderMsg || '');
        }
        try {
            const url = new URL(this.baseUrl + endpoint, window.location.origin);
            Object.keys(params).forEach(key => {
                if (params[key] !== undefined && params[key] !== null) {
                    url.searchParams.append(key, params[key]);
                }
            });

            const headers = { 'Accept': 'application/json' };
            const authToken = localStorage.getItem('smarty91_auth_token');
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
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
        } finally {
            if (options.showLoader && window.SmartyLoader) {
                window.SmartyLoader.hide();
            }
        }
    }

    async post(endpoint, body = {}, options = {}) {
        if (options.showLoader && window.SmartyLoader) {
            window.SmartyLoader.show(options.loaderMsg || '');
        }
        try {
            const url = this.baseUrl + endpoint;
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            const authToken = localStorage.getItem('smarty91_auth_token');
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
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
        } finally {
            if (options.showLoader && window.SmartyLoader) {
                window.SmartyLoader.hide();
            }
        }
    }
}

export const apiClient = new ApiClient();
