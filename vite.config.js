import { defineConfig } from 'vite';

function expressApiPlugin() {
    return {
        name: 'express-api-plugin',
        async configureServer(server) {
            const express = (await import('express')).default;
            const { apiRouter } = await import('./server/apiRouter.js');
            const app = express();
            app.use(express.json());

            // Support direct URL access to /admin7117
            app.use((req, res, next) => {
                if (req.url === '/admin7117' || req.url === '/admin7117/' || req.url.startsWith('/admin7117?')) {
                    req.url = '/admin.html';
                }
                next();
            });

            app.use('/api', apiRouter);
            
            server.middlewares.use(app);
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
                admin7117: './admin7117.html',
                login: './login.html',
                profile: './profile.html',
                payment: './payment.html'
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

