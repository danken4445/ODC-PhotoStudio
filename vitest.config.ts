import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.test.{ts,tsx}',
      'apps/**/*.test.{ts,tsx}',
      'supabase/tests/**/*.test.{ts,tsx}'
    ],
    testTimeout: 30000
  },
  resolve: {
    alias: {
      '@odc-photostudio/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@odc-photostudio/template-engine': path.resolve(__dirname, 'packages/template-engine/src/index.ts'),
      '@': path.resolve(__dirname, 'apps/web-portal/src'),
      'next/server': path.resolve(__dirname, 'apps/web-portal/node_modules/next/server.js'),
      'next': path.resolve(__dirname, 'apps/web-portal/node_modules/next')
    }
  }
});
