import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, within, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import SnapshotsTab from './SnapshotsTab'

// MUI refuses to attach hover listeners to a disabled <button> passed directly
// as a Tooltip child (it logs "You are providing a disabled button child to the
// Tooltip component" and the tooltip never opens). The cleanup-orphans button
// is therefore wrapped in a <span>: these tests hover that wrapper and assert
// the hint still appears, both while the button is enabled and while it is
// disabled by an in-flight deletion.

const CONNECTIONS = [{ id: 'c1', name: 'Cluster A' }]

const SNAPSHOTS = [
  {
    cluster_id: 'c1',
    cluster_name: 'Cluster A',
    pool: 'rbd',
    image: 'vm-100-disk-0',
    snapshot: 'mirror.orphan-1',
    provisioned_bytes: 1024 * 1024 * 1024,
    created_ts: Math.floor(Date.now() / 1000) - 3600,
    created_iso: new Date(Date.now() - 3600_000).toISOString(),
    vmid: 100,
    is_orphan: true,
  },
  {
    cluster_id: 'c1',
    cluster_name: 'Cluster A',
    pool: 'rbd',
    image: 'vm-101-disk-0',
    snapshot: 'mirror.active-1',
    provisioned_bytes: 2 * 1024 * 1024 * 1024,
    created_ts: Math.floor(Date.now() / 1000) - 60,
    created_iso: new Date(Date.now() - 60_000).toISOString(),
    vmid: 101,
    job_id: 'job-1',
    is_orphan: false,
    side: 'source',
  },
]

const JSON_HEADERS = { 'content-type': 'application/json' }

const CLEANUP_LABEL = 'Clean up 1 orphans'
const CLEANUP_HINT = 'Remove mirror snapshots that no longer belong to any active replication job'

// GET returns the fixture; POST (the per-snapshot deletion) either resolves or
// hangs forever so `deleting` stays true for the duration of the test.
function stubFetch({ hangDelete = false } = {}) {
  const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (hangDelete) return new Promise<Response>(() => {})

      return Promise.resolve(new Response(JSON.stringify({ deleted: 1, failed: [] }), { status: 200, headers: JSON_HEADERS }))
    }

    return Promise.resolve(new Response(JSON.stringify(SNAPSHOTS), { status: 200, headers: JSON_HEADERS }))
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SnapshotsTab cleanup-orphans tooltip', () => {
  it('shows the cleanup hint on hover while the button is enabled', async () => {
    stubFetch()

    renderWithProviders(<SnapshotsTab connections={CONNECTIONS} />)

    const button = await screen.findByRole('button', { name: CLEANUP_LABEL })

    expect(button).toBeEnabled()

    // The Tooltip's listeners live on the <span> wrapper, not on the button.
    fireEvent.mouseOver(button.parentElement!)

    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent(CLEANUP_HINT)
  })

  it('still shows the cleanup hint on hover while a deletion is in flight and the button is disabled', async () => {
    const fetchMock = stubFetch({ hangDelete: true })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWithProviders(<SnapshotsTab connections={CONNECTIONS} />)

    const button = await screen.findByRole('button', { name: CLEANUP_LABEL })

    expect(button).toBeEnabled()

    // Open the confirm dialog and confirm: runDelete() flips `deleting` to
    // true before awaiting the POST, which never resolves here.
    fireEvent.click(button)

    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveTextContent('Delete mirror snapshots')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(button).toBeDisabled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/orchestrator/replication/snapshots/delete',
      expect.objectContaining({ method: 'POST' })
    )

    // Regression: a disabled button is inert for MUI's hover listeners, so the
    // tooltip must be driven by the wrapping <span>.
    fireEvent.mouseOver(button.parentElement!)

    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent(CLEANUP_HINT)

    // MUI logs this exact warning when a disabled button is a Tooltip's direct
    // child. The <span> wrapper is what keeps it away.
    const logged = errorSpy.mock.calls.map(call => call.map(String).join(' ')).join('\n')

    expect(logged).not.toMatch(/disabled button child to the Tooltip/)
  })
})

const sameVolumeSnapshots = [
  { ...SNAPSHOTS[0], storage_engine: 'zfs', node: 'dr1', used: 1024 },
  { ...SNAPSHOTS[0], storage_engine: 'zfs', node: 'dr2', used: 2048 },
  { ...SNAPSHOTS[0], storage_engine: 'rbd', node: '' },
  { ...SNAPSHOTS[0], cluster_id: 'c2', storage_engine: 'zfs', node: 'dr1', used: 0 },
]

it('keeps otherwise identical snapshots on distinct nodes, engines and connections independently selectable and deletes full identities', async () => {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { deleted: [], failed: [] } : sameVolumeSnapshots)))
  vi.stubGlobal('fetch', fetchMock)
  renderWithProviders(<SnapshotsTab connections={CONNECTIONS} />)
  await screen.findByRole('columnheader', { name: 'Engine' })
  expect(screen.getByRole('columnheader', { name: 'Node' })).toBeInTheDocument()
  expect(screen.getAllByRole('img', { name: 'ZFS' })).toHaveLength(3)
  expect(screen.getByRole('img', { name: 'Ceph RBD' })).toBeInTheDocument()
  expect(screen.getByText('0 B')).toBeInTheDocument()
  const rows = screen.getAllByRole('row').slice(1)
  fireEvent.click(within(rows[0]).getByRole('checkbox'))
  expect(within(rows[1]).getByRole('checkbox')).not.toBeChecked()
  expect(within(rows[2]).getByRole('checkbox')).not.toBeChecked()
  expect(within(rows[3]).getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(within(rows[1]).getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(2))
  const bodies = fetchMock.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(String(call[1]?.body)))
  expect(bodies).toEqual(['dr1', 'dr2'].map(node => ({ items: [{ cluster_id: 'c1', storage_engine: 'zfs', node, pool: 'rbd', image: 'vm-100-disk-0', snapshot: 'mirror.orphan-1' }] })))
})

it('loads usage for the selected node and displays ZFS used bytes', async () => {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).includes('/usage?') ? { used: 4096 } : sameVolumeSnapshots)))
  vi.stubGlobal('fetch', fetchMock)
  renderWithProviders(<SnapshotsTab connections={CONNECTIONS} />)
  await screen.findByText('dr2')
  const row = screen.getAllByRole('row')[2]
  fireEvent.click(within(row).getByRole('button', { name: 'View details' }))
  await screen.findByText('4.0 KB')
  const call = fetchMock.mock.calls.find(call => String(call[0]).includes('/usage?'))
  const query = new URL(String(call?.[0]), 'http://localhost').searchParams
  expect(Object.fromEntries(query)).toEqual({ cluster: 'c1', storage_engine: 'zfs', node: 'dr2', pool: 'rbd', image: 'vm-100-disk-0', snap: 'mirror.orphan-1' })
  expect(screen.getByText('Node: dr2')).toBeInTheDocument()
})
