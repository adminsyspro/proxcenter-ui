import '@testing-library/jest-dom/vitest'
import { vi, beforeAll, afterEach, afterAll } from 'vitest'
import { server } from './msw-server'

// MUI + DataGrid touch browser APIs jsdom lacks.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ||= RO as any
globalThis.IntersectionObserver ||= RO as any

// Start MSW for the jsdom lane. Unhandled requests error loudly so a missing
// fixture fails the test instead of silently returning empty data.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
