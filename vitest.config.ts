import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    testTimeout: 30000
  },
  resolve: {
    alias: {
      '@odc-photostudio/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@odc-photostudio/template-engine': path.resolve(__dirname, 'packages/template-engine/src/index.ts')
    }
  }
});
