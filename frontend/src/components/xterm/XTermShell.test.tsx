/**
 * Component tests for the node shell terminal.
 *
 * The fullscreen primitives themselves live in lib/console/viewport and are
 * unit-tested there; what is asserted here is the wiring #879 asked for: the
 * control shows up only where the browser can honour it, it targets the shell
 * root rather than the page, and every geometry change is forwarded to
 * termproxy, which never asks for the size on its own.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

const h = vi.hoisted(() => {
  const terminals: any[] = []
  const fitAddons: any[] = []

  class FakeTerminal {
    cols = 80
    rows = 24
    written: string[] = []
    onDataCb: ((d: string) => void) | null = null

    constructor() {
      terminals.push(this)
    }

    loadAddon(addon: any) {
      addon.terminal = this
    }

    open() {}
    clear() {}
    focus() {}
    write(data: string) {
      this.written.push(data)
    }
    onData(cb: (d: string) => void) {
      this.onDataCb = cb
    }
  }

  class FakeFitAddon {
    terminal: FakeTerminal | null = null
    fits = 0

    constructor() {
      fitAddons.push(this)
    }

    // A real fit() measures the box; the test only needs the measurement to
    // change so a stale resend would be visible.
    fit() {
      this.fits += 1
      if (this.terminal) {
        this.terminal.cols = 200
        this.terminal.rows = 50
      }
    }
  }

  return { terminals, fitAddons, FakeTerminal, FakeFitAddon }
})

vi.mock('xterm', () => ({ Terminal: h.FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: h.FakeFitAddon }))
vi.mock('xterm/css/xterm.css', () => ({}))

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = 0
  binaryType = ''
  sent: string[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: unknown) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null

  constructor(
    public url: string,
    public protocols?: string[]
  ) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }

  connected() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({})
  }
}

import XTermShell from './XTermShell'

let fullscreenElement: Element | null = null

beforeEach(() => {
  fullscreenElement = null
  h.terminals.length = 0
  h.fitAddons.length = 0
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)

  // jsdom implements neither side of the Fullscreen API.
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  })
  document.exitFullscreen = vi.fn(() => {
    fullscreenElement = null

    return Promise.resolve()
  })
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    fullscreenElement = this

    return Promise.resolve()
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen
  vi.restoreAllMocks()
})

async function renderShell() {
  renderWithProviders(<XTermShell sessionId="s-1" host="10.42.0.101" />)

  const button = await screen.findByRole('button', { name: 'Fullscreen' })
  const socket = await waitFor(() => {
    const [ws] = FakeWebSocket.instances

    if (!ws) throw new Error('no socket yet')

    return ws
  })

  return { button, socket }
}

describe('XTermShell pop-out control', () => {
  it('opens the standalone shell page in one window per node', async () => {
    const open = vi.fn(() => ({ focus: vi.fn() }))

    vi.stubGlobal('open', open)
    renderWithProviders(<XTermShell sessionId="s-1" connId="c-1" node="pve1" host="10.42.0.101" />)

    const button = await screen.findByRole('button', { name: 'Open in a new window' })

    fireEvent.click(button)

    expect(open).toHaveBeenCalledWith(
      '/xterm/console.html?connId=c-1&node=pve1',
      'shell-c-1-pve1',
      expect.stringContaining('width=1024'),
    )
  })

  it('stays hidden when the caller cannot say which node to reopen', async () => {
    renderWithProviders(<XTermShell sessionId="s-1" host="10.42.0.101" />)

    await screen.findByText('10.42.0.101')

    expect(screen.queryByRole('button', { name: 'Open in a new window' })).toBeNull()
  })
})

describe('XTermShell fullscreen control', () => {
  it('asks the browser for fullscreen on the shell root, not on the page', async () => {
    const { button } = await renderShell()

    fireEvent.click(button)

    expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1)
    expect(fullscreenElement).not.toBeNull()
    // The status bar lives inside the element that went fullscreen, so the way
    // back out stays reachable.
    expect(fullscreenElement).toContainElement(screen.getByText('10.42.0.101'))
  })

  it('offers the way out once the document reports fullscreen', async () => {
    const { button } = await renderShell()

    fireEvent.click(button)
    fireEvent(document, new Event('fullscreenchange'))

    const exit = await screen.findByRole('button', { name: 'Exit fullscreen' })

    fireEvent.click(exit)

    expect(document.exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('hides the control where the browser has no fullscreen API', async () => {
    delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen

    renderWithProviders(<XTermShell sessionId="s-1" host="10.42.0.101" />)

    await screen.findByText('10.42.0.101')

    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
  })

  it('refits and forwards the new geometry to termproxy on a fullscreen change', async () => {
    const { socket } = await renderShell()

    socket.connected()

    // The dimensions the connection itself sends are not what this asserts.
    await waitFor(() => expect(socket.sent).not.toHaveLength(0))
    socket.sent.length = 0
    const before = h.fitAddons[0].fits

    fireEvent(document, new Event('fullscreenchange'))

    await waitFor(() => {
      expect(h.fitAddons[0].fits).toBeGreaterThan(before)
      expect(socket.sent).toEqual(['1:200:50:'])
    })
  })

  it('keeps forwarding geometry when the window itself is resized', async () => {
    const { socket } = await renderShell()

    socket.connected()

    await waitFor(() => expect(socket.sent).not.toHaveLength(0))
    socket.sent.length = 0

    fireEvent(window, new Event('resize'))

    expect(socket.sent).toEqual(['1:200:50:'])
  })
})
