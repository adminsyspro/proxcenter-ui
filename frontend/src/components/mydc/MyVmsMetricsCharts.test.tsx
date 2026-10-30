import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

const fetchRrdBatch = vi.fn()

vi.mock('@/app/(dashboard)/infrastructure/inventory/helpers', () => ({
  fetchRrdBatch: (...args: unknown[]) => fetchRrdBatch(...args),
}))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/components/ChartContainer', () => ({ default: () => <div data-testid="chart" /> }))

import MyVmsMetricsCharts from './MyVmsMetricsCharts'

class FakeEventSource {
  static last: FakeEventSource | null = null
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {}
  closed = false
  constructor(public url: string) { FakeEventSource.last = this }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn) }
  removeEventListener(type: string, fn: (ev: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn) }
  close() { this.closed = true }
  emit(type: string, data?: unknown) { for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) } as MessageEvent) }
}

const cluster = (id: string, guests: Array<{ vmid: number; name: string; template?: boolean }>) =>
  ({ id, nodes: [{ node: 'pve1', guests: guests.map(g => ({ type: 'qemu', status: 'running', ...g })) }] })

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('MyVmsMetricsCharts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchRrdBatch.mockReset()
    fetchRrdBatch.mockImplementation(async (_c: string, paths: string[]) => new Map(paths.map(p => [p, [{ time: 60, cpu: 0.2 }]])))
    vi.stubGlobal('EventSource', FakeEventSource)
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the RRD once the stream is done, one batch per connection of the vDC', async () => {
    render(<MyVmsMetricsCharts connectionIds={['c1', 'c2']} />)
    const src = FakeEventSource.last!

    act(() => {
      src.emit('cluster', cluster('c1', [{ vmid: 100, name: 'web' }, { vmid: 9000, name: 'tpl', template: true }]))
      src.emit('cluster', cluster('c2', [{ vmid: 200, name: 'app' }]))
      src.emit('cluster', cluster('other', [{ vmid: 300, name: 'foreign' }]))
    })
    expect(fetchRrdBatch).not.toHaveBeenCalled()

    act(() => src.emit('done'))
    await flush()

    expect(src.closed).toBe(true)
    expect(fetchRrdBatch).toHaveBeenCalledTimes(2)
    expect(fetchRrdBatch).toHaveBeenCalledWith('c1', ['/nodes/pve1/qemu/100'], 'hour', expect.any(AbortSignal))
    expect(fetchRrdBatch).toHaveBeenCalledWith('c2', ['/nodes/pve1/qemu/200'], 'hour', expect.any(AbortSignal))
    expect(screen.getAllByTestId('chart')).toHaveLength(4)
    expect(screen.getAllByText('2 VMs')).toHaveLength(4)
  })

  it('refreshes every minute while the tab is visible and not while it is hidden', async () => {
    render(<MyVmsMetricsCharts connectionIds={['c1']} />)
    act(() => {
      FakeEventSource.last!.emit('cluster', cluster('c1', [{ vmid: 100, name: 'web' }]))
      FakeEventSource.last!.emit('done')
    })
    await flush()
    expect(fetchRrdBatch).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(fetchRrdBatch).toHaveBeenCalledTimes(2)

    act(() => setVisibility('hidden'))
    await act(async () => { vi.advanceTimersByTime(180_000) })
    expect(fetchRrdBatch).toHaveBeenCalledTimes(2)

    act(() => setVisibility('visible'))
    await flush()
    expect(fetchRrdBatch).toHaveBeenCalledTimes(3)
  })

  it('charts the clusters an interrupted stream sent', async () => {
    render(<MyVmsMetricsCharts connectionIds={['c1']} />)
    act(() => {
      FakeEventSource.last!.emit('cluster', cluster('c1', [{ vmid: 100, name: 'web' }]))
      FakeEventSource.last!.emit('error')
    })
    await flush()

    expect(fetchRrdBatch).toHaveBeenCalledWith('c1', ['/nodes/pve1/qemu/100'], 'hour', expect.any(AbortSignal))
    expect(screen.getAllByText('1 VM')).toHaveLength(4)
  })

  it('drops the answer of a refresh another one replaced', async () => {
    let answerFirst: (m: Map<string, any[]>) => void = () => {}
    fetchRrdBatch.mockImplementationOnce(() => new Promise(resolve => { answerFirst = resolve }))
    render(<MyVmsMetricsCharts connectionIds={['c1']} />)
    act(() => {
      FakeEventSource.last!.emit('cluster', cluster('c1', [{ vmid: 100, name: 'web' }]))
      FakeEventSource.last!.emit('done')
    })
    await flush()

    act(() => setVisibility('hidden'))
    act(() => setVisibility('visible'))
    await flush()
    expect(fetchRrdBatch).toHaveBeenCalledTimes(2)
    expect(fetchRrdBatch.mock.calls[0][3].aborted).toBe(true)

    await act(async () => { answerFirst(new Map()) })
    expect(screen.getAllByText('1 VM')).toHaveLength(4)
  })

  it('opens no stream and sends nothing without a connection', async () => {
    FakeEventSource.last = null
    render(<MyVmsMetricsCharts connectionIds={[]} />)
    await flush()

    expect(FakeEventSource.last).toBeNull()
    expect(fetchRrdBatch).not.toHaveBeenCalled()
    expect(screen.getAllByText('myVdc.metrics.noData')).toHaveLength(4)
  })
})
