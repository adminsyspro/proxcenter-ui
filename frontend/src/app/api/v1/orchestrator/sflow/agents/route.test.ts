import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
  getSessionPrisma: vi.fn<() => Promise<any>>(),
  requireProviderTenant: vi.fn<() => Promise<Response | null>>(async () => null),
}))

vi.mock('@/lib/orchestrator', () => ({
  orchestratorFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage', CONNECTION_VIEW: 'connection.view' },
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
import { getCurrentTenantId, getSessionPrisma, requireProviderTenant } from '@/lib/tenant'
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
    connection: {
      findMany: vi.fn().mockResolvedValue([{
        id: 'conn-1',
        hosts: [{ node: 'pve1', ip: '10.0.0.1', enabled: true }, { node: 'pve2', ip: '10.0.0.2', enabled: true }],
      }]),
    },
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
    // #1066: the agent is pinned to the node address the table is keyed on.
    expect(cmd).toContain(`agent='"10.0.0.1"'`)
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

describe('POST /sflow/agents: expected agents (roadmap#52)', () => {
  it('tells the orchestrator to expect the nodes just configured, with a fresh grace period', async () => {
    getSessionPrismaMock.mockResolvedValue({
      connection: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'conn-1', name: 'LAB', sshKeyEnc: 'enc',
          hosts: [{ node: 'pve1', ip: '10.0.0.1', enabled: true }, { node: 'pve2', ip: '10.0.0.2', enabled: true }],
        }]),
      },
    })
    executeSSHMock.mockImplementation(async (_c: string, target: { host: string }) =>
      target.host === '10.0.0.2' ? { success: true, output: 'SFLOW_FAILED:vmbr0\n' } : ONE_BRIDGE_OK)
    orchestratorFetchMock.mockResolvedValue({})

    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [NODE_REQ, NODE_REQ_2], collectorTarget: '10.0.0.5:6343', samplingRate: 256, pollingInterval: 20 },
    })
    expect(res.status).toBe(200)

    const calls = orchestratorFetchMock.mock.calls.filter((c: any[]) => c[0] === '/sflow/expected-agents')
    expect(calls).toHaveLength(1)
    // Partial report (no connection_ids): the failed node is left as the
    // orchestrator knows it, the next probe will say.
    expect(calls[0][1]).toEqual({
      method: 'PUT',
      body: {
        connection_ids: [],
        agents: [{
          connection_id: 'conn-1', connection_name: 'LAB', node: 'pve1', agent_ip: '10.0.0.1',
          target: '10.0.0.5:6343', polling_interval: 20, sampling_rate: 256, configured: true, reconfigured: true,
        }],
      },
    })
  })

  it('reports nothing when no node was configured', async () => {
    executeSSHMock.mockResolvedValue({ success: false, error: 'ssh: connection refused' })
    const res = await callRoute(POST as any, { method: 'POST', body: { nodes: [NODE_REQ], collectorTarget: '10.0.0.5:6343' } })
    expect(res.status).toBe(502)
    expect(orchestratorFetchMock.mock.calls.filter((c: any[]) => c[0] === '/sflow/expected-agents')).toHaveLength(0)
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
    return async (_conn: string, target: { host: string }, cmd: string) => {
      const ip = target.host
      if (cmd.includes('/etc/pve/nodes/')) {
        if (opts.macsFrom === null || ip !== opts.macsFrom) return { success: false, output: '', error: 'ssh: unreachable' }
        return { success: true, output: MAC_LINES }
      }
      if (cmd.startsWith('ovs-vsctl list-br')) return { success: true, output: opts.ovsOn.includes(ip) ? 'vmbr1\n' : '' }
      if (cmd.startsWith('which ovs-vsctl')) return { success: true, output: '' }
      if (cmd.startsWith('ovs-vsctl --version')) return { success: true, output: 'ovs-vsctl (Open vSwitch) 3.5.0\n' }
      if (cmd.startsWith('ovs-vsctl list sflow')) {
        return { success: true, output: opts.sflowOn.includes(ip) ? 'agent : []\npolling : 30\nsampling : 1\ntargets : ["10.0.0.5:6343"]\n' : '' }
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
        sflowPolling: 30,
        bridges: ['vmbr1'],
        portMapError: '',
      }),
    )
    expect(data[1]).toEqual(expect.objectContaining({ node: 'pve2', hasOvs: false, sflowConfigured: false }))

    // Every probe only reads, so a cluster outside the license is still listed (roadmap#58).
    expect(executeSSHMock.mock.calls.length).toBeGreaterThan(0)
    for (const call of executeSSHMock.mock.calls) expect(call[4]).toEqual({ readOnly: true })

    // One port map push, for the OVS node only, carrying the cluster-wide MAC table.
    const portmapCalls = orchestratorFetchMock.mock.calls.filter((c: any[]) => c[0] === '/sflow/portmap')
    expect(portmapCalls).toHaveLength(1)
    expect(portmapCalls[0][1].body).toEqual({
      agent_ip: '10.0.0.1',
      ip_link_output: expect.stringContaining('ln_CLIENT'),
      guest_macs: { 'bc:24:11:b6:00:5d': 101, 'aa:bb:cc:dd:ee:ff': 109 },
    })

    // roadmap#52: the probe tells the orchestrator what to expect. Both nodes
    // answered, so the cluster is reported in full; the node without sFlow is
    // reported as not configured, the one with it carries its target and
    // polling interval, and no grace restart (a probe is not a configure run).
    const expectedCalls = orchestratorFetchMock.mock.calls.filter((c: any[]) => c[0] === '/sflow/expected-agents')
    expect(expectedCalls).toHaveLength(1)
    expect(expectedCalls[0][1]).toEqual({
      method: 'PUT',
      body: {
        connection_ids: ['conn-1'],
        agents: [
          {
            connection_id: 'conn-1', connection_name: 'LAB', node: 'pve1', agent_ip: '10.0.0.1',
            target: '10.0.0.5:6343', polling_interval: 30, sampling_rate: 1, configured: true, reconfigured: false,
          },
          {
            connection_id: 'conn-1', connection_name: 'LAB', node: 'pve2', agent_ip: '10.0.0.2',
            target: '', polling_interval: 0, sampling_rate: 0, configured: false, reconfigured: false,
          },
        ],
      },
    })
  })

  it('does not report a cluster as complete while one of its nodes is unreachable', async () => {
    getCurrentTenantIdMock.mockResolvedValue('tenant-get-3')
    getSessionPrismaMock.mockResolvedValue(prismaWithHosts())
    const byCommand = sshByCommand({ macsFrom: '10.0.0.1', ovsOn: ['10.0.0.1'], sflowOn: ['10.0.0.1'] })
    executeSSHMock.mockImplementation(async (conn: string, target: { host: string }, cmd: string) => {
      // pve2 is down: every command to it throws, which probeHost reads as offline.
      if (target.host === '10.0.0.2') throw new Error('ssh: connect timed out')
      return byCommand(conn, target, cmd)
    })
    orchestratorFetchMock.mockResolvedValue({})

    const res = await callRoute(GET as any, { method: 'GET' })
    const { data } = await readJson<any>(res)
    expect(data.find((d: any) => d.node === 'pve2').online).toBe(false)

    const [, init] = orchestratorFetchMock.mock.calls.find((c: any[]) => c[0] === '/sflow/expected-agents')!
    // The offline node is not mentioned (unknown, not unconfigured), and the
    // cluster is left out of connection_ids so the orchestrator keeps its row.
    expect(init.body.connection_ids).toEqual([])
    expect(init.body.agents.map((a: any) => a.node)).toEqual(['pve1'])
  })

  it('lets only the provider write the fleet-wide expected agents inventory', async () => {
    getCurrentTenantIdMock.mockResolvedValue('tenant-get-5')
    vi.mocked(requireProviderTenant).mockResolvedValueOnce(new Response(null, { status: 403 }))
    getSessionPrismaMock.mockResolvedValue(prismaWithHosts())
    executeSSHMock.mockImplementation(sshByCommand({ macsFrom: '10.0.0.1', ovsOn: ['10.0.0.1'], sflowOn: ['10.0.0.1'] }))
    orchestratorFetchMock.mockResolvedValue({})

    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(200)
    expect(orchestratorFetchMock.mock.calls.filter((c: any[]) => c[0] === '/sflow/expected-agents')).toHaveLength(0)
  })

  it('still answers when the orchestrator refuses the expected agents report', async () => {
    getCurrentTenantIdMock.mockResolvedValue('tenant-get-4')
    getSessionPrismaMock.mockResolvedValue(prismaWithHosts())
    executeSSHMock.mockImplementation(sshByCommand({ macsFrom: '10.0.0.1', ovsOn: ['10.0.0.1'], sflowOn: ['10.0.0.1'] }))
    orchestratorFetchMock.mockImplementation(async (path: string) => {
      if (path === '/sflow/expected-agents') throw Object.assign(new Error('404'), { code: 'ORCHESTRATOR_UNAVAILABLE' })
      return {}
    })

    const res = await callRoute(GET as any, { method: 'GET' })
    expect(res.status).toBe(200)
    const { data } = await readJson<any>(res)
    expect(data[0]).toEqual(expect.objectContaining({ node: 'pve1', sflowConfigured: true, portMapError: '' }))
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
    const portmapCalls = orchestratorFetchMock.mock.calls.filter((c: any[]) => c[0] === '/sflow/portmap')
    expect(portmapCalls).toHaveLength(2)
    expect(portmapCalls[0][1].body.guest_macs).toEqual({})
  })
})

