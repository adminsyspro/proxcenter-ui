import { defineConfig } from 'vitest/config'
import path from 'path'

const alias = {
  '@': path.resolve(__dirname, 'src'),
  '@components': path.resolve(__dirname, 'src/components'),
  '@configs': path.resolve(__dirname, 'src/configs'),
  '@assets': path.resolve(__dirname, 'src/assets'),
  '@core': path.resolve(__dirname, 'src/@core'),
  '@menu': path.resolve(__dirname, 'src/@menu'),
  '@layouts': path.resolve(__dirname, 'src/@layouts'),
  '@views': path.resolve(__dirname, 'src/views'),
}

export default defineConfig({
  // Root resolve applies to every project below.
  resolve: { alias },
  test: {
    // Coverage is configured once at the root; running `vitest run --coverage`
    // executes all projects and emits ONE merged coverage/lcov.info that the
    // SonarCloud workflow already consumes. No external lcov merge needed.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx,js,jsx}',
        'src/__tests__/**',
        'src/@core/**',
        'src/@menu/**',
        'src/@layouts/**',
        'src/types/**',
        '**/*.d.ts',
      ],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.{ts,js}'],
          // Postgres globalSetup stays scoped to the node project only.
          globalSetup: ['./src/__tests__/setup/postgres.ts'],
          fileParallelism: false,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/__tests__/setup/jsdom-setup.ts'],
        },
      },
    ],
  },
})
