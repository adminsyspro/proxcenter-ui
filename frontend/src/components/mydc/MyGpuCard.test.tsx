import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'

import MyGpuCard from './MyGpuCard'

type Json = Record<string, unknown>

const entries = [
  { id: 'e1', kind: 'vgpu', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', fbMemory: 12288, count: 4, used: 2, overCommitted: false },
  { id: 'e2', kind: 'whole', modelName: 'RTX A5000', profileName: '', fbMemory: null, count: 1, used: 0, overCommitted: false },
  { id: 'e3', kind: 'vgpu', modelName: 'RTX A5000', profileName: 'RTXA5000-24Q', fbMemory: 24576, count: 1, used: 1, overCommitted: false },
]

const gpu = (over: Json = {}) => ({
  hostpci: 'hostpci0', kind: 'vgpu', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', entryId: 'e1',
  pendingStart: false, pendingRemoval: false, load: { util: 48, memUtil: 30, fbUsed: 4096, fbTotal: 12288, at: '2026-11-02T10:00:00.000Z' }, licensed: true, ...over,
})

const baseView = () => ({
  entries,
  vms: [
    { vmid: '101', name: 'render-01', status: 'running', gpus: [gpu()] },
    { vmid: '102', name: 'train-02', status: 'stopped', gpus: [gpu({ hostpci: 'hostpci1', load: null, pendingStart: true, licensed: null })] },
  ],
  measured: true,
  generatedAt: '2026-11-02T10:00:00.000Z',
})

const hoursBody = (month: string) => ({
  month,
  totals: { runningHours: 12.5, reservedHours: 40 },
  byVm: [{ vmid: '101', vmName: 'render-01', label: 'RTXA5000-12Q', runningHours: 12.5, reservedHours: 40 }],
  byProfile: [{ label: 'RTXA5000-12Q', runningHours: 12.5, reservedHours: 40 }],
})

const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response)

let view: unknown
let getStatus: number
let candidates: unknown
let postReply: { status: number; body: unknown }
let fetchMock: ReturnType<typeof vi.fn>

const calls = (match: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([u, i]) => match(String(u), i as RequestInit | undefined))
const mainGets = () => calls((u, i) => /\/vdcs\/vdc-1\/gpu$/.test(u) && (!i || !i.method || i.method === 'GET'))
const posts = () => calls((u, i) => /\/vdcs\/vdc-1\/gpu$/.test(u) && i?.method === 'POST')

class FakeObserver {
  static all: FakeObserver[] = []
  disconnected = false
  constructor(public cb: (e: Array<{ isIntersecting: boolean }>) => void) { FakeObserver.all.push(this) }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true }
  emit(isIntersecting: boolean) { this.cb([{ isIntersecting }]) }
}

beforeEach(() => {
  view = baseView()
  getStatus = 200
  candidates = [{ vmid: '101', name: 'render-01', status: 'running' }, { vmid: '103', name: 'web-03', status: 'stopped' }]
  postReply = { status: 200, body: { data: { hostpci: 'hostpci2', pendingStart: false } } }
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (/\/gpu\/candidates$/.test(url)) return reply(200, { data: candidates })
    if (/\/gpu\/hours/.test(url)) return reply(200, { data: hoursBody(new URL(url, 'http://x').searchParams.get('month') ?? '') })
    if (init?.method === 'POST') return reply(postReply.status, postReply.body)
    return getStatus === 200 ? reply(200, { data: view }) : reply(getStatus, { error: 'not_found' })
  })
  vi.stubGlobal('fetch', fetchMock)
  FakeObserver.all = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mount = () => renderWithProviders(<MyGpuCard vdcId="vdc-1" />)

