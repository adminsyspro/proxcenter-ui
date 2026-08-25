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
      '/api/v1/orchestrator/replication/snapshots',
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
