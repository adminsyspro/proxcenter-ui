import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

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