describe('MyGpuCard, visibility', () => {
  it('renders nothing while the GET is pending, then the card on 200', async () => {
    let resolve!: (r: Response) => void
    fetchMock.mockImplementation((url: string) => (/\/gpu\/hours/.test(url)
      ? reply(200, { data: hoursBody('2026-11') })
      : new Promise<Response>((r) => { resolve = r })))
    const { container } = mount()
    await act(async () => { await Promise.resolve() })
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('button', { name: 'Attach a GPU' })).toBeNull()
    await act(async () => { resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: view }) } as Response) })
    expect(await screen.findByRole('button', { name: 'Attach a GPU' })).toBeTruthy()
  })

  it.each([404, 403])('renders nothing when the GET answers %i', async (status) => {
    getStatus = status
    const { container } = mount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(container.firstChild).toBeNull()
  })

  it('shows a discreet error with the i18n message on a 502', async () => {
    fetchMock.mockImplementation(() => reply(502, { error: 'pve_refused' }))
    mount()
    expect(await screen.findByText('The platform refused the request. Try again later or contact your provider.')).toBeTruthy()
  })
})

describe('MyGpuCard, content', () => {
  it('shows one gauge line per contingent entry', async () => {
    mount()
    expect(await screen.findByText('vGPU RTXA5000-12Q · 2 / 4')).toBeTruthy()
    expect(screen.getByText('Whole card RTX A5000 · 0 / 1')).toBeTruthy()
  })

  it('flags an over-committed line', async () => {
    view = { ...baseView(), entries: [{ ...entries[0], used: 5, count: 4, overCommitted: true }] }
    mount()
    expect(await screen.findByText('vGPU RTXA5000-12Q · 5 / 4')).toBeTruthy()
    expect(screen.getByText('Over quota')).toBeTruthy()
  })

  it('shows each VM GPU on one row with load, no measure and pending start', async () => {
    mount()
    expect(await screen.findByText('render-01')).toBeTruthy()
    expect(screen.getByText('train-02')).toBeTruthy()
    expect(screen.getByText('48 %')).toBeTruthy()
    expect(screen.getByText('Not measured')).toBeTruthy()
    expect(screen.getByText('At next start')).toBeTruthy()
    expect(screen.getByText('4 / 12 GB')).toBeTruthy()
  })

  it('keeps the details behind a chevron', async () => {
    mount()
    await screen.findByText('render-01')
    expect(screen.queryByText('hostpci0')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Show details' })[0])
    expect(await screen.findByText('hostpci0')).toBeTruthy()
    expect(screen.getByText('Licensed')).toBeTruthy()
  })

  it('pages the VM list by 10', async () => {
    view = {
      ...baseView(),
      vms: Array.from({ length: 12 }, (_, i) => ({ vmid: String(200 + i), name: `vm-${String(i).padStart(2, '0')}`, status: 'running', gpus: [gpu()] })),
    }
    mount()
    await screen.findByText('vm-00')
    expect(screen.getByText('vm-09')).toBeTruthy()
    expect(screen.queryByText('vm-10')).toBeNull()
    expect(screen.getByText('1-10 of 12')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(await screen.findByText('vm-10')).toBeTruthy()
    expect(screen.queryByText('vm-00')).toBeNull()
  })
})

const openAttach = async () => {
  mount()
  await screen.findByText('render-01')
  fireEvent.click(screen.getByRole('button', { name: 'Attach a GPU' }))
  return await screen.findByRole('dialog')
}

const pick = (dialog: HTMLElement, comboIndex: number, option: RegExp | string) => {
  fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[comboIndex])
  const listbox = screen.getByRole('listbox')
  fireEvent.click(within(listbox).getByText(option))
}

describe('MyGpuCard, attach', () => {
  it('loads the candidates on open and disables a spent line', async () => {
    const dialog = await openAttach()
    await waitFor(() => expect(calls((u) => /\/gpu\/candidates$/.test(u))).toHaveLength(1))
    await waitFor(() => expect(within(dialog).getAllByRole('combobox')[0].getAttribute('aria-disabled')).not.toBe('true'))
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    const spent = within(screen.getByRole('listbox')).getByText('vGPU RTXA5000-24Q · 1 / 1').closest('li')
    expect(spent?.getAttribute('aria-disabled')).toBe('true')
    const free = within(screen.getByRole('listbox')).getByText('vGPU RTXA5000-12Q · 2 / 4').closest('li')
    expect(free?.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('warns when the chosen VM is running', async () => {
    const dialog = await openAttach()
    await waitFor(() => expect(within(dialog).getAllByRole('combobox')[0].getAttribute('aria-disabled')).not.toBe('true'))
    pick(dialog, 0, /render-01/)
    expect(await within(dialog).findByText('This VM is running: the GPU is attached at its next start.')).toBeTruthy()
  })

  it('shows the quota_exhausted message in the dialog and keeps it open', async () => {
    postReply = { status: 409, body: { error: 'quota_exhausted', used: 4, count: 4 } }
    const dialog = await openAttach()
    await waitFor(() => expect(within(dialog).getAllByRole('combobox')[0].getAttribute('aria-disabled')).not.toBe('true'))
    pick(dialog, 0, /web-03/)
    pick(dialog, 1, 'vGPU RTXA5000-12Q · 2 / 4')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Attach' }))
    expect(await within(dialog).findByText('Your contingent is full for this line (4 of 4 used).')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body))).toEqual({ action: 'attach', vmid: '103', entryId: 'e1' })
  })

  it('shows the gpu_check_unavailable message when the contingent cannot be checked', async () => {
    postReply = { status: 503, body: { error: 'gpu_check_unavailable' } }
    const dialog = await openAttach()
    await waitFor(() => expect(within(dialog).getAllByRole('combobox')[0].getAttribute('aria-disabled')).not.toBe('true'))
    pick(dialog, 0, /web-03/)
    pick(dialog, 1, 'vGPU RTXA5000-12Q · 2 / 4')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Attach' }))
    expect(await within(dialog).findByText('Your GPU contingent cannot be checked right now. Try again shortly.')).toBeTruthy()
  })

  it('closes and refreshes after a successful attach', async () => {
    const dialog = await openAttach()
    await waitFor(() => expect(within(dialog).getAllByRole('combobox')[0].getAttribute('aria-disabled')).not.toBe('true'))
    pick(dialog, 0, /web-03/)
    pick(dialog, 1, 'Whole card RTX A5000 · 0 / 1')
    const before = mainGets().length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Attach' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(mainGets().length).toBeGreaterThan(before))
  })
})

describe('MyGpuCard, pending start answer', () => {
  it('keeps the attach dialog open with an info line when the POST says pendingStart', async () => {
    postReply = { status: 200, body: { data: { hostpci: 'hostpci2', pendingStart: true } } }
    const dialog = await openAttach()
    await waitFor(() => expect(within(dialog).getAllByRole('combobox')[0].getAttribute('aria-disabled')).not.toBe('true'))
    pick(dialog, 0, /web-03/)
    pick(dialog, 1, 'Whole card RTX A5000 · 0 / 1')
    const before = mainGets().length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Attach' }))
    expect(await within(dialog).findByText('Done. The GPU is attached once the VM is stopped and started again.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mainGets().length).toBe(before)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(mainGets().length).toBeGreaterThan(before))
  })

  it('keeps the release dialog open with an info line when the POST says pendingStart', async () => {
    postReply = { status: 200, body: { data: { hostpci: 'hostpci0', pendingStart: true } } }
    mount()
    await screen.findByText('render-01')
    fireEvent.click(screen.getAllByRole('button', { name: 'Release' })[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }))
    expect(await within(dialog).findByText('Done. The release takes effect once the VM is stopped and started again.')).toBeTruthy()
    const before = mainGets().length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(mainGets().length).toBeGreaterThan(before))
  })
})

describe('MyGpuCard, pending removal', () => {
  it('shows the chip instead of the release button for a GPU the VM still holds until the next stop', async () => {
    const v = baseView()
    v.vms[0].gpus = [gpu({ pendingRemoval: true })]
    view = v
    mount()
    await screen.findByText('render-01')
    expect(screen.getAllByText('Removed at next stop')).toHaveLength(1)
    // Two GPUs listed, one release button left: the other row's.
    expect(screen.getAllByRole('button', { name: 'Release' })).toHaveLength(1)
  })

  it('keeps the release button on a GPU without pending removal', async () => {
    mount()
    await screen.findByText('render-01')
    expect(screen.queryByText('Removed at next stop')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Release' })).toHaveLength(2)
  })
})

describe('MyGpuCard, release', () => {
  it('asks for confirmation then posts release', async () => {
    mount()
    await screen.findByText('render-01')
    fireEvent.click(screen.getAllByRole('button', { name: 'Release' })[0])
    const dialog = await screen.findByRole('dialog')
    expect(posts()).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body))).toEqual({ action: 'release', vmid: '101', hostpci: 'hostpci0' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows the error code message and stays open on failure', async () => {
    postReply = { status: 404, body: { error: 'vm_not_found' } }
    mount()
    await screen.findByText('render-01')
    fireEvent.click(screen.getAllByRole('button', { name: 'Release' })[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }))
    expect(await within(dialog).findByText('This VM was not found in your datacenter.')).toBeTruthy()
  })
})

describe('MyGpuCard, hours', () => {
  it('loads the current month and reloads when the month changes', async () => {
    mount()
    expect((await screen.findAllByText('12.5 h')).length).toBe(2)
    const first = calls((u) => /\/gpu\/hours\?month=\d{4}-\d{2}$/.test(u))
    expect(first).toHaveLength(1)
    expect(screen.getAllByText('40 h').length).toBe(2)
    const combo = screen.getByRole('combobox', { name: /month/i })
    fireEvent.mouseDown(combo)
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    fireEvent.click(options[1])
    await waitFor(() => expect(calls((u) => /\/gpu\/hours\?month=\d{4}-\d{2}$/.test(u))).toHaveLength(2))
    const months = calls((u) => /\/gpu\/hours/.test(u)).map(([u]) => new URL(String(u), 'http://x').searchParams.get('month'))
    expect(months[0]).not.toBe(months[1])
  })
})

describe('MyGpuCard, hours rows', () => {
  it('pages the hours with a translated label, each row led by the VM glyph of the card', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (/\/gpu\/hours/.test(url)) {
        return reply(200, { data: { ...hoursBody('2026-11'), byVm: Array.from({ length: 12 }, (_, i) => ({ vmid: String(300 + i), vmName: `h-${String(i).padStart(2, '0')}`, label: 'RTXA5000-12Q', runningHours: 1, reservedHours: 2 })) } })
      }
      if (!init?.method) return reply(getStatus, getStatus === 200 ? { data: view } : { error: 'not_found' })
      return reply(500, {})
    })
    mount()
    const row = (await screen.findByText('h-00')).closest('tr') as HTMLElement
    expect(screen.getByText('1-10 of 12')).toBeTruthy()
    const cardIcon = (await screen.findByText('render-01')).closest('[class*="MuiStack"]')?.querySelector('i')
    expect(cardIcon?.className).toBeTruthy()
    expect(row.querySelector('i')?.className).toBe(cardIcon?.className)
  })
})

