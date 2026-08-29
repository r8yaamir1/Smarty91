// js/adminPanel.js - Dedicated Master Admin Navigation Trigger
export function initAdminPanel() {
    createAdminTriggerButton();
}

function createAdminTriggerButton() {
    if (document.getElementById('smarty91-admin-trigger')) return;

    const btn = document.createElement('a');
    btn.id = 'smarty91-admin-trigger';
    btn.href = '/admin.html';
    btn.style.cssText = `
        position: fixed;
        bottom: 70px;
        right: 12px;
        z-index: 9999;
        background: linear-gradient(135deg, #101728, #090d16);
        color: #f59e0b;
        border: 1px solid #f59e0b;
        border-radius: 24px;
        padding: 7px 14px;
        font-size: 11px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.8);
        text-decoration: none;
        user-select: none;
        letter-spacing: 0.5px;
    `;
    btn.innerHTML = `
        <span style="display:inline-block; width:8px; height:8px; background:#10b981; border-radius:50%; box-shadow: 0 0 8px #10b981;"></span>
        <span>🛡️ ADMIN PANEL</span>
    `;

    document.body.appendChild(btn);
}
