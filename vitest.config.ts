import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['host/src/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
});
