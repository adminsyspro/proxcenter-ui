import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
  getSessionPrisma: vi.fn<() => Promise<any>>(),
}))

vi.mock('@/lib/orchestrator', () => ({
  orchestratorFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn<(...args: any[]) => Promise<any>>(),
  // Mirror the real single-quote shell escaper so command assertions match.
  shellEscape: (arg: string) => "'" + arg.replaceAll("'", "'\\''") + "'",
}))

vi.mock('@/lib/audit', () => ({
  audit: vi.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sflow/reconciler', () => ({
  saveDesiredSFlowConfig: vi.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined),
}))

import { GET, POST } from './route'
import { getCurrentTenantId, getSessionPrisma } from '@/lib/tenant'
import { checkPermission } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'
import { orchestratorFetch } from '@/lib/orchestrator'
import { audit } from '@/lib/audit'
import { saveDesiredSFlowConfig } from '@/lib/sflow/reconciler'

const getCurrentTenantIdMock = getCurrentTenantId as any
const getSessionPrismaMock = getSessionPrisma as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any
const orchestratorFetchMock = orchestratorFetch as any
const auditMock = audit as any
const saveDesiredSFlowConfigMock = saveDesiredSFlowConfig as any

const NODE_REQ = { node: 'pve1', ip: '10.0.0.1', connectionId: 'conn-1' }
const NODE_REQ_2 = { node: 'pve2', ip: '10.0.0.2', connectionId: 'conn-1' }
// What the configure command prints when the bridge was set (see configure.ts).
const ONE_BRIDGE_OK = { success: true, output: 'SFLOW_OK:vmbr0\n' }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('tenant-1')
  getSessionPrismaMock.mockResolvedValue({
    connection: { findMany: vi.fn().mockResolvedValue([{ id: 'conn-1' }]) },
  })
  executeSSHMock.mockResolvedValue(ONE_BRIDGE_OK)
})

describe('POST /sflow/agents — happy path', () => {
  it('quotes the collector target for ovs-vsctl and coerces the rates into the command', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: {
        nodes: [NODE_REQ],
        collectorTarget: '10.0.0.5:6343',
        samplingRate: 1024,
        pollingInterval: 15,
      },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(body.configured).toBe(1)
    expect(body.results).toEqual([
      expect.objectContaining({ node: 'pve1', success: true, bridgesConfigured: 1 }),
    ])

    expect(executeSSHMock).toHaveBeenCalledTimes(1)
    const [, , cmd] = executeSSHMock.mock.calls[0]
    // ovs-vsctl needs the target wrapped in literal double quotes, inside the
    // shell's single quotes. A bare host:port is rejected by ovs-vsctl.
    expect(cmd).toContain(`target='"10.0.0.5:6343"'`)
    expect(cmd).not.toContain('clear Bridge')
    expect(cmd).not.toContain('agent=')
    expect(cmd).toContain('sampling=1024')
    expect(cmd).toContain('polling=15')

    expect(saveDesiredSFlowConfigMock).toHaveBeenCalledWith('tenant-1', {
      collectorTarget: '10.0.0.5:6343',
      samplingRate: 1024,
      pollingInterval: 15,
    })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'sflow', status: 'success' }))
  })

  it('coerces string-typed numeric rates from the body', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [NODE_REQ], collectorTarget: 'collector.local:6343', samplingRate: '256', pollingInterval: '20' },
    })
    expect(res.status).toBe(200)
    const [, , cmd] = executeSSHMock.mock.calls[0]
    expect(cmd).toContain('sampling=256')
    expect(cmd).toContain('polling=20')
  })
})

