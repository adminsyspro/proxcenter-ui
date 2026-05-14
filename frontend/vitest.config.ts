import path from 'path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@configs': path.resolve(__dirname, 'src/configs'),
      '@assets': path.resolve(__dirname, 'src/assets'),
      '@core': path.resolve(__dirname, 'src/@core'),
      '@menu': path.resolve(__dirname, 'src/@menu'),
      '@layouts': path.resolve(__dirname, 'src/@layouts'),
      '@views': path.resolve(__dirname, 'src/views'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,js}'],

    // Spin a per-run Postgres schema, apply Prisma migrations, drop on exit.
    // Tests that need DB access import `{ prismaTest, truncate }` from
    // src/__tests__/setup/prisma-test.ts. Tests that don't (pure-logic
    // ones like network.test.ts / ipamScan.test.ts) keep working unchanged.
    globalSetup: ['./src/__tests__/setup/postgres.ts'],

    // Tests share a single Postgres schema and reset state via TRUNCATE in
    // beforeEach; running them in parallel makes them step on each other's
    // rows. fileParallelism=false serializes the test files (each file's
    // `it`s still run sequentially within it) and keeps the suite fast
    // enough for the size we have today.
    fileParallelism: false,
  },
})
