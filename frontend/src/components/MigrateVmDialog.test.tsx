/**
 * Component tests for MigrateVmDialog.tsx — HA resource affinity pre-check (#674).
 *
 * Strategy: render the dialog open on the Local migration tab, seed every MSW
 * endpoint fired on open (nodes, VM config, storages, HA), then assert the
 * affinity-conflict UI: node badge, alert severity, Migrate button gating,
 * recommended-node star placement, positive-affinity notice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import { MigrateVmDialog, mergeCapture } from './MigrateVmDialog'
import type { CcmPrereqCapture } from '@/lib/migration/ccm-prereqs.types'
import { crossClusterMigrate } from '@/lib/migration/crossClusterMigrate'

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
  vi.restoreAllMocks()
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


const REMOTE_CONN_ID = 'conn-2'
const REMOTE_MIGRATE_URL = `*/api/v1/connections/${CONN_ID}/guests/qemu/${CURRENT_NODE}/${VMID}/remote-migrate`
const haBlocker = {
  type: 'error', code: 'HA_ENABLED', message: 'HA must be removed',
  remediation: { kind: 'ha', sid: 'vm:100', state: 'started', reversible: true },
}
const replicationBlocker = {
  type: 'error', code: 'REPLICATION_CONFIGURED', message: 'Replication must be removed',
  remediation: { kind: 'replication', jobs: [{ id: '100-0', target: 'pve2' }], reversible: true },
}
const siteRecoveryAdvisory = {
  type: 'warning', code: 'SITE_RECOVERY_JOB',
  message: 'VM is covered by ProxCenter replication job "DR nightly"',
  siteRecovery: { id: 'job-1', name: 'DR nightly', otherVmids: [101, 102], byTag: false },
}
// A target-side check: its values ride in `context` so the row can show them
// under its own label, in the reader's language.
const vmidCollision = {
  type: 'warning', code: 'VMID_EXISTS_ON_TARGET',
  message: 'VMID 100 already exists on target cluster',
  context: { vmid: '100', node: 'remote1' },
}
const snapshotsBlocker = {
  type: 'error', code: 'SNAPSHOTS_PRESENT', message: 'Snapshots must be removed',
  remediation: { kind: 'snapshots', names: ['before-upgrade', 'release-2026'], reversible: false },
}
const haCapture: CcmPrereqCapture = {
  ha: { sid: 'vm:100', state: 'stopped', group: 'production' },
  replication: [], snapshotsDeleted: [],
}
const replicationCapture: CcmPrereqCapture = {
  ha: null,
  replication: [{ id: '100-0', guest: 100, target: 'pve2', schedule: '*/15' }],
  snapshotsDeleted: [],
}

function seedPrereqHandlers({
  issues = [haBlocker] as any[],
  capture = haCapture,
  storageType = 'zfspool',
  remoteNodes = ['remote1', 'remote2'],
  pendingJobs = [] as string[],
  prepareStatus = 200,
} = {}) {
  seedHandlers({ haResources: issues.some(issue => issue.remediation?.kind === 'ha') ? [{ sid: 'vm:100', state: 'started' }] : [] })
  let currentIssues = issues
  const check = vi.fn(() => ({ issues: currentIssues }))
  const prepare = vi.fn(async (payload: Record<string, unknown>) => {
    if (prepareStatus === 200) {
      currentIssues = currentIssues.filter(issue => {
        if (!issue.remediation) return true
        if (issue.remediation.kind === 'ha') return !payload.removeHa
        if (issue.remediation.kind === 'replication') return !payload.removeReplication || pendingJobs.length > 0
        return !payload.removeSnapshots
      })
    }
    return {
      success: prepareStatus === 200,
      error: prepareStatus === 200 ? undefined : 'Preparation partially failed',
      capture,
      cleared: { ha: !!payload.removeHa, replicationJobs: [], snapshots: payload.removeSnapshots || [] },
      pending: { replicationJobs: pendingJobs },
      warnings: [],
    }
  })
  server.use(
    http.get('*/api/v1/connections', () => HttpResponse.json({ data: [
      { id: CONN_ID, type: 'pve', sshEnabled: true, sshConfigured: true },
      { id: REMOTE_CONN_ID, type: 'pve', name: 'Remote cluster', baseUrl: 'https://remote', hosts: remoteNodes },
    ] })),
    http.get(`*/api/v1/connections/${REMOTE_CONN_ID}/nodes`, () => HttpResponse.json({
      data: remoteNodes.map(node => ({ node, status: 'online' })),
    })),
    http.get(`*/api/v1/connections/${REMOTE_CONN_ID}/nodes/:node/storages`, () => HttpResponse.json({
      data: [{ storage: 'target-storage', type: storageType, content: 'images' }],
    })),
    http.get(`*/api/v1/connections/${REMOTE_CONN_ID}/nodes/:node/network`, () => HttpResponse.json({
      data: [{ iface: 'vmbr0', type: 'bridge' }],
    })),
    http.get(`${REMOTE_MIGRATE_URL}/prepare`, () => HttpResponse.json({
      ha: currentIssues.some(i => i.remediation?.kind === 'ha')
        ? { sid: 'vm:100', state: 'started' }
        : null,
      replication: currentIssues.find(i => i.remediation?.kind === 'replication')?.remediation.jobs || [],
      snapshots: currentIssues.find(i => i.remediation?.kind === 'snapshots')?.remediation.names || [],
      siteRecoveryJobs: currentIssues.filter(i => i.siteRecovery).map(i => i.siteRecovery),
    })),
    http.post(`${REMOTE_MIGRATE_URL}/check`, () => HttpResponse.json(check())),
    http.post(`${REMOTE_MIGRATE_URL}/prepare`, async ({ request }) =>
      HttpResponse.json(await prepare(await request.json() as Record<string, unknown>), { status: prepareStatus }),
    ),
  )
  return { prepare, check, clearIssues: () => { currentIssues = [] } }
}

async function renderPrereqs(rowLabel = /High Availability|Replication|Snapshots|Site Recovery/) {
  useLicenseMock.mockReturnValue({ hasFeature: () => true, loading: false })
  const props = { ...makeProps(), isCluster: false, onCrossClusterMigrate: vi.fn().mockResolvedValue(undefined) }
  const view = renderWithProviders(<MigrateVmDialog {...props} />)
  await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument(), { timeout: 10_000 })
  fireEvent.mouseDown(screen.getByRole('combobox'))
  fireEvent.click(await screen.findByRole('option', { name: /Remote cluster/ }))
  // A check row carries its short domain label plus the actual values; the
  // route's sentence lives in the tooltip now.
  await screen.findAllByText(rowLabel, {}, { timeout: 10_000 })
  return { ...view, props }
}

async function clearReversible() {
  const button =
    screen.queryByRole('button', { name: 'Remove from HA' }) ||
    screen.getByRole('button', { name: /Remove \d+ replication job/ })
  fireEvent.click(button)
  await screen.findByText('Re-apply HA and replication on the target cluster', {}, { timeout: 10_000 })
}

function restoreSwitch() {
  return screen.getByLabelText('Re-apply HA and replication on the target cluster')
}

describe('MigrateVmDialog - cross-cluster prerequisites', () => {
  it('clears an HA blocker through the prepare POST endpoint', async () => {
    const { prepare } = seedPrereqHandlers()
    await renderPrereqs()
    expect(screen.getByRole('button', { name: 'Remove from HA' })).toBeEnabled()
    await clearReversible()
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ removeHa: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })).toBeEnabled())
  })

  it('gives each blocker its own action and never bundles the snapshot deletion', async () => {
    const { prepare } = seedPrereqHandlers({ issues: [haBlocker, replicationBlocker, snapshotsBlocker] })
    await renderPrereqs()

    // One row per check, one button per row, and the snapshot one is destructive
    // so it only ever opens the confirmation.
    fireEvent.click(screen.getByRole('button', { name: 'Remove 1 replication job(s)' }))
    await waitFor(() => expect(prepare).toHaveBeenCalledExactlyOnceWith({ removeReplication: true }))
    expect(prepare).not.toHaveBeenCalledWith(expect.objectContaining({ removeSnapshots: expect.anything() }))
    expect(screen.getByRole('button', { name: 'Delete 2 snapshot(s)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })).toBeDisabled()
  })

  it('never offers an action on a ProxCenter replication job, which may cover other guests', async () => {
    // A pvesr job is bound to ONE guest, so clearing it is safe. A Site Recovery
    // job carries a list of VMIDs: clearing it to unblock this guest would stop
    // replicating the others, so the row is advisory and button-free.
    seedPrereqHandlers({ issues: [siteRecoveryAdvisory] })
    await renderPrereqs()

    const row = (await screen.findByText('Site Recovery')).closest('div')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).queryByRole('button')).toBeNull()
    expect(screen.getByText('Covered by replication job "DR nightly", which also covers 2 other guest(s)')).toBeInTheDocument()

    // Advisory only: it must not block the migration.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })).toBeEnabled())
  })

  it('never repeats a row label in its own detail, and localises the values', async () => {
    // "VMID" + "VMID 100 already exists on target cluster" said it twice and in
    // English whatever the locale. The route sends the values, the row renders
    // them under its label.
    seedPrereqHandlers({ issues: [vmidCollision] })
    await renderPrereqs(/VMID/)

    const row = (await screen.findByText('VMID')).closest('div') as HTMLElement
    expect(within(row).getByText('100 already used on remote1')).toBeInTheDocument()
    expect(row.textContent).not.toMatch(/VMID\s+VMID/)
  })

  it('keeps the route sentence when a check carries no values', async () => {
    // A route from an older build sends the code without its context: rendering
    // the pattern would leave holes in the line, so the sentence stays.
    const { context, ...withoutContext } = vmidCollision
    seedPrereqHandlers({ issues: [withoutContext] })
    await renderPrereqs(/VMID/)

    expect(await screen.findByText('VMID 100 already exists on target cluster')).toBeInTheDocument()
  })

  it('renders every check as one row with its short domain label', async () => {
    seedPrereqHandlers({ issues: [haBlocker, replicationBlocker, snapshotsBlocker] })
    await renderPrereqs()

    // Each check is a row carrying its short domain label, and no longer a
    // banner: the stack of Alerts made the modal taller than the viewport.
    for (const label of ['High Availability', 'Replication', 'Snapshots']) {
      expect(screen.getByText(label).closest('.MuiAlert-root')).toBeNull()
    }
  })

  it('opens a separate confirmation listing every snapshot without fetching', async () => {
    const { prepare } = seedPrereqHandlers({ issues: [snapshotsBlocker] })
    await renderPrereqs()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 snapshot(s)' }))
    const confirmation = screen.getByRole('dialog', { name: 'Delete snapshots permanently?' })
    for (const name of snapshotsBlocker.remediation.names) {
      expect(within(confirmation).getByText(name)).toBeInTheDocument()
    }
    expect(within(confirmation).getByText(/These snapshots of web/)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('deletes only the named snapshots after confirmation', async () => {
    const { prepare } = seedPrereqHandlers({ issues: [snapshotsBlocker], capture: { ha: null, replication: [], snapshotsDeleted: snapshotsBlocker.remediation.names } })
    await renderPrereqs()
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 snapshot(s)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(prepare).toHaveBeenCalledExactlyOnceWith({ removeSnapshots: snapshotsBlocker.remediation.names }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete snapshots permanently?' })).not.toBeInTheDocument())
  })

  it('shows pending replication removals and continues blocking migration', async () => {
    seedPrereqHandlers({ issues: [replicationBlocker], capture: replicationCapture, pendingJobs: ['100-0'] })
    await renderPrereqs()
    await clearReversible()
    expect(await screen.findByText(/Proxmox is removing the replication job\(s\) in the background: 100-0/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })).toBeDisabled()
  })

  it('polls every ten seconds and stops when replication is no longer configured', async () => {
    const { check, clearIssues } = seedPrereqHandlers({ issues: [replicationBlocker], capture: replicationCapture, pendingJobs: ['100-0'] })
    await renderPrereqs()
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1))
    let tick: () => Promise<void> = async () => {}
    // Capture ONLY the component's 10s poll. waitFor() below drives its own
    // setInterval, and grabbing that callback instead would leave `tick` a no-op.
    const realSetInterval = globalThis.setInterval
    const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: any, delay?: number, ...rest: any[]) => {
      if (delay === 10_000) {
        tick = callback
        return 882 as unknown as ReturnType<typeof setInterval>
      }
      return realSetInterval(callback, delay, ...rest)
    }) as typeof setInterval)
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    await clearReversible()
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 10_000)
    clearIssues()
    await act(async () => { await tick() })
    expect(check).toHaveBeenCalledTimes(3)
    expect(screen.queryByText(/Proxmox is removing the replication/)).not.toBeInTheDocument()
    expect(clearIntervalSpy).toHaveBeenCalledWith(882)
  })

  it('caps replication polling at twelve attempts and clears the interval on unmount', async () => {
    const { check } = seedPrereqHandlers({ issues: [replicationBlocker], capture: replicationCapture, pendingJobs: ['100-0'] })
    const { unmount } = await renderPrereqs()
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1))
    let tick: () => Promise<void> = async () => {}
    // Same reason as above: only the 10s poll is ours, waitFor() owns the rest.
    const realSetInterval = globalThis.setInterval
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: any, delay?: number, ...rest: any[]) => {
      if (delay === 10_000) {
        tick = callback
        return 883 as unknown as ReturnType<typeof setInterval>
      }
      return realSetInterval(callback, delay, ...rest)
    }) as typeof setInterval)
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    await clearReversible()
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await act(async () => { await tick() })
    }
    expect(clearIntervalSpy).not.toHaveBeenCalledWith(883)
    await act(async () => { await tick() })
    expect(check).toHaveBeenCalledTimes(14)
    expect(clearIntervalSpy).toHaveBeenCalledWith(883)
    expect(screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })).toBeDisabled()
    clearIntervalSpy.mockClear()
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalledWith(883)
  })

  it('defaults restoration on and pre-fills the captured HA state', async () => {
    seedPrereqHandlers()
    await renderPrereqs()
    await clearReversible()
    expect(restoreSwitch()).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'HA state on target' })).toHaveTextContent('stopped')
  })

  it('explains why rbd storage cannot recreate replication', async () => {
    seedPrereqHandlers({ issues: [replicationBlocker], capture: replicationCapture, storageType: 'rbd' })
    await renderPrereqs()
    await clearReversible()
    expect(screen.getByText(/Target storage "target-storage" does not support Proxmox replication/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Replicate to node' })).not.toBeInTheDocument()
  })

  it('explains why a single-node target cannot recreate replication', async () => {
    seedPrereqHandlers({ issues: [replicationBlocker], capture: replicationCapture, remoteNodes: ['remote1'] })
    await renderPrereqs()
    await clearReversible()
    expect(screen.getByText('The target cluster has a single node, so replication cannot be recreated.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Replicate to node' })).not.toBeInTheDocument()
  })

  it('keeps source rollback enabled when target restoration is switched off', async () => {
    seedPrereqHandlers()
    const { props } = await renderPrereqs()
    await clearReversible()
    fireEvent.click(restoreSwitch())
    expect(restoreSwitch()).not.toBeChecked()
    const submit = screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(props.onCrossClusterMigrate).toHaveBeenCalledWith(expect.objectContaining({
      restore: { capture: haCapture, restoreHa: false, restoreReplication: false, rollbackOnFailure: true },
    })))
  })

  it('restores replication to another node with the edited schedule and rate', async () => {
    seedPrereqHandlers({ issues: [replicationBlocker], capture: replicationCapture })
    const { props } = await renderPrereqs()
    await clearReversible()
    const target = screen.getByRole('combobox', { name: 'Replicate to node' })
    expect(target).toHaveTextContent('remote2')
    expect(screen.getByText('A newly created replication job starts with a full initial sync of every disk.')).toBeInTheDocument()
    fireEvent.mouseDown(target)
    expect(screen.queryByRole('option', { name: 'remote1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'remote2' }))
    fireEvent.change(screen.getByLabelText('Replication schedule'), { target: { value: '*/30' } })
    fireEvent.change(screen.getByLabelText('Rate limit (MB/s)'), { target: { value: '25' } })
    const submit = screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(props.onCrossClusterMigrate).toHaveBeenCalledWith(expect.objectContaining({
      restore: expect.objectContaining({ capture: replicationCapture, restoreReplication: true, replicationTarget: 'remote2', replicationSchedule: '*/30', replicationRate: 25, rollbackOnFailure: true }),
    })))
  })

  it('retains the capture on partial failure and displays the error', async () => {
    seedPrereqHandlers({ prepareStatus: 500 })
    await renderPrereqs()
    await clearReversible()
    expect(screen.getByText('Preparation partially failed')).toBeInTheDocument()
    expect(restoreSwitch()).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'HA state on target' })).toHaveTextContent('stopped')
    expect(screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })).toBeDisabled()
  })

  it('keeps the HA capture across a subsequent snapshot prepare call', async () => {
    const { prepare } = seedPrereqHandlers({ issues: [haBlocker, snapshotsBlocker] })
    const { props } = await renderPrereqs()
    await clearReversible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete 2 snapshot(s)' })).toBeEnabled())
    server.use(http.post(`${REMOTE_MIGRATE_URL}/prepare`, () => HttpResponse.json({
      success: true,
      capture: { ha: null, replication: [], snapshotsDeleted: snapshotsBlocker.remediation.names },
      cleared: { ha: false, replicationJobs: [], snapshots: snapshotsBlocker.remediation.names },
      pending: { replicationJobs: [] },
    })))
    server.use(http.post(`${REMOTE_MIGRATE_URL}/check`, () => HttpResponse.json({ issues: [] })))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 snapshot(s)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete snapshots permanently?' })).not.toBeInTheDocument())
    const submit = screen.getByRole('button', { name: 'Start Cross-Cluster Migration' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(props.onCrossClusterMigrate).toHaveBeenCalledWith(expect.objectContaining({
      restore: expect.objectContaining({ capture: { ...haCapture, snapshotsDeleted: snapshotsBlocker.remediation.names } }),
    })))
    expect(prepare).toHaveBeenCalledTimes(1)
  })
})

describe('mergeCapture', () => {
  it('keeps the first HA capture and unions replication ids and deleted snapshot names', () => {
    const first = { ...haCapture, replication: replicationCapture.replication, snapshotsDeleted: ['before-upgrade'] }
    const next = {
      ha: { sid: 'vm:100', state: 'disabled' },
      replication: [replicationCapture.replication[0], { id: '100-1', guest: 100, target: 'pve3' }],
      snapshotsDeleted: ['before-upgrade', 'release-2026'],
    }
    expect(mergeCapture(first, next)).toEqual({
      ha: haCapture.ha,
      replication: next.replication,
      snapshotsDeleted: ['before-upgrade', 'release-2026'],
    })
    expect(first.replication).toHaveLength(1)
    expect(first.snapshotsDeleted).toEqual(['before-upgrade'])
  })

  it('accepts an initial capture and keeps the first non-null HA across calls', () => {
    const initial = mergeCapture(null, replicationCapture)
    expect(initial).toEqual(replicationCapture)
    expect(mergeCapture(initial, haCapture)).toEqual({ ...haCapture, replication: replicationCapture.replication })
  })
})

describe('crossClusterMigrate restore payload', () => {
  it('passes restore through untouched while preserving the deleteSource remap', async () => {
    const post = vi.fn()
    server.use(http.post(REMOTE_MIGRATE_URL, async ({ request }) => {
      post(await request.json())
      return HttpResponse.json({ data: 'UPID:remote-task' })
    }))
    const restore = { capture: haCapture, restoreHa: false, restoreReplication: false, rollbackOnFailure: true }
    await crossClusterMigrate({ connId: CONN_ID, node: CURRENT_NODE, type: 'qemu', vmid: VMID }, {
      targetConnectionId: REMOTE_CONN_ID, targetNode: 'remote1', targetStorage: 'target-storage', targetBridge: 'vmbr0', online: true, deleteSource: true, restore,
    })
    expect(post).toHaveBeenCalledExactlyOnceWith({
      targetConnectionId: REMOTE_CONN_ID, targetNode: 'remote1', targetStorage: 'target-storage', targetBridge: 'vmbr0', online: true, delete: true, restore,
    })
  })
})
