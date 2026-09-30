import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ConsoleUI from './viewport'

const html = readFileSync('public/novnc/console.html', 'utf8')
let dom: JSDOM
async function boot(sessionResponder?: () => Promise<any>) {
  dom = new JSDOM(html, { url: 'http://localhost:3040/novnc/console.html?connId=c1&type=qemu&node=pve2&vmid=100', runScripts: 'outside-only' })
  const w = dom.window
  const consoles: EventTarget[] = []
  class RFB extends w.EventTarget {
    constructor() { super(); consoles.push(this as any) }
    disconnect() { this.dispatchEvent(new w.CustomEvent('disconnect', { detail: {} })) }
  }
  Object.assign(w, { ConsoleUI, RFB, console: { log() {}, error() {} } })
  const fetch = vi.fn(async (url: string) => url.endsWith('/status')
    ? { ok: true, json: async () => ({ data: { status: 'running' } }) }
    : sessionResponder ? sessionResponder() : { ok: false, status: 500, text: async () => 'primary unavailable' })
  Object.assign(w, { fetch, setTimeout, clearTimeout })
  await new Promise(resolve => w.addEventListener('load', resolve))
  const script = Array.from(w.document.scripts).find(s => s.textContent?.includes('function loadNoVNC'))!.textContent!
  w.eval(script)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  return { w, fetch, consoles, attempts: () => fetch.mock.calls.filter(([url]) => url.endsWith('/console')).length }
}
afterEach(() => { dom?.window.close(); vi.useRealTimers() })

describe('console page reconnection', () => {
  it('retries failed session creation, stops after five retries, and allows a manual restart', async () => {
    vi.useFakeTimers()
    const { w, attempts } = await boot()
    await vi.advanceTimersByTimeAsync(0)
    expect(attempts()).toBe(1)
    for (const delay of [2000, 4000, 8000, 16000, 30000]) await vi.advanceTimersByTimeAsync(delay)
    expect(attempts()).toBe(6)
    await vi.advanceTimersByTimeAsync(120000)
    expect(attempts()).toBe(6)
    expect(w.document.getElementById('loading-text')!.textContent).toBe('Connection lost')
    w.document.getElementById('btn-reconnect')!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(attempts()).toBe(7)
    await vi.advanceTimersByTimeAsync(2000)
    expect(attempts()).toBe(8)
  })

  it('cancels retry when the user closes the console', async () => {
    vi.useFakeTimers()
    const { w, attempts } = await boot()
    w.close = vi.fn()
    w.document.getElementById('btn-close')!.click()
    await vi.advanceTimersByTimeAsync(120000)
    expect(attempts()).toBe(1)
  })
})


describe('console recovery races', () => {
  it('keeps retrying after an established console loses its session endpoint', async () => {
    vi.useFakeTimers()
    let available = true
    const { w, attempts, consoles } = await boot(async () => available
      ? { ok: true, json: async () => ({ data: { wsUrl: '/ws/console/test', password: 'ticket' } }) }
      : { ok: false, status: 500, text: async () => 'unavailable' })
    await vi.advanceTimersByTimeAsync(0)
    consoles[0].dispatchEvent(new w.Event('connect'))
    available = false
    consoles[0].dispatchEvent(new w.CustomEvent('disconnect', { detail: {} }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(attempts()).toBe(2)
    available = true
    await vi.advanceTimersByTimeAsync(4000)
    expect(attempts()).toBe(3)
    consoles[1].dispatchEvent(new w.Event('connect'))
    // Late events from the discarded socket must not start another retry.
    consoles[0].dispatchEvent(new w.CustomEvent('disconnect', { detail: {} }))
    await vi.advanceTimersByTimeAsync(60000)
    expect(attempts()).toBe(3)
    expect(w.document.getElementById('status-text')!.textContent).toBe('• Connected')
  })

  it('does not open a socket if the user closes while session creation is in flight', async () => {
    vi.useFakeTimers()
    let finish!: (value: any) => void
    const { w, consoles, attempts } = await boot(() => new Promise(resolve => { finish = resolve }))
    w.close = vi.fn()
    w.document.getElementById('btn-close')!.click()
    finish({ ok: true, json: async () => ({ data: { wsUrl: '/ws/console/test', password: 'ticket' } }) })
    await vi.advanceTimersByTimeAsync(60000)
    expect(consoles).toHaveLength(0)
    expect(attempts()).toBe(1)
  })
})


it('starts a fresh retry budget after starting a VM from an exhausted console', async () => {
  vi.useFakeTimers()
  const { w, attempts, fetch } = await boot()
  await vi.advanceTimersByTimeAsync(60000)
  expect(attempts()).toBe(6)
  fetch.mockImplementation(async (url: string) => url.endsWith('/console')
    ? { ok: false, status: 500, text: async () => 'starting' } as any
    : { ok: true, json: async () => ({ data: { status: 'running' } }) } as any)
  await w.eval("vmAction('start')")
  await vi.advanceTimersByTimeAsync(3000)
  expect(attempts()).toBe(7)
  await vi.advanceTimersByTimeAsync(2000)
  expect(attempts()).toBe(8)
})


it('cancels pending backoff when VM start triggers a new connection', async () => {
  vi.useFakeTimers()
  const { w, attempts, fetch, consoles } = await boot()
  // The first retry fails at t=2s and schedules another at t=6s.
  await vi.advanceTimersByTimeAsync(2000)
  expect(attempts()).toBe(2)
  fetch.mockImplementation(async (url: string) => url.endsWith('/console')
    ? { ok: true, json: async () => ({ data: { wsUrl: '/ws/console/test', password: 'ticket' } }) } as any
    : { ok: true, json: async () => ({ data: { status: 'running' } }) } as any)
  await w.eval("vmAction('start')")
  await vi.advanceTimersByTimeAsync(3000)
  expect(attempts()).toBe(3)
  // Keep the handshake pending past the old deadline: the connect event
  // must not be what cancels that old timer.
  await vi.advanceTimersByTimeAsync(2000)
  expect(attempts()).toBe(3)
  expect(consoles).toHaveLength(1)
  consoles[0].dispatchEvent(new w.Event('connect'))
  expect(w.document.getElementById('status-text')!.textContent).toBe('• Connected')
})

it('shows disconnected when the browser refuses to close the window', async () => {
  vi.useFakeTimers()
  const { w, attempts, consoles } = await boot(async () => ({
    ok: true, json: async () => ({ data: { wsUrl: '/ws/console/test', password: 'ticket' } }),
  }))
  await vi.advanceTimersByTimeAsync(0)
  consoles[0].dispatchEvent(new w.Event('connect'))
  w.close = vi.fn()
  w.document.getElementById('btn-close')!.click()
  expect(w.document.getElementById('status-text')!.textContent).toBe('• Disconnected')
  expect(w.document.getElementById('loading-text')!.textContent).toBe('Disconnected')
  await vi.advanceTimersByTimeAsync(60000)
  expect(attempts()).toBe(1)
})
