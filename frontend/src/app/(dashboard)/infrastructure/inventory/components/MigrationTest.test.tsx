/**
 * The test of a waiting warm migration, from the migrate dialog: the button,
 * the settings dialog and the banner shown while the test runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { HttpResponse, http, server } from '@/__tests__/setup/msw-server'

import MigrationTestBanner, { formatTestClock, formatTestDuration } from './MigrationTestBanner'
import MigrationTestButton from './MigrationTestButton'

const GiB = 1024 ** 3
const waiting = {
  id: 'j1', status: 'delta_sync', sourceVmName: 'r9-i1000', targetConnectionId: 'tc', targetNode: 'pve1',
  config: { cutoverMode: 'manual', migrationType: 'warm' },
}
const OPTIONS = {
  state: null,
  storages: [{ id: 'Dir-Images', type: 'dir', availBytes: 27 * GiB }, { id: 'nfs-test', type: 'nfs', availBytes: 900 * GiB }],
  bridges: ['vmbr0', 'vmbr9'],
  nodeAvailableMemoryMB: 12800,
  maxSecChoices: [3600, 7200, 14400, 28800, 86400],
  maxSecDefault: 14400,
}

let posted: any[]

beforeEach(() => {
  posted = []
  server.use(
    http.get('*/api/v1/migrations/:id/test', () => HttpResponse.json({ data: OPTIONS })),
    http.post('*/api/v1/migrations/:id/test', async ({ request }) => {
      posted.push(await request.json())
      return HttpResponse.json({ data: { status: 'test_requested' } })
    }),
  )
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** The MUI select of a labelled line of the dialog. */
const selectOf = (label: string) => within(screen.getByTestId(`test-line-${label}`)).getByRole('combobox')

describe('MigrationTestButton', () => {
  it('shows only on a migration waiting for its manual cutover, with no test running', () => {
    const { unmount } = renderWithProviders(<MigrationTestButton job={waiting} />)
    expect(screen.getByRole('button', { name: 'Test migration' })).toBeInTheDocument()
    unmount()
    renderWithProviders(<MigrationTestButton job={{ ...waiting, testState: { phase: 'running', testVmid: 9001 } }} />)
    expect(screen.queryByRole('button', { name: 'Test migration' })).not.toBeInTheDocument()
  })

  it('hides on an automatic cutover', () => {
    renderWithProviders(<MigrationTestButton job={{ ...waiting, config: { cutoverMode: 'auto', migrationType: 'warm' } }} />)
    expect(screen.queryByRole('button', { name: 'Test migration' })).not.toBeInTheDocument()
  })
})