describe('POST /sflow/agents: outcome reporting', () => {
  it('returns 502 with the reason when no node was configured, and does not store the config', async () => {
    // The shell exits 0 with an empty bridge list; this used to pass for a success.
    executeSSHMock.mockResolvedValue({ success: true, output: '' })

    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [NODE_REQ], collectorTarget: '10.0.0.5:6343' },
    })
    expect(res.status).toBe(502)
    const body = await readJson<any>(res)
    expect(body.success).toBe(false)
    expect(body.configured).toBe(0)
    expect(body.error).toMatch(/no OVS bridge/i)
    expect(body.results[0]).toEqual(expect.objectContaining({ node: 'pve1', success: false }))

    expect(saveDesiredSFlowConfigMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'sflow', status: 'failure', errorMessage: expect.stringContaining('pve1') }),
    )
  })

  it('reports a partial outcome per node with a 200 when at least one node succeeded', async () => {
    executeSSHMock
      .mockResolvedValueOnce(ONE_BRIDGE_OK)
      .mockResolvedValueOnce({ success: false, output: '', error: 'ssh: connect to host 10.0.0.2 port 22: No route to host' })

    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [NODE_REQ, NODE_REQ_2], collectorTarget: '10.0.0.5:6343' },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(body.configured).toBe(1)
    expect(body.total).toBe(2)
    expect(body.results).toEqual([
      expect.objectContaining({ node: 'pve1', success: true }),
      expect.objectContaining({ node: 'pve2', success: false, error: expect.stringContaining('No route to host') }),
    ])

    expect(saveDesiredSFlowConfigMock).toHaveBeenCalledTimes(1)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure' }))
  })
})

describe('POST /sflow/agents — input validation (command injection)', () => {
  it('403 when RBAC denies connection.manage', async () => {
    checkPermissionMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    )
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [NODE_REQ], collectorTarget: '10.0.0.5:6343' },
    })
    expect(res.status).toBe(403)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  const BAD_TARGETS = [
    '10.0.0.5:6343; reboot',
    '$(id)',
    '`whoami`',
    '10.0.0.5:6343 && curl evil',
    "10.0.0.5';rm -rf /;'",
    'target with spaces',
  ]
  for (const collectorTarget of BAD_TARGETS) {
    it(`rejects collector target ${JSON.stringify(collectorTarget)} with 400 and never runs SSH`, async () => {
      const res = await callRoute(POST as any, {
        method: 'POST',
        body: { nodes: [NODE_REQ], collectorTarget },
      })
      expect(res.status).toBe(400)
      const body = await readJson<any>(res)
      expect(body.error).toMatch(/collector target/i)
      expect(executeSSHMock).not.toHaveBeenCalled()
    })
  }

  const BAD_RATES = [
    { samplingRate: '10; reboot' },
    { samplingRate: 0 },
    { samplingRate: 1.5 },
    { pollingInterval: '$(id)' },
    { pollingInterval: 0 },
    { pollingInterval: 999999 },
  ]
  for (const extra of BAD_RATES) {
    it(`rejects rates ${JSON.stringify(extra)} with 400 and never runs SSH`, async () => {
      const res = await callRoute(POST as any, {
        method: 'POST',
        body: { nodes: [NODE_REQ], collectorTarget: '10.0.0.5:6343', ...extra },
      })
      expect(res.status).toBe(400)
      expect(executeSSHMock).not.toHaveBeenCalled()
    })
  }
})

