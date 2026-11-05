import { defineConfig } from 'vitest/config';

/** Routing integration tests — run via services/routing/it.sh, which starts a real Valhalla. */
export default defineConfig({
  test: {
    include: ['services/routing/test/**/*.it.test.ts'],
    environment: 'node',
    env: { DRAYVISION_ENV: 'test' },
    testTimeout: 30_000,
  },
});