// roadmap#184: the handler checks only say the caller holds the right
// SOMEWHERE; every connection read or configured is checked on its own.
describe('/sflow/agents with a connection-scoped grant', () => {
  const TWO_CONNECTIONS = [
    { id: 'conn-1', name: 'A', sshKeyEnc: 'enc', hosts: [{ node: 'pve1', ip: '10.0.0.1', enabled: true }] },
    { id: 'conn-2', name: 'B', sshKeyEnc: 'enc', hosts: [{ node: 'pve9', ip: '10.0.0.9', enabled: true }] },
  ]
  const onlyConn1 = async (_perm: string, type?: string, id?: string) =>
    type === 'connection' && id !== 'conn-1' ? new Response(null, { status: 403 }) : null

  beforeEach(() => {
    // Own tenant id: the GET cache is per tenant and the other suites fill it.
    getCurrentTenantIdMock.mockResolvedValue('tenant-scoped')
    getSessionPrismaMock.mockResolvedValue({ connection: { findMany: vi.fn().mockResolvedValue(TWO_CONNECTIONS) } })
    checkPermissionMock.mockImplementation(onlyConn1)
  })

  it('refuses to configure a connection the caller does not manage, without SSH', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [{ node: 'pve9', ip: '10.0.0.9', connectionId: 'conn-2' }], collectorTarget: '10.0.0.5:6343' },
    })

    expect(res.status).toBe(502)
    expect((await readJson<any>(res)).results[0]).toMatchObject({ success: false, error: 'Connection not found' })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('never opens SSH to an address the connection does not list', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [{ node: 'ghost', ip: '203.0.113.7', connectionId: 'conn-1' }], collectorTarget: '10.0.0.5:6343' },
    })

    expect(res.status).toBe(502)
    expect((await readJson<any>(res)).results[0]).toMatchObject({ success: false, error: 'Unknown node for this connection' })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('reaches a listed node on its own address, never the posted one', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [{ node: 'pve1', ip: '203.0.113.7', connectionId: 'conn-1' }], collectorTarget: '10.0.0.5:6343' },
    })

    expect(res.status).toBe(200)
    const [connId, target, cmd] = executeSSHMock.mock.calls[0]
    expect(connId).toBe('conn-1')
    expect(JSON.stringify(target)).toContain('10.0.0.1')
    expect(JSON.stringify(target)).not.toContain('203.0.113.7')
    expect(cmd).toContain(`agent='"10.0.0.1"'`)
  })

  it('does not store the tenant-wide config the reconciler re-applies everywhere', async () => {
    await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [{ node: 'pve1', ip: '10.0.0.1', connectionId: 'conn-1' }], collectorTarget: '10.0.0.5:6343' },
    })

    expect(saveDesiredSFlowConfigMock).not.toHaveBeenCalled()
  })

  it('lists the agents of the granted connection only', async () => {
    executeSSHMock.mockResolvedValue({ success: false, output: '' })
    orchestratorFetchMock.mockResolvedValue({})

    const res = await callRoute(GET as any, { method: 'GET' })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data.map((n: any) => n.connectionId)).toEqual(['conn-1'])
  })
})
