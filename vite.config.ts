import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The frontend never talks to Jira. Every /api request goes to the local
// Express backend, which is the only place credentials exist.
const apiPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Libraries in their own chunks: they change less often than the app,
        // so a browser keeps them cached across releases.
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'tanstack', test: /[\\/]node_modules[\\/]@tanstack[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