describe('MyGpuCard, refresh', () => {
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

  it('reloads when the tab becomes visible again', async () => {
    mount()
    await screen.findByText('render-01')
    const before = mainGets().length
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(mainGets().length).toBe(before + 1))
  })

  it('reloads with the refresh button', async () => {
    mount()
    await screen.findByText('render-01')
    const before = mainGets().length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mainGets().length).toBe(before + 1))
  })

  it('polls every 30 s only while the card is in view and the tab visible', async () => {
    vi.useFakeTimers()
    mount()
    await flush()
    expect(screen.getAllByText('render-01').length).toBeGreaterThan(0)
    const io = FakeObserver.all[FakeObserver.all.length - 1]
    const start = mainGets().length

    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    expect(mainGets().length).toBe(start)

    await act(async () => { io.emit(true) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(mainGets().length).toBe(start + 1)

    await act(async () => { io.emit(false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
    expect(mainGets().length).toBe(start + 1)

    await act(async () => { io.emit(true) })
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
    expect(mainGets().length).toBe(start + 1)
    hidden.mockRestore()
  })

  it('stops the timers and observers on unmount', async () => {
    vi.useFakeTimers()
    const { unmount } = mount()
    await flush()
    const io = FakeObserver.all[FakeObserver.all.length - 1]
    await act(async () => { io.emit(true) })
    const before = mainGets().length
    unmount()
    expect(FakeObserver.all.every((o) => o.disconnected)).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mainGets().length).toBe(before)
  })
})
