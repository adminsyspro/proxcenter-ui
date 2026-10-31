/**
 * Host maintenance, HA and CVE tools (#459): what each reads, how often, and
 * that nothing outside the snapshot comes back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { invokeTool } from './invoke'
import type { ToolContext } from './types'

const h = vi.hoisted(() => ({
  pveFetch: vi.fn(),
  orchestratorFetch: vi.fn(),
  licensed: true,
  denied: false,
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: h.pveFetch }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))
vi.mock('@/lib/orchestrator/client', () => ({
  orchestratorFetch: h.orchestratorFetch,
  orchestratorPath: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''), ''),
}))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => h.licensed }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { NODE_VIEW: 'node.view' },
  checkPermission: async () => (h.denied ? { status: 403 } : null),
}))

import { clearHostsCache, getCveExposureTool, getHaStatusTool, getHostMaintenanceTool, MAX_MAINTENANCE_HOSTS } from './hosts'

const node = (name: string, over: Record<string, unknown> = {}) => ({
  connId: 'c1', cluster: 'PVE-PROD', name, status: 'online', cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 8, ...over,
})

const ctx = (nodes = [node('pve1'), node('pve2'), node('pve3', { status: 'offline' })]): ToolContext => ({
  snapshot: {
    clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: nodes.length, guestCount: 1 }],
    nodes,
    guests: [
      { connId: 'c1', cluster: 'PVE-PROD', vmid: '101', name: 'db-01', type: 'VM', kind: 'qemu', status: 'running', node: 'pve1', cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 4, template: false },
    ],
    summary: { totalGuests: 1, runningGuests: 1, stoppedGuests: 0, totalNodes: nodes.length, onlineNodes: 2 },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
  timeZone: 'UTC',
  usage: { historyLookups: 0 },
})

const inDays = (d: number) => Math.floor(Date.now() / 1000) + d * 86_400

beforeEach(() => {
  clearHostsCache()
  h.licensed = true
  h.denied = false
  h.orchestratorFetch.mockReset()
  h.pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) => {
    if (path.endsWith('/apt/update')) {
      return [
        { Package: 'pve-manager', OldVersion: '9.2.21', Version: '9.2.24', Origin: 'Proxmox' },
        { Package: 'openssl', OldVersion: '3.0.1', Version: '3.0.2', Origin: 'Debian', Section: 'security' },
      ]
    }
    if (path.endsWith('/subscription')) return { status: 'notfound', level: '' }
    if (path.endsWith('/certificates/info')) return [{ notafter: inDays(400) }, { notafter: inDays(12) }]
    if (path === '/cluster/ha/status/current') {
      return [
        { id: 'quorum', quorate: 1, status: 'OK' },
        { id: 'master', type: 'master', node: 'pve2' },
        { type: 'lrm', node: 'pve1', status: 'active' },
        { type: 'lrm', node: 'pve9', status: 'active' },
        { type: 'service', sid: 'vm:101', state: 'error', node: 'pve1' },
        { type: 'service', sid: 'vm:999', state: 'error', node: 'pve9' },
      ]
    }

    return null
  })
})

describe('get_host_maintenance', () => {
  it('reads updates, subscription and certificates of the online hosts, three GETs each', async () => {
    const res = (await getHostMaintenanceTool.execute({}, ctx())) as any

    expect(h.pveFetch).toHaveBeenCalledTimes(6)
    expect(res.hosts[0]).toMatchObject({
      host: 'pve1',
      updates: { pending: 2, security: 1, proxmoxPackages: ['pve-manager 9.2.21 -> 9.2.24'] },
      subscription: { status: 'notfound' },
      certificateExpiresInDays: 11,
      certificateExpiresSoon: true,
    })
    expect(res).toMatchObject({ hostsWithUpdates: 2, hostsWithSecurityUpdates: 2 })
  })

  it('serves a repeated question from the cache', async () => {
    await getHostMaintenanceTool.execute({ node: 'pve1' }, ctx())
    await getHostMaintenanceTool.execute({ node: 'pve1' }, ctx())

    expect(h.pveFetch).toHaveBeenCalledTimes(3)
  })

  it('refuses to fan out past its host cap', async () => {
    const many = Array.from({ length: MAX_MAINTENANCE_HOSTS + 1 }, (_, i) => node(`n${i}`))

    expect(await invokeTool(getHostMaintenanceTool, {}, ctx(many))).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('refuses without the host permission', async () => {
    h.denied = true

    expect(await invokeTool(getHostMaintenanceTool, {}, ctx())).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(h.pveFetch).not.toHaveBeenCalled()
  })
})

describe('get_ha_status', () => {
  it('reads quorum, master, agents and the guests in trouble, inside the snapshot only', async () => {
    const res = (await getHaStatusTool.execute({}, ctx())) as any

    expect(h.pveFetch).toHaveBeenCalledTimes(1)
    expect(res.clusters[0]).toMatchObject({
      cluster: 'PVE-PROD',
      quorate: true,
      master: 'pve2',
      agents: [{ host: 'pve1', status: 'active' }],
      managedGuests: 1,
      guestsNeedingAttention: [{ guest: 'db-01', state: 'error', host: 'pve1' }],
    })
  })
})

describe('get_cve_exposure', () => {
  const scan = {
    lastScan: '2026-10-30T16:00:00Z',
    vulnerabilities: [
      { cveId: 'CVE-1', severity: 'critical', node: 'pve1', package: 'openssl', installedVersion: '3.0.1', fixedVersion: '3.0.2', fixAvailable: true },
      { cveId: 'CVE-2', severity: 'medium', node: 'pve2', package: 'acl', fixAvailable: false },
      { cveId: 'CVE-3', severity: 'critical', node: 'pve9', package: 'secret' },
    ],
    nodes: [{ node: 'pve1' }, { node: 'pve2' }, { node: 'pve9' }],
  }

  it('summarises one cluster scan within the snapshot', async () => {
    h.orchestratorFetch.mockResolvedValue(scan)

    const res = (await getCveExposureTool.execute({}, ctx())) as any

    expect(h.orchestratorFetch.mock.calls[0][0]).toBe('/cve/c1')
    expect(res).toMatchObject({ cluster: 'PVE-PROD', total: 2, fixable: 1, bySeverity: { critical: 1, medium: 1 } })
    expect(res.mostSevere[0]).toMatchObject({ cve: 'CVE-1', host: 'pve1', fixedIn: '3.0.2' })
    expect(res.perHost.map((p: any) => p.host)).toEqual(['pve1', 'pve2'])
    expect(JSON.stringify(res)).not.toContain('secret')
  })

  it('scans once per question and keeps the scan six hours', async () => {
    h.orchestratorFetch.mockResolvedValue(scan)

    const c = ctx()

    await getCveExposureTool.execute({}, c)
    await getCveExposureTool.execute({}, c)
    await getCveExposureTool.execute({}, ctx())

    expect(h.orchestratorFetch).toHaveBeenCalledTimes(1)
  })

  it('refuses a second scan in the same question', async () => {
    h.orchestratorFetch.mockResolvedValue(scan)

    const c = ctx()

    c.usage!.cveScans = 1

    expect(await invokeTool(getCveExposureTool, {}, c)).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(h.orchestratorFetch).not.toHaveBeenCalled()
  })

  it('refuses without the licence, and says when the scan times out', async () => {
    h.licensed = false
    expect(await invokeTool(getCveExposureTool, {}, ctx())).toMatchObject({ ok: false, error: 'out-of-scope' })

    h.licensed = true
    h.orchestratorFetch.mockRejectedValue(new Error('timeout'))
    expect(await getCveExposureTool.execute({}, ctx())).toMatchObject({ available: false })
  })
})
