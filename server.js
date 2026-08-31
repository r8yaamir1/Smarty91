import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './server/apiRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Prevent stale caching of app assets and HTML
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// API endpoints
app.use('/api', apiRouter);

// Serve static assets from dist or root
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.use(express.static(__dirname));

// Direct HTML page routing
const sendPage = (pageName, res) => {
    const filePathInDist = path.join(distPath, pageName);
    const filePathInRoot = path.join(__dirname, pageName);
    res.sendFile(filePathInDist, (err) => {
        if (err) {
            res.sendFile(filePathInRoot);
        }
    });
};

app.get('/admin', (req, res) => sendPage('admin.html', res));
app.get('/admin.html', (req, res) => sendPage('admin.html', res));
app.get('/payment', (req, res) => sendPage('payment.html', res));
app.get('/payment.html', (req, res) => sendPage('payment.html', res));
app.get('/profile', (req, res) => sendPage('profile.html', res));
app.get('/profile.html', (req, res) => sendPage('profile.html', res));
app.get('/referral', (req, res) => sendPage('referral.html', res));
app.get('/referral.html', (req, res) => sendPage('referral.html', res));
app.get('/checkin', (req, res) => sendPage('checkin.html', res));
app.get('/checkin.html', (req, res) => sendPage('checkin.html', res));
app.get('/login', (req, res) => sendPage('login.html', res));
app.get('/login.html', (req, res) => sendPage('login.html', res));

// Fallback to index.html for SPA routing (Express 5 compatible)
app.use((req, res) => {
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) {
            res.sendFile(path.join(__dirname, 'index.html'));
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smarty91 Full-Stack Server running on port ${PORT}`);
});
