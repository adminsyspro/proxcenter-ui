/**
 * Component tests for MigrateVmDialog.tsx — HA resource affinity pre-check (#674).
 *
 * Strategy: render the dialog open on the Local migration tab, seed every MSW
 * endpoint fired on open (nodes, VM config, storages, HA), then assert the
 * affinity-conflict UI: node badge, alert severity, Migrate button gating,
 * recommended-node star placement, positive-affinity notice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import { MigrateVmDialog } from './MigrateVmDialog'

const { useLicenseMock } = vi.hoisted(() => ({ useLicenseMock: vi.fn() }))
vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => useLicenseMock(),
  Features: { CROSS_CLUSTER_MIGRATION: 'cross_cluster_migration' },
}))

const CONN_ID = 'conn-1'
const CURRENT_NODE = 'pve1'
const VMID = '100'

// pve2 scores far better than pve3 (cpuFree*0.4 + memFree*0.6), so the dialog
// auto-selects pve2 on load — which is exactly where the conflicting peer runs.
const nodesFixture = [
  { node: 'pve1', status: 'online', cpu: 0.1, maxcpu: 16, mem: 20e9, maxmem: 100e9 },
  { node: 'pve2', status: 'online', cpu: 0.05, maxcpu: 16, mem: 10e9, maxmem: 100e9 },
  { node: 'pve3', status: 'online', cpu: 0.6, maxcpu: 16, mem: 80e9, maxmem: 100e9 },
]

const sharedStorages = [
  { storage: 'ceph', type: 'rbd', shared: 1, content: 'images,rootdir', avail: 1e12, total: 2e12 },
]

const haStatus = (peerState: string) => [
  { id: 'quorum', type: 'quorum', node: 'pve1' },
  { id: 'service:vm:100', type: 'service', sid: 'vm:100', node: 'pve1', state: 'started' },
  { id: 'service:vm:200', type: 'service', sid: 'vm:200', node: 'pve2', state: peerState },
  { id: 'service:ct:300', type: 'service', sid: 'ct:300', node: 'pve3', state: 'started' },
]

const negativeRule = { rule: 'keep-apart', type: 'resource-affinity', affinity: 'negative', resources: 'vm:100,vm:200' }
const positiveRule = { rule: 'keep-together', type: 'resource-affinity', affinity: 'positive', resources: 'vm:100,ct:300' }

function seedHandlers({
  haResources = [{ sid: 'vm:100', state: 'started' }, { sid: 'vm:200', state: 'started' }],
  rules = [] as any[],
  status = [] as any[],
} = {}) {
  server.use(
    http.get(`*/api/v1/connections/${CONN_ID}/nodes`, () =>
      HttpResponse.json({ data: nodesFixture }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/guests/qemu/${CURRENT_NODE}/${VMID}/config`, () =>
      HttpResponse.json({ data: { scsi0: 'ceph:vm-100-disk-0,size=10G', cpu: 'x86-64-v2-AES' } }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/:node/storages`, () =>
      HttpResponse.json({ data: sharedStorages }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/ha`, () =>
      HttpResponse.json({
        data: {
          resources: haResources,
          groups: [],
          rules,
          status,
          pveVersion: '9.0.3',
          majorVersion: 9,
          rulesSupported: true,
        },
      }),
    ),
  )
}

function makeProps() {
  return {
    open: true,
    onClose: vi.fn(),
    onMigrate: vi.fn().mockResolvedValue(undefined),
    connId: CONN_ID,
    currentNode: CURRENT_NODE,
    vmName: 'web',
    vmid: VMID,
    vmStatus: 'running',
    vmType: 'qemu' as const,
    isCluster: true,
  }
}

async function waitForNodesLoaded() {
  await screen.findByText('pve2')
  await screen.findByText('pve3')
}

beforeEach(() => {
  useLicenseMock.mockReturnValue({ hasFeature: () => false, loading: false })
})

afterEach(() => {
  cleanup()
})

describe('MigrateVmDialog - HA negative affinity conflict (running peer)', () => {
  beforeEach(() => {
    seedHandlers({ rules: [negativeRule, positiveRule], status: haStatus('started') })
  })

  it('flags the conflicting node, blocks Migrate and moves the recommendation', async () => {
    renderWithProviders(<MigrateVmDialog {...makeProps()} />)
    await waitForNodesLoaded()

    // pve2 is auto-selected (best score) and hosts vm:200 -> blocking alert
    await screen.findByText('HA affinity conflict')
    expect(
      screen.getByText(/vm:200 is running on pve2 and rule "keep-apart"/),
    ).toBeInTheDocument()

    // Shield badge on the conflicting node row + alert icon
    await waitFor(() => {
      expect(document.querySelectorAll('.ri-shield-cross-line').length).toBeGreaterThanOrEqual(2)
    })

    // Migrate is blocked while the peer runs on the selected node
    expect(screen.getByRole('button', { name: /migrate/i })).toBeDisabled()

    // The recommended star skips the conflicting node: it sits on pve3's row
    const star = document.querySelector('.ri-star-fill')
    expect(star).not.toBeNull()
    let el: HTMLElement | null = star as HTMLElement
    while (el && !el.textContent?.includes('pve3')) el = el.parentElement
    expect(el?.textContent).toContain('pve3')
    expect(el?.textContent).not.toContain('pve2')
  })

  it('shows the positive-affinity co-migration notice', async () => {
    renderWithProviders(<MigrateVmDialog {...makeProps()} />)
    await waitForNodesLoaded()

    expect(
      await screen.findByText(/positive HA affinity with ct:300/),
    ).toBeInTheDocument()
  })

  it('selecting a conflict-free node clears the alert and unblocks Migrate', async () => {
    renderWithProviders(<MigrateVmDialog {...makeProps()} />)
    await waitForNodesLoaded()
    await screen.findByText('HA affinity conflict')

    fireEvent.click(screen.getByText('pve3'))

    await waitFor(() => {
      expect(screen.queryByText('HA affinity conflict')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /migrate/i })).not.toBeDisabled()
  })
})

describe('MigrateVmDialog - HA negative affinity with a stopped peer', () => {
  beforeEach(() => {
    seedHandlers({ rules: [negativeRule], status: haStatus('stopped') })
  })

  it('warns without blocking the migration', async () => {
    renderWithProviders(<MigrateVmDialog {...makeProps()} />)
    await waitForNodesLoaded()

    await screen.findByText('HA affinity conflict')
    expect(screen.getByText(/currently not running/)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /migrate/i })).not.toBeDisabled()
    })
  })
})

describe('MigrateVmDialog - no affinity involvement', () => {
  it('renders nothing affinity-related for a non-HA guest', async () => {
    seedHandlers({ haResources: [{ sid: 'vm:999', state: 'started' }], rules: [negativeRule], status: haStatus('started') })
    renderWithProviders(<MigrateVmDialog {...makeProps()} />)
    await waitForNodesLoaded()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /migrate/i })).not.toBeDisabled()
    })
    expect(screen.queryByText('HA affinity conflict')).not.toBeInTheDocument()
    expect(document.querySelector('.ri-shield-cross-line')).toBeNull()
  })

  it('renders nothing affinity-related for an HA guest without rules (PVE 8)', async () => {
    seedHandlers({ rules: [], status: [] })
    renderWithProviders(<MigrateVmDialog {...makeProps()} />)
    await waitForNodesLoaded()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /migrate/i })).not.toBeDisabled()
    })
    expect(screen.queryByText('HA affinity conflict')).not.toBeInTheDocument()
    expect(document.querySelector('.ri-shield-cross-line')).toBeNull()
  })
})
