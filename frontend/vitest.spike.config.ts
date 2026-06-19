import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spike.test.tsx'],
    setupFiles: ['./src/__tests__/setup/jsdom-setup.ts'],
    coverage: {
      provider: 'v8', // spike validates whether v8 attribution is acceptable
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage-spike',
      include: ['src/**/*.tsx'],
    },
  },
})