describe('MigrationTestDialog', () => {
  const open = async () => {
    renderWithProviders(<MigrationTestButton job={waiting} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test migration' }))
    expect(await screen.findByText('Test migration - r9-i1000')).toBeInTheDocument()
    await waitFor(() => expect(selectOf('storage')).toHaveTextContent('Dir-Images'))
  }

  it('starts on no network and a 4 h limit, says what it does and how much RAM the node has', async () => {
    await open()
    expect(selectOf('network')).toHaveTextContent('No network')
    expect(selectOf('stop')).toHaveTextContent('after 4 h')
    expect(screen.queryByTestId('test-line-vlan')).not.toBeInTheDocument()
    expect(screen.getByText('Syncs pause during the test. The source and the replicated copy are not touched. pve1: 12.5 GiB RAM free.')).toBeInTheDocument()
    expect(screen.queryByText(/keeps the MAC address/)).not.toBeInTheDocument()
  })

  it('posts what the operator chose', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }))
    await waitFor(() => expect(posted).toEqual([{ storage: 'Dir-Images', bridge: null, vlanTag: null, maxSec: 14400 }]))
  })

  it('offers a VLAN tag and warns about the MAC address once a bridge is chosen', async () => {
    await open()
    fireEvent.mouseDown(selectOf('network'))
    fireEvent.click(await screen.findByRole('option', { name: 'vmbr9' }))
    expect(await screen.findByTestId('test-line-vlan')).toBeInTheDocument()
    expect(screen.getByText('The test VM keeps the MAC address and IP configuration of the source: use an isolated bridge or VLAN.')).toBeInTheDocument()
    fireEvent.change(within(screen.getByTestId('test-line-vlan')).getByRole('spinbutton'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }))
    await waitFor(() => expect(posted).toEqual([{ storage: 'Dir-Images', bridge: 'vmbr9', vlanTag: 30, maxSec: 14400 }]))
  })

  it('keeps the dialog open with the reason when the route refuses', async () => {
    server.use(http.post('*/api/v1/migrations/:id/test', () => HttpResponse.json({ error: 'A test is already running for this migration' }, { status: 409 })))
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }))
    expect(await screen.findByText('A test is already running for this migration')).toBeInTheDocument()
    expect(screen.getByText('Test migration - r9-i1000')).toBeInTheDocument()
  })

  it('says where to add a storage when the node has none for the test', async () => {
    server.use(http.get('*/api/v1/migrations/:id/test', () => HttpResponse.json({ data: { ...OPTIONS, storages: [] } })))
    renderWithProviders(<MigrationTestButton job={waiting} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test migration' }))
    expect(await screen.findByText(/No file storage holding VM disks on pve1/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start test' })).toBeDisabled()
  })
})

describe('MigrationTestBanner', () => {
  const now = Date.parse('2026-11-15T10:12:00Z')
  const running = {
    ...waiting,
    testState: { phase: 'running', testVmid: 9001, startedAt: '2026-11-15T10:00:00Z', endsAt: '2026-11-15T14:00:00Z', overlayBytes: 577 * 1048576 },
  }

  it('says which VM the test runs and how big its overlays are, with a bar up to its automatic stop', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    renderWithProviders(<MigrationTestBanner job={running} />)
    expect(screen.getByText('Test running · VM 9001 · overlay 577 MiB')).toBeInTheDocument()
    expect(screen.getByText('12 min / 4 h')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Test running · VM 9001 · overlay 577 MiB' })).toHaveAttribute('aria-valuenow', '5')
  })

  it('shows the screen of the test VM, refreshed from its screenshot', async () => {
    const shots: string[] = []
    server.use(http.get('*/api/v1/connections/:id/guests/:type/:node/:vmid/screenshot', ({ params }) => {
      shots.push(`${params.id}/${params.type}/${params.node}/${params.vmid}`)
      return new HttpResponse(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } })
    }))
    const created = vi.fn(() => 'blob:screen')
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() })
    renderWithProviders(<MigrationTestBanner job={running} />)
    expect(await screen.findByAltText('VM screen')).toHaveAttribute('src', 'blob:screen')
    expect([...new Set(shots)]).toEqual(['tc/qemu/pve1/9001'])
  })

  it('shows no screen before the test VM runs', () => {
    renderWithProviders(<MigrationTestBanner job={{ ...waiting, testState: { phase: 'preparing', step: 'checks' } }} />)
    expect(screen.queryByTestId('migration-test-screen')).not.toBeInTheDocument()
  })

  it('opens the console of the test VM', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderWithProviders(<MigrationTestBanner job={running} />)
    fireEvent.click(screen.getByRole('button', { name: 'Console' }))
    expect(open).toHaveBeenCalledWith('/novnc/console.html?connId=tc&type=qemu&node=pve1&vmid=9001', 'console-9001', expect.any(String))
  })

  it('asks the engine to stop the test', async () => {
    const calls: string[] = []
    server.use(http.delete('*/api/v1/migrations/:id/test', ({ params }) => { calls.push(String(params.id)); return HttpResponse.json({ data: { status: 'test_stop_requested' } }) }))
    renderWithProviders(<MigrationTestBanner job={running} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop test' }))
    await waitFor(() => expect(calls).toEqual(['j1']))
  })

  it('says which step of the preparation runs and for how long, with a moving bar', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    renderWithProviders(<MigrationTestBanner job={{ ...waiting, testState: { phase: 'preparing', step: 'conversion', preparingSince: '2026-11-15T10:10:45Z' } }} />)
    expect(screen.getByText('Preparing the test, step 2/3: guest conversion')).toBeInTheDocument()
    expect(screen.getByText('1:15')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByRole('button', { name: 'Console' })).not.toBeInTheDocument()
  })

  it('counts the preparation time up every second', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(now)
    try {
      renderWithProviders(<MigrationTestBanner job={{ ...waiting, testState: { phase: 'preparing', step: 'checks', preparingSince: '2026-11-15T10:11:58Z' } }} />)
      expect(screen.getByText('0:02')).toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(screen.getByText('0:05')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says a requested test waits for the sync in progress', () => {
    renderWithProviders(<MigrationTestBanner job={{ ...waiting, testRequest: { storage: 'Dir-Images' }, testState: { phase: 'requested' } }} />)
    expect(screen.getByText('Test requested: it starts after the sync in progress')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('shows nothing once the test ended, or on a migration that is over', () => {
    const { container, unmount } = renderWithProviders(<MigrationTestBanner job={{ ...waiting, testState: { phase: 'ended' } }} />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    const r = renderWithProviders(<MigrationTestBanner job={{ ...running, status: 'cancelled' }} />)
    expect(r.container).toBeEmptyDOMElement()
  })

  it('writes the preparation time as a clock', () => {
    expect(formatTestClock(5)).toBe('0:05')
    expect(formatTestClock(75)).toBe('1:15')
    expect(formatTestClock(-3)).toBe('0:00')
  })

  it('writes durations in minutes, then hours', () => {
    expect(formatTestDuration(42)).toBe('1 min')
    expect(formatTestDuration(12 * 60)).toBe('12 min')
    expect(formatTestDuration(4 * 3600)).toBe('4 h')
    expect(formatTestDuration(3600 + 5 * 60)).toBe('1 h 05 min')
  })
})
