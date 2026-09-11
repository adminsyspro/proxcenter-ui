import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  loadPublicFleetViewMock, buildFleetBackupFreshnessMock, checkPermissionMock, currentPrincipal,
} = vi.hoisted(() => ({
  loadPublicFleetViewMock: vi.fn<(p?: any) => Promise<any>>(),
  buildFleetBackupFreshnessMock: vi.fn<(o: any) => Promise<any>>(),
  checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
  currentPrincipal: { value: undefined as any },
}))

// The guard itself is unit-tested in routeGuard.test.ts; here it is a
// pass-through that injects the principal under test.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => (req: Request, ctx: any) =>
    handler(req, { ...(ctx || {}), principal: currentPrincipal.value }),
}))

vi.mock('@/lib/api-tokens/publicData', () => ({ loadPublicFleetView: loadPublicFleetViewMock }))
vi.mock('@/lib/backups/freshness', () => ({ buildFleetBackupFreshness: buildFleetBackupFreshnessMock }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { NODE_VIEW: 'node.view', BACKUP_VIEW: 'backup.view' },
}))

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { FAMILY_REGISTRY } from '@/lib/metrics/families/registry'

const VIEW = {
  tenantId: 'default',
  visible: new Set(['pve-1']),
  cached: true,
  clusters: [
    {
      id: 'pve-1',
      name: 'PVE One',
      nodes: [
        { node: 'n1', status: 'online', guests: [] },
        { node: 'n2', status: 'offline', guests: [] },
      ],
    },
  ],
  nodes: [
    {
      connId: 'pve-1', connectionName: 'PVE One', node: 'n1', status: 'online', cpu: 0.25, mem: 1000, maxmem: 4000,
      disk: 3000, maxdisk: 10000, uptime: 86400, maintenance: false,
    },
    {
      connId: 'pve-1', connectionName: 'PVE One', node: 'n2', status: 'offline', cpu: 0, mem: 0, maxmem: 0,
      disk: 0, maxdisk: 0, uptime: 0, maintenance: true,
    },
  ],
  guests: [
    {
      connId: 'pve-1', connectionName: 'PVE One', node: 'n1', vmid: '100', name: 'web-01', type: 'qemu',
      status: 'running', cpu: 0.5, mem: 500, maxmem: 2000, agentEnabled: true, template: false,
      maxdisk: 32000, uptime: 3600, hastate: 'started',
    },
  ],
  pbsServers: [
    {
      connId: 'pbs-1', connectionName: 'PBS Main', status: 'online', version: '4.2.1',
      datastores: [
        {
          name: 'ds', total: 8000, used: 2000, available: 6000, usagePercent: 25,
          backupCount: 12, vmCount: 3, ctCount: 2, hostCount: 1,
        },
      ],
    },
  ],
}

/**
 * Families the VIEW fixture above genuinely cannot populate, so the
 * "serves every registered family" loop skips them rather than being
 * weakened: the fixture's single cluster carries no `cephHealth`.
 */
const EMPTY_ON_THIS_FIXTURE = ['proxcenter_cluster_ceph_health']

function tokenPrincipal(scopes: string[]) {
  return { kind: 'token', tokenId: 't', tenantId: 'default', connectionIds: null, scopes }
}

beforeEach(() => {
  vi.resetAllMocks()
  currentPrincipal.value = undefined
  checkPermissionMock.mockResolvedValue(null)
  loadPublicFleetViewMock.mockResolvedValue(VIEW)
  buildFleetBackupFreshnessMock.mockResolvedValue({
    guests: [
      {
        connId: 'pve-1', connectionName: 'PVE One', vmid: '100', backupType: 'vm',
        latestBackupTime: 1_700_000_000, latestBackupIso: '2023-11-14T22:13:20.000Z',
        ageSeconds: 3600, datastore: 'ds', namespace: '', pbsConnectionId: 'pbs-1',
        pbsConnectionName: 'PBS Main', sizeBytes: 2048, verified: true, warnings: [],
      },
      {
        connId: 'pve-1', connectionName: 'PVE One', vmid: '999', backupType: 'vm',
        latestBackupTime: null, latestBackupIso: null, ageSeconds: null, datastore: null,
        namespace: null, pbsConnectionId: null, pbsConnectionName: null, sizeBytes: null,
        verified: null, warnings: [],
      },
    ],
    warnings: [],
  })
})

