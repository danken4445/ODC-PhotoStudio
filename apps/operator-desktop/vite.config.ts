import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@odc-photostudio/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@odc-photostudio/template-engine': path.resolve(__dirname, '../../packages/template-engine/src/index.ts')
    }
  }
});
