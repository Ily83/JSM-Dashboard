import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local tool folders (for example git worktrees under .claude/) hold copies of
    // the tests; e2e/ holds the browser tests, run by Playwright (npm run e2e).
    exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**'],
    // npm run test:coverage: lcov for SonarQube (sonar-project.properties), summary in the terminal.
    coverage: {
      provider: 'v8',
      include: ['src/**', 'server/**', 'shared/**', 'scripts/**'],
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
