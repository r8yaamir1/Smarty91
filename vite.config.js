import { defineConfig } from 'vite';

function expressApiPlugin() {
    return {
        name: 'express-api-plugin',
        async configureServer(server) {
            const express = (await import('express')).default;
            const { apiRouter } = await import('./server/apiRouter.js');
            const app = express();
            app.use(express.json());
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
                login: './login.html'
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