describe('GET /sflow/agents: node probing and port map push', () => {
  const MAC_LINES =
    '/etc/pve/nodes/pve3/qemu-server/101.conf:net0: virtio=BC:24:11:B6:00:5D,bridge=CLIENT\n' +
    '/etc/pve/nodes/pve3/lxc/109.conf:net0: name=eth0,bridge=vmbr0,hwaddr=AA:BB:CC:DD:EE:FF\n'

  // Dispatch on the command so one mock serves the whole probe sequence.
  function sshByCommand(opts: { macsFrom: string | null; ovsOn: string[]; sflowOn: string[] }) {
    return async (_conn: string, ip: string, cmd: string) => {
      if (cmd.includes('/etc/pve/nodes/')) {
        if (opts.macsFrom === null || ip !== opts.macsFrom) return { success: false, output: '', error: 'ssh: unreachable' }
        return { success: true, output: MAC_LINES }
      }
      if (cmd.startsWith('ovs-vsctl list-br')) return { success: true, output: opts.ovsOn.includes(ip) ? 'vmbr1\n' : '' }
      if (cmd.startsWith('which ovs-vsctl')) return { success: true, output: '' }
      if (cmd.startsWith('ovs-vsctl --version')) return { success: true, output: 'ovs-vsctl (Open vSwitch) 3.5.0\n' }
      if (cmd.startsWith('ovs-vsctl list sflow')) {
        return { success: true, output: opts.sflowOn.includes(ip) ? 'agent : []\nsampling : 1\ntargets : ["10.0.0.5:6343"]\n' : '' }
      }
      if (cmd.startsWith('ip -o link')) return { success: true, output: '10: ln_CLIENT: <BROADCAST> mtu 1500\n' }
      throw new Error(`unexpected command ${cmd}`)
    }
  }

  function prismaWithHosts() {
    return {
      connection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'conn-1',
            name: 'LAB',
            sshKeyEnc: 'enc',
            hosts: [
              { node: 'pve1', ip: '10.0.0.1', enabled: true },
              { node: 'pve2', ip: '10.0.0.2', enabled: true },
              { node: 'pve-noip', ip: null, enabled: true },
            ],
          },
          // No SSH credential at all: skipped without probing.
          { id: 'conn-2', name: 'NOKEY', sshKeyEnc: null, sshPassEnc: null, hosts: [{ node: 'x', ip: '10.0.9.9', enabled: true }] },
          // Credential but no eligible host.
          { id: 'conn-3', name: 'EMPTY', sshKeyEnc: 'enc', hosts: [{ node: 'y', ip: '10.0.9.8', enabled: false }] },
        ]),
      },
    }
  }

  it('reads guest MACs from the first node that answers and pushes them with the port map', async () => {
    // Distinct tenant per test: the route caches results per tenant for 30s.
    getCurrentTenantIdMock.mockResolvedValue('tenant-get-1')
    getSessionPrismaMock.mockResolvedValue(prismaWithHosts())
    // pve1 cannot answer the MAC query, pve2 can: the table must still be complete.
    executeSSHMock.mockImplementation(sshByCommand({ macsFrom: '10.0.0.2', ovsOn: ['10.0.0.1'], sflowOn: ['10.0.0.1'] }))
    orchestratorFetchMock.mockResolvedValue({})

    const res = await callRoute(GET as any, { method: 'GET' })
    expect(res.status).toBe(200)
    const { data } = await readJson<any>(res)

    expect(data.map((d: any) => d.node)).toEqual(['pve1', 'pve2'])
    expect(data[0]).toEqual(
      expect.objectContaining({
        hasOvs: true,
        ovsVersion: '3.5.0',
        sflowConfigured: true,
        sflowTarget: '10.0.0.5:6343',
        sflowSampling: 1,
        bridges: ['vmbr1'],
        portMapError: '',
      }),
    )
    expect(data[1]).toEqual(expect.objectContaining({ node: 'pve2', hasOvs: false, sflowConfigured: false }))

    // One push, for the OVS node only, carrying the cluster-wide MAC table.
    expect(orchestratorFetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = orchestratorFetchMock.mock.calls[0]
    expect(path).toBe('/sflow/portmap')
    expect(init.body).toEqual({
      agent_ip: '10.0.0.1',
      ip_link_output: expect.stringContaining('ln_CLIENT'),
      guest_macs: { 'bc:24:11:b6:00:5d': 101, 'aa:bb:cc:dd:ee:ff': 109 },
    })
  })

  it('reports a failed port map push on the node instead of swallowing it, with an empty MAC table when no node answers', async () => {
    getCurrentTenantIdMock.mockResolvedValue('tenant-get-2')
    getSessionPrismaMock.mockResolvedValue(prismaWithHosts())
    executeSSHMock.mockImplementation(sshByCommand({ macsFrom: null, ovsOn: ['10.0.0.1', '10.0.0.2'], sflowOn: [] }))
    orchestratorFetchMock.mockRejectedValue(new Error('orchestrator unreachable'))

    const res = await callRoute(GET as any, { method: 'GET' })
    expect(res.status).toBe(200)
    const { data } = await readJson<any>(res)

    expect(data).toHaveLength(2)
    for (const node of data) {
      expect(node.hasOvs).toBe(true)
      expect(node.sflowConfigured).toBe(false)
      expect(node.portMapError).toBe('orchestrator unreachable')
    }
    expect(orchestratorFetchMock).toHaveBeenCalledTimes(2)
    expect(orchestratorFetchMock.mock.calls[0][1].body.guest_macs).toEqual({})
  })
})
