import { defineConfig } from 'vite';

function expressApiPlugin() {
    return {
        name: 'express-api-plugin',
        async configureServer(server) {
            const express = (await import('express')).default;
            const { apiRouter } = await import('./server/apiRouter.js');
            const app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: true }));
            app.use('/api', apiRouter);

            server.middlewares.use((req, res, next) => {
                if (req.url.startsWith('/api/') || req.url === '/api' || req.url === '/ping' || req.url === '/healthz') {
                    if (req.url === '/ping' || req.url === '/healthz') {
                        req.url = '/api' + req.url;
                    }
                    return app(req, res, next);
                }
                next();
            });
        }
    };
}

export default defineConfig({
    plugins: [expressApiPlugin()],
    build: {
        rollupOptions: {
            input: {
                main: './index.html',
                admin: './admin.html',
                login: './login.html',
                profile: './profile.html',
                payment: './payment.html',
                checkin: './checkin.html',
                referral: './referral.html'
            }
        }
    },
    server: {
        port: 3000,
        host: '0.0.0.0'
    },
    preview: {
        port: 3000,
        host: '0.0.0.0'
    }
});

