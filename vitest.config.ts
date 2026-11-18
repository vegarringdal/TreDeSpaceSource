import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // the same alias as vite.config.ts / tsconfig.json, so tests can load app
  // modules that import the component library (e.g. the hotkey table)
  resolve: { alias: { '@treDeSpaceUI': resolve(import.meta.dirname, 'src/treDeSpaceUI') } },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
