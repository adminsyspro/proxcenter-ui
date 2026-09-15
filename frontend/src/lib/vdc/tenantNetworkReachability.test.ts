/**
 * MOCK-based tests for the reachability test of a stretched tenant network
 * (#901): one SSH round trip per node that pings the other members' peers.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/tenantNetworkReachability.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, executeSSHMock, getNodeIpMock, memberPeersMock, connectionOfMock } = vi.hoisted(() => ({
  prismaMock: {
    tenantNetwork: { findUnique: vi.fn() },
    connection: { findMany: vi.fn() },
  } as any,
  executeSSHMock: vi.fn(),
  getNodeIpMock: vi.fn(),
  memberPeersMock: vi.fn(),
  connectionOfMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: executeSSHMock,
  shellEscape: (s: string) => `'${s.replaceAll("'", "'\\''")}'`,
}))
vi.mock('@/lib/ssh/node-ip', () => ({ getNodeIp: getNodeIpMock }))
vi.mock('./stretchPeers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  memberPeersForVdc: memberPeersMock,
  connectionOf: connectionOfMock,
}))

import { buildPingCommand, parsePingOutput, testNetworkReachability } from './tenantNetworkReachability'

const vdc = (id: string, name: string, connectionId: string, nodes: string[]) => ({
  id, name, connectionId, sdnZoneName: 'z', vxlanTransportMode: 'cluster', vxlanPeers: [], vxlanMtu: null,
  transportVlanId: null, transportDevice: null, transportCidr: null, transportNodeAddresses: null,
  nodes: nodes.map(nodeName => ({ nodeName })),
})

const network = () => ({
  id: 'n1', name: 'backbone',
  members: [{ vdc: vdc('v-prod', 'MSP-vDC', 'c-prod', ['pve1', 'pve2']) }, { vdc: vdc('v-dr', 'MSP-DR', 'c-dr', ['pve1-dr']) }],
})

beforeEach(() => {
  prismaMock.tenantNetwork.findUnique.mockReset().mockResolvedValue(network())
  prismaMock.connection.findMany.mockReset().mockResolvedValue([
    { id: 'c-prod', name: 'PVE-PROD', sshEnabled: true },
    { id: 'c-dr', name: 'PVE-DR', sshEnabled: true },
  ])
  executeSSHMock.mockReset()
  getNodeIpMock.mockReset().mockImplementation(async (_c: any, node: string) => `ip-of-${node}`)
  memberPeersMock.mockReset().mockImplementation(async (id: string) => (id === 'v-prod' ? ['10.42.0.111'] : ['10.42.0.101', '10.42.0.102']))
  connectionOfMock.mockReset().mockImplementation(async (id: string) => ({ id }))
})

describe('buildPingCommand / parsePingOutput', () => {
  it('pings every peer once with a one second timeout and prints one verdict per peer', () => {
    const cmd = buildPingCommand(['10.42.0.111', "10.42.0.112'x"])
    expect(cmd).toContain(`for p in '10.42.0.111' '10.42.0.112'\\''x'; do`)
    expect(cmd).toContain('ping -c 1 -W 1 -q "$p"')
    expect(cmd).toContain('echo "$p ok"')
    expect(cmd).toContain('echo "$p ko"')
  })

  it('parses only the verdict lines of the peers asked for', () => {
    const out = 'noise\n10.42.0.111 ok\n10.42.0.112 ko\n10.9.9.9 ok\n'
    const parsed = parsePingOutput(out, ['10.42.0.111', '10.42.0.112'])
    expect([...parsed.entries()]).toEqual([['10.42.0.111', true], ['10.42.0.112', false]])
  })
})

describe('testNetworkReachability', () => {
  it('refuses an unknown network and one with fewer than two members', async () => {
    prismaMock.tenantNetwork.findUnique.mockResolvedValueOnce(null)
    await expect(testNetworkReachability('nope')).rejects.toThrow('Tenant network: not found: nope')
    prismaMock.tenantNetwork.findUnique.mockResolvedValueOnce({ ...network(), members: [network().members[0]] })
    await expect(testNetworkReachability('n1')).rejects.toThrow('needs at least two member vDCs')
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it("runs one SSH command per node against the other members' peers and reads the verdicts", async () => {
    executeSSHMock.mockImplementation(async (_conn: string, ip: string, cmd: string) => {
      if (ip === 'ip-of-pve2') return { success: true, output: '10.42.0.111 ko\n' }
      if (ip === 'ip-of-pve1-dr') return { success: true, output: '10.42.0.101 ok\n10.42.0.102 ok\n' }
      expect(cmd).toContain("'10.42.0.111'")
      return { success: true, output: '10.42.0.111 ok\n' }
    })

    const results = await testNetworkReachability('n1')

    expect(executeSSHMock).toHaveBeenCalledTimes(3)
    expect(executeSSHMock).toHaveBeenCalledWith('c-prod', 'ip-of-pve1', expect.stringContaining('ping'), expect.any(Number))
    expect(results).toEqual([
      { vdcId: 'v-prod', vdcName: 'MSP-vDC', connectionId: 'c-prod', connectionName: 'PVE-PROD', node: 'pve1', peer: '10.42.0.111', state: 'reachable' },
      { vdcId: 'v-prod', vdcName: 'MSP-vDC', connectionId: 'c-prod', connectionName: 'PVE-PROD', node: 'pve2', peer: '10.42.0.111', state: 'unreachable' },
      { vdcId: 'v-dr', vdcName: 'MSP-DR', connectionId: 'c-dr', connectionName: 'PVE-DR', node: 'pve1-dr', peer: '10.42.0.101', state: 'reachable' },
      { vdcId: 'v-dr', vdcName: 'MSP-DR', connectionId: 'c-dr', connectionName: 'PVE-DR', node: 'pve1-dr', peer: '10.42.0.102', state: 'reachable' },
    ])
  })

  it('reports a cluster without SSH, a node whose address cannot be resolved and a failed command as not tested, with the reason', async () => {
    prismaMock.connection.findMany.mockResolvedValue([
      { id: 'c-prod', name: 'PVE-PROD', sshEnabled: true },
      { id: 'c-dr', name: 'PVE-DR', sshEnabled: false },
    ])
    getNodeIpMock.mockImplementation(async (_c: any, node: string) => { if (node === 'pve2') throw new Error('no address'); return `ip-of-${node}` })
    executeSSHMock.mockResolvedValue({ success: false, error: 'connection refused' })

    const results = await testNetworkReachability('n1')

    expect(results.find(r => r.node === 'pve1')).toMatchObject({ state: 'unavailable', message: 'connection refused' })
    expect(results.find(r => r.node === 'pve2')).toMatchObject({ state: 'unavailable', message: 'no address' })
    expect(results.filter(r => r.node === 'pve1-dr')).toHaveLength(2)
    expect(results.find(r => r.node === 'pve1-dr')).toMatchObject({ state: 'unavailable', message: 'SSH is not enabled on this connection' })
    // The DR cluster never gets an SSH attempt.
    expect(executeSSHMock).toHaveBeenCalledTimes(1)
  })
})