describe('GET /api/v1/public/metrics', () => {
  it('emits every family for a full-scope token, in Prometheus format', async () => {
    currentPrincipal.value = tokenPrincipal(['nodes:read', 'vms:read', 'backups:read'])
    const { GET } = await import('./metrics/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8')
    const body = await res.text()
    expect(body).toContain('# TYPE proxcenter_node_online gauge')
    expect(body).toContain('proxcenter_node_online{connection="PVE One",node="n1"} 1')
    expect(body).toContain('proxcenter_node_online{connection="PVE One",node="n2"} 0')
    expect(body).toContain('proxcenter_node_cpu_usage_ratio{connection="PVE One",node="n1"} 0.25')
    expect(body).toContain('proxcenter_node_mem_usage_ratio{connection="PVE One",node="n1"} 0.25')
    expect(body).toContain('proxcenter_vm_status{connection="PVE One",node="n1",vmid="100",name="web-01",type="qemu"} 1')
    expect(body).toContain('proxcenter_vm_cpu_usage_ratio{connection="PVE One",node="n1",vmid="100",name="web-01",type="qemu"} 0.5')
    expect(body).toContain('proxcenter_vm_agent_enabled{connection="PVE One",node="n1",vmid="100",name="web-01"} 1')
    // #925: the ONE authorised label break. node, name and type are added so
    // the offenders table can name a guest without a group_left join.
    expect(body).toContain('proxcenter_backup_age_seconds{connection="PVE One",node="n1",vmid="100",name="web-01",type="qemu",datastore="ds"} 3600')
    // D12: the backup family, once allowed, must still forward nonBlocking
    // so a scrape never blocks on a cold PBS cache.
    expect(buildFleetBackupFreshnessMock).toHaveBeenCalledWith(expect.objectContaining({ nonBlocking: true }))
  })

  it('a vms:read-only token gets 200 with the VM series only, and no backup aggregation is computed', async () => {
    currentPrincipal.value = tokenPrincipal(['vms:read'])
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    expect(body).toContain('proxcenter_vm_status')
    expect(body).not.toContain('proxcenter_node_online')
    expect(body).not.toContain('proxcenter_backup_age_seconds')
    expect(buildFleetBackupFreshnessMock).not.toHaveBeenCalled()
  })

  it('omits guests with no backup from the age series', async () => {
    currentPrincipal.value = tokenPrincipal(['backups:read'])
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    expect(body).toContain('vmid="100"')
    expect(body).not.toContain('vmid="999"')
  })

  it('omits proxcenter_vm_agent_enabled entirely for a guest with an unknown (null) agent flag, never emitting 0', async () => {
    currentPrincipal.value = tokenPrincipal(['vms:read'])
    loadPublicFleetViewMock.mockResolvedValue({
      ...VIEW,
      guests: [
        { ...VIEW.guests[0], vmid: '100', agentEnabled: true },
        { ...VIEW.guests[0], vmid: '200', agentEnabled: null },
      ],
    })
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    // The known-true guest is present...
    expect(body).toContain('proxcenter_vm_agent_enabled{connection="PVE One",node="n1",vmid="100",name="web-01"} 1')
    // ...but the unknown guest has NO agent_enabled line at all (not even a
    // 0) — checked as a prefix (not the full label set) so the proof holds
    // regardless of what other labels the line carries.
    expect(body).not.toContain('proxcenter_vm_agent_enabled{connection="PVE One",node="n1",vmid="200"')
    // It still appears in the unaffected VM families (proves it wasn't dropped from the view).
    expect(body).toContain('proxcenter_vm_status{connection="PVE One",node="n1",vmid="200"')
  })

  it('emits 0 for agentEnabled: false, a real known answer, distinct from the null/unknown case', async () => {
    currentPrincipal.value = tokenPrincipal(['vms:read'])
    loadPublicFleetViewMock.mockResolvedValue({
      ...VIEW,
      guests: [{ ...VIEW.guests[0], vmid: '300', agentEnabled: false }],
    })
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    expect(body).toContain('proxcenter_vm_agent_enabled{connection="PVE One",node="n1",vmid="300",name="web-01"} 0')
  })

  it('reports 0 for a stopped guest in proxcenter_vm_status', async () => {
    currentPrincipal.value = tokenPrincipal(['vms:read'])
    loadPublicFleetViewMock.mockResolvedValue({
      ...VIEW,
      guests: [{ ...VIEW.guests[0], vmid: '400', status: 'stopped' }],
    })
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    expect(body).toContain('proxcenter_vm_status{connection="PVE One",node="n1",vmid="400",name="web-01",type="qemu"} 0')
  })

  it('treats a token principal with no scopes array as having no relevant scope (defensive fallback)', async () => {
    currentPrincipal.value = { kind: 'token', tokenId: 't', tenantId: 'default', connectionIds: null }
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    expect(body).not.toContain('proxcenter_node_online')
    expect(body).not.toContain('proxcenter_vm_status')
    expect(body).not.toContain('proxcenter_backup_age_seconds')
  })

  it('applies checkPermission(node.view) for a session caller', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    const { GET } = await import('./metrics/route')
    expect((await callRoute(GET)).status).toBe(403)
  })

  it('allows a session caller once checkPermission(node.view) grants, without a token in ctx', async () => {
    const { GET } = await import('./metrics/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.view')
  })
})

