import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'web', plugins: [react()],
  server: { host: '127.0.0.1', port: Number(process.env.WEB_PORT || 4319), strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.PORT || 4318}` } },
  build: { outDir: '../dist/web', emptyOutDir: true }
});
