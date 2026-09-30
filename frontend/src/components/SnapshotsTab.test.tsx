import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import SnapshotsTab from './SnapshotsTab'

describe('SnapshotsTab', () => {
  afterEach(cleanup)

  it('fetches the snapshots of the given node on mount', async () => {
    const nodes: (string | null)[] = []
    server.use(
      http.get('*/api/v1/connections/c1/snapshots', ({ request }) => {
        nodes.push(new URL(request.url).searchParams.get('node'))
        return HttpResponse.json({
          data: {
            vmCount: 1,
            snapshots: [{
              vmid: 101, vmName: 'db-01', vmType: 'qemu', vmStatus: 'running', node: 'pve2',
              name: 'before-upgrade', description: 'pre 9.0', snaptime: 1_700_000_000, vmstate: false, parent: null,
            }],
          },
        })
      }),
    )
    renderWithProviders(<SnapshotsTab connectionId="c1" node="pve2" />)

    expect(await screen.findByText('before-upgrade')).toBeInTheDocument()
    expect(screen.getByText('pre 9.0')).toBeInTheDocument()
    await waitFor(() => expect(nodes).toEqual(['pve2']))
  })
})
