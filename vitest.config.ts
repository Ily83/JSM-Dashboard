import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local tool folders (for example git worktrees under .claude/) hold copies of
    // the tests; e2e/ holds the browser tests, run by Playwright (npm run e2e).
    exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**'],
  },
});
