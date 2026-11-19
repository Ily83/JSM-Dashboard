import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local tool folders (for example git worktrees under .claude/) hold copies of the tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
