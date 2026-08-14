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

// Node 24+ ships its own localStorage global, inert unless the process was
// started with --localstorage-file. On that Node, the jsdom environment comes
// up WITHOUT a usable window.localStorage (sessionStorage survives), so any
// `localStorage.getItem(...)` throws on undefined. Browsers have no such split,
// so this is a harness gap rather than product behaviour, and the product code
// under test is what a browser would run. Supply a real in-memory Storage when
// the environment did not.
class MemoryStorage implements Storage {
  #items = new Map<string, string>()
  get length() { return this.#items.size }
  key(i: number) { return [...this.#items.keys()][i] ?? null }
  getItem(k: string) { return this.#items.get(String(k)) ?? null }
  setItem(k: string, v: string) { this.#items.set(String(k), String(v)) }
  removeItem(k: string) { this.#items.delete(String(k)) }
  clear() { this.#items.clear() }
  [key: string]: any
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  const existing = (() => { try { return window[name] } catch { return undefined } })()
  const storage = existing ?? new MemoryStorage()
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, name, { value: storage, configurable: true, writable: true })
  }
}

// Start MSW for the jsdom lane. Unhandled requests error loudly so a missing
// fixture fails the test instead of silently returning empty data.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
