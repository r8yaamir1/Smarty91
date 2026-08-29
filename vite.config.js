import { defineConfig } from 'vite';
import { apiRouter } from './server/apiRouter.js';
import express from 'express';

function expressApiPlugin() {
    return {
        name: 'express-api-plugin',
        configureServer(server) {
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
                admin: './admin.html'
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
