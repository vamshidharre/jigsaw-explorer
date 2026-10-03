import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.API_PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          ui: ['radix-ui', 'sonner'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
      '/og': `http://localhost:${API_PORT}`,
      '/sitemap.xml': `http://localhost:${API_PORT}`,
      '/robots.txt': `http://localhost:${API_PORT}`,
      '/ws': { target: `ws://localhost:${API_PORT}`, ws: true },
    },
  },
  preview: {
    port: 4173,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
