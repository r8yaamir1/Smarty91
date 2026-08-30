// server/telegramAlert.js - Telegram Bot Notification Engine for Smarty91
export const TELEGRAM_CONFIG = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '8847373950:AAFn0U8ODizcxzWmrV_5eV832w5kbl6jqPE',
    chatId: process.env.TELEGRAM_CHAT_ID || '8282793854',
    adminUrl: 'https://smarty911.onrender.com/admin7117'
};

export async function sendTelegramMessage(text) {
    try {
        const token = TELEGRAM_CONFIG.botToken;
        const chatId = TELEGRAM_CONFIG.chatId;
        if (!token || !chatId) return { success: false, message: 'Telegram credentials missing' };

        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: false
            })
        });

        const resData = await response.json();
        if (!resData.ok) {
            console.warn('[Telegram Alert] API Warning:', resData.description);
        }
        return resData;
    } catch (err) {
        console.warn('[Telegram Alert] Error sending alert:', err.message);
        return { success: false, error: err.message };
    }
}

export async function notifyNewDeposit({ userId, phone, amount, bonusAmount, utrNumber, channel, txId }) {
    const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const dateStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
    
    const message = `🚨 <b>NEW DEPOSIT REQUEST! (Smarty91)</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> <code>${phone || userId}</code>
💰 <b>Amount:</b> <b>₹${Number(amount).toLocaleString('en-IN')}</b>
🎁 <b>Bonus:</b> ₹${Number(bonusAmount || 0).toLocaleString('en-IN')}
📝 <b>UTR / Ref:</b> <code>${utrNumber || 'N/A'}</code>
💳 <b>Mode:</b> ${channel || 'UPI'}
🆔 <b>Tx ID:</b> <code>${txId}</code>
⏰ <b>Time:</b> ${timeStr} (${dateStr})
━━━━━━━━━━━━━━━━━━━━
👉 <a href="${TELEGRAM_CONFIG.adminUrl}"><b>OPEN ADMIN PANEL TO APPROVE</b></a>`;

    return sendTelegramMessage(message);
}

export async function notifyNewWithdrawal({ userId, phone, amount, accountHolderName, bankName, accountNumber, ifsc, upiId, txId }) {
    const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const dateStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

    const message = `💸 <b>NEW WITHDRAWAL REQUEST! (Smarty91)</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> <code>${phone || userId}</code>
💰 <b>Amount:</b> <b>₹${Number(amount).toLocaleString('en-IN')}</b>
🏦 <b>Bank Name:</b> ${bankName || 'Bank Transfer'}
👤 <b>A/C Holder:</b> ${accountHolderName || 'User'}
🔢 <b>Account No:</b> <code>${accountNumber || 'N/A'}</code>
🏛 <b>IFSC Code:</b> <code>${ifsc || 'N/A'}</code>
📱 <b>UPI ID:</b> <code>${upiId || 'N/A'}</code>
🆔 <b>Tx ID:</b> <code>${txId}</code>
⏰ <b>Time:</b> ${timeStr} (${dateStr})
━━━━━━━━━━━━━━━━━━━━
👉 <a href="${TELEGRAM_CONFIG.adminUrl}"><b>OPEN ADMIN PANEL TO PROCESS</b></a>`;

    return sendTelegramMessage(message);
}
