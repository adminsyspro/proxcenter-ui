/**
 * Vitest config for pure unit tests that have no Postgres / Prisma dependency.
 * Run with: npx vitest run --config vitest.unit.config.ts <file>
 *
 * Does NOT include the postgres globalSetup so these tests work without a DB.
 */
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

    // No globalSetup — pure logic tests only, no DB access.
  },
})
