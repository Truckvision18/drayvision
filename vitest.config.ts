import { defineConfig } from 'vitest/config';

// Node-side tests (shared + api + repo-level scaffold checks).
// Mobile tests run under Jest with the React Native preset (apps/mobile).
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // No test may reach a real network provider: all providers are mocked.
    env: { DRAYVISION_ENV: 'test' },
  },
});