describe('GET /api/v1/public/backups', () => {
  it('returns the freshness aggregation including never-backed-up guests', async () => {
    currentPrincipal.value = tokenPrincipal(['backups:read'])
    const { GET } = await import('./backups/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.guests).toHaveLength(2)
    expect(body.data.guests[1].ageSeconds).toBeNull()
    // D12: /backups also scrapes-adjacent (a monitoring dashboard can poll
    // it), so it must forward nonBlocking too, same as /metrics.
    expect(buildFleetBackupFreshnessMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'default', visibleConnectionIds: VIEW.visible, nonBlocking: true }),
    )
  })

  it('applies checkPermission(backup.view) for a session caller', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    const { GET } = await import('./backups/route')
    expect((await callRoute(GET)).status).toBe(403)
  })

  it('allows a session caller once checkPermission(backup.view) grants', async () => {
    const { GET } = await import('./backups/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view')
  })
})

describe('GET /api/v1/public/health', () => {
  it('reports per-connection reachability and degrades on a fully offline connection', async () => {
    currentPrincipal.value = tokenPrincipal([])
    const { GET } = await import('./health/route')
    const body = await readJson<any>(await callRoute(GET))
    expect(body.data.status).toBe('ok')
    expect(body.data.tenantId).toBe('default')
    expect(body.data.cached).toBe(true)
    expect(body.data.connections).toEqual([
      { connId: 'pve-1', name: 'PVE One', reachable: true, nodesOnline: 1, nodesTotal: 2 },
    ])

    loadPublicFleetViewMock.mockResolvedValue({
      ...VIEW,
      clusters: [{ id: 'pve-1', name: 'PVE One', nodes: [{ node: 'n1', status: 'offline', guests: [] }] }],
    })
    const degraded = await readJson<any>(await callRoute((await import('./health/route')).GET))
    expect(degraded.data.status).toBe('degraded')
    expect(degraded.data.connections[0].reachable).toBe(false)
  })

  it('applies checkPermission(node.view) for a session caller', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    const { GET } = await import('./health/route')
    expect((await callRoute(GET)).status).toBe(403)
  })

  it('allows a session caller once checkPermission(node.view) grants', async () => {
    const { GET } = await import('./health/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.view')
  })
})

describe('GET /api/v1/public/metrics after the family extraction (#925)', () => {
  /**
   * The seven families shipped on 3 August are a published contract. Moving
   * them out of the route into per-domain modules must not change one
   * character of their output, so this asserts the rendered HELP and TYPE
   * headers, not merely that the names appear somewhere.
   */
  it('renders the seven pre-existing families with their original headers', async () => {
    currentPrincipal.value = tokenPrincipal(['nodes:read', 'vms:read', 'backups:read'])
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    for (const [name, help] of [
      ['proxcenter_node_online', 'Node online state (1 online, 0 otherwise)'],
      ['proxcenter_node_cpu_usage_ratio', 'Node CPU usage ratio (0 to 1)'],
      ['proxcenter_node_mem_usage_ratio', 'Node memory usage ratio (0 to 1)'],
      ['proxcenter_vm_status', 'Guest running state (1 running, 0 otherwise)'],
      ['proxcenter_vm_cpu_usage_ratio', 'Guest CPU usage ratio (0 to 1)'],
      ['proxcenter_vm_agent_enabled', 'Guest agent config flag (1 enabled, 0 otherwise)'],
      ['proxcenter_backup_age_seconds', 'Seconds since the most recent backup of this guest'],
    ]) {
      expect(body).toContain(`# HELP ${name} ${help}`)
      expect(body).toContain(`# TYPE ${name} gauge`)
    }
  })

  it('serves every registered family to a full-scope token', async () => {
    currentPrincipal.value = tokenPrincipal(['nodes:read', 'vms:read', 'backups:read'])
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    const rendered = new Set(
      body.split(String.fromCharCode(10))
        .filter(line => line.startsWith('# TYPE '))
        .map(line => line.split(' ')[2]),
    )
    for (const declaration of FAMILY_REGISTRY) {
      if (EMPTY_ON_THIS_FIXTURE.includes(declaration.name)) continue
      expect(rendered, `missing family ${declaration.name}`).toContain(declaration.name)
    }
  })

  /**
   * Per-family filtering, never a route-level gate: a token holding only
   * nodes:read gets a 200 carrying the node and cluster families and
   * nothing else.
   */
  it('filters the new families by token scope, one family at a time', async () => {
    currentPrincipal.value = tokenPrincipal(['nodes:read'])
    const { GET } = await import('./metrics/route')
    const res = await callRoute(GET)
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).toContain('proxcenter_cluster_up{')
    expect(body).toContain('proxcenter_node_mem_bytes{')
    expect(body).toContain('proxcenter_node_rootfs_usage_ratio{')
    expect(body).not.toContain('proxcenter_vm_mem_bytes{')
    expect(body).not.toContain('proxcenter_pbs_up{')
    expect(body).not.toContain('proxcenter_backup_protected{')
  })

  it('serves the PBS and backup families to a backups:read token, and no node series', async () => {
    currentPrincipal.value = tokenPrincipal(['backups:read'])
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    expect(body).toContain('proxcenter_pbs_up{connection="PBS Main"} 1')
    expect(body).toContain('proxcenter_pbs_datastore_usage_ratio{connection="PBS Main",datastore="ds"} 0.25')
    expect(body).toContain('proxcenter_backup_protected{connection="PVE One",node="n1",vmid="100",name="web-01",type="qemu"} 1')
    expect(body).not.toContain('proxcenter_node_online{')
    expect(body).not.toContain('proxcenter_cluster_up{')
  })

  it('always serves the build info, whatever the token holds', async () => {
    currentPrincipal.value = tokenPrincipal(['nodes:read'])
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    expect(body).toMatch(/proxcenter_build_info\{version="[0-9]+\.[0-9]+\.[0-9]+"\} 1/)
  })

  /**
   * The backup aggregation walks every visible PBS connection, so it is the
   * expensive part of this handler. A token that cannot see its output must
   * not pay for it.
   */
  it('does not compute backup freshness for a nodes:read token', async () => {
    currentPrincipal.value = tokenPrincipal(['nodes:read'])
    const { GET } = await import('./metrics/route')
    await callRoute(GET)
    expect(buildFleetBackupFreshnessMock).not.toHaveBeenCalled()
  })

  it('reports a node in maintenance and one that is not', async () => {
    currentPrincipal.value = tokenPrincipal(['nodes:read'])
    const { GET } = await import('./metrics/route')
    const body = await (await callRoute(GET)).text()
    expect(body).toContain('proxcenter_node_maintenance{connection="PVE One",node="n1"} 0')
    expect(body).toContain('proxcenter_node_maintenance{connection="PVE One",node="n2"} 1')
  })

  /**
   * A view missing a collection entirely, which is what a caller written
   * before #925 hands over, must yield empty families rather than a throw:
   * one missing optional field must never take the whole scrape down and
   * blind every panel.
   */
  it('survives a fleet view with no PBS servers and no HA state at all', async () => {
    loadPublicFleetViewMock.mockResolvedValue({
      tenantId: 'default', visible: new Set(['pve-1']), cached: true,
      clusters: [{ id: 'pve-1', name: 'PVE One', nodes: [] }],
      nodes: [{ connId: 'pve-1', connectionName: 'PVE One', node: 'n1', status: 'online', cpu: 0, mem: 0, maxmem: 0 }],
      guests: [{ connId: 'pve-1', connectionName: 'PVE One', node: 'n1', vmid: '1', name: 'a', type: 'qemu', status: 'running', cpu: 0, mem: 0, maxmem: 0, agentEnabled: null, template: false }],
    })
    currentPrincipal.value = tokenPrincipal(['nodes:read', 'vms:read', 'backups:read'])
    const { GET } = await import('./metrics/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('proxcenter_node_online{connection="PVE One",node="n1"} 1')
    expect(body).not.toContain('proxcenter_pbs_up')
    expect(body).not.toContain('proxcenter_vm_ha_state')
    expect(body).not.toContain('NaN')
  })
})
