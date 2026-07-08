import { describe, it, expect, vi } from 'vitest'
import { fetchConnectionsNetworks } from './fetchConnectionsNetworks'

// Build a minimal fetch mock that returns a successful response for a connId
function makeOkFetch(responsesByConnId: Record<string, { data: any[] }>) {
  return vi.fn(async (url: string) => {
    const match = /\/connections\/([^/]+)\/networks/.exec(url)
    const connId = match ? decodeURIComponent(match[1]) : '__unknown__'
    const body = responsesByConnId[connId]
    if (!body) throw new Error(`Unexpected connId: ${connId}`)
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

// Returns a fetch that always responds with a non-ok status for the given connId
function makeFailFetch(failConnId: string, fallbackData: Record<string, { data: any[] }>) {
  return vi.fn(async (url: string) => {
    const match = /\/connections\/([^/]+)\/networks/.exec(url)
    const connId = match ? decodeURIComponent(match[1]) : '__unknown__'
    if (connId === failConnId) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    }
    const body = fallbackData[connId]
    if (!body) throw new Error(`Unexpected connId: ${connId}`)
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

describe('fetchConnectionsNetworks', () => {
  it('returns all rows and no failedConnIds when all connections succeed', async () => {
    const fetchImpl = makeOkFetch({
      conn1: { data: [{ vmid: '100', name: 'vm1', node: 'node1', type: 'qemu', status: 'running', nets: [] }] },
      conn2: { data: [{ vmid: '200', name: 'vm2', node: 'node2', type: 'lxc', status: 'stopped', nets: [] }] },
    })

    const result = await fetchConnectionsNetworks(['conn1', 'conn2'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.failedConnIds).toEqual([])
    expect(result.data).toHaveLength(2)
    expect(result.data.map((d) => d.vmid)).toContain('100')
    expect(result.data.map((d) => d.vmid)).toContain('200')
    // connId must be stamped on each item
    expect(result.data.find((d) => d.vmid === '100')?.connId).toBe('conn1')
    expect(result.data.find((d) => d.vmid === '200')?.connId).toBe('conn2')
  })

  it('puts the failing connId in failedConnIds and keeps other connections data', async () => {
    const fetchImpl = makeFailFetch('bad-conn', {
      'good-conn': { data: [{ vmid: '101', name: 'vm-ok', node: 'n1', type: 'qemu', status: 'running', nets: [] }] },
    })

    const result = await fetchConnectionsNetworks(['good-conn', 'bad-conn'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.failedConnIds).toEqual(['bad-conn'])
    expect(result.data).toHaveLength(1)
    expect(result.data[0].vmid).toBe('101')
  })

  it('retries a connection that throws once and succeeds on retry', async () => {
    let callCount = 0
    const fetchImpl = vi.fn(async (url: string) => {
      const match = /\/connections\/([^/]+)\/networks/.exec(url)
      const connId = match ? decodeURIComponent(match[1]) : ''
      if (connId === 'flaky') {
        callCount++
        if (callCount === 1) throw new Error('temporary network error')
        return new Response(
          JSON.stringify({ data: [{ vmid: '999', name: 'flaky-vm', node: 'n1', type: 'qemu', status: 'running', nets: [] }] }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    })

    const result = await fetchConnectionsNetworks(['flaky'], {
      retries: 2,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.failedConnIds).toEqual([])
    expect(result.data).toHaveLength(1)
    expect(result.data[0].vmid).toBe('999')
    expect(callCount).toBe(2)
  })

  it('folds effectiveTag into tag via foldEffectiveVlanTags', async () => {
    const fetchImpl = makeOkFetch({
      conn1: {
        data: [
          {
            vmid: '300',
            name: 'vlan-vm',
            node: 'n1',
            type: 'qemu',
            status: 'running',
            nets: [{ id: 'net0', model: 'virtio', bridge: 'vmbr0', tag: undefined, effectiveTag: 10 }],
          },
        ],
      },
    })

    const result = await fetchConnectionsNetworks(['conn1'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.data).toHaveLength(1)
    const net = result.data[0].nets[0]
    // foldEffectiveVlanTags should have set tag = effectiveTag = 10
    expect(net.tag).toBe(10)
  })

  it('returns empty result immediately for empty connIds input', async () => {
    const fetchImpl = vi.fn()

    const result = await fetchConnectionsNetworks([], {
      retries: 2,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.data).toEqual([])
    expect(result.failedConnIds).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('threads bridges from route response, tagging each with connId', async () => {
    const fetchImpl = makeOkFetch({
      conn1: {
        data: [],
        bridges: [
          { node: 'pve1', iface: 'vmbr0', type: 'bridge' },
          { node: 'pve1', iface: 'vmbr1', type: 'bridge', tag: 10 },
        ],
      } as any,
      conn2: {
        data: [],
        bridges: [
          { node: 'pve2', iface: 'vmbr0', type: 'OVSBridge' },
        ],
      } as any,
    })

    const result = await fetchConnectionsNetworks(['conn1', 'conn2'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.bridges).toHaveLength(3)
    expect(result.bridges.every((b) => typeof b.connId === 'string')).toBe(true)
    const conn1Bridges = result.bridges.filter((b) => b.connId === 'conn1')
    expect(conn1Bridges).toHaveLength(2)
    const conn2Bridges = result.bridges.filter((b) => b.connId === 'conn2')
    expect(conn2Bridges).toHaveLength(1)
    expect(conn2Bridges[0].node).toBe('pve2')
  })

  it('contributes no bridges from a failed connection', async () => {
    const fetchImpl = makeFailFetch('bad-conn', {
      'good-conn': {
        data: [],
        bridges: [{ node: 'pve1', iface: 'vmbr0', type: 'bridge' }],
      } as any,
    })

    const result = await fetchConnectionsNetworks(['good-conn', 'bad-conn'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.failedConnIds).toEqual(['bad-conn'])
    expect(result.bridges).toHaveLength(1)
    expect(result.bridges[0].connId).toBe('good-conn')
  })

  it('returns bridges: [] when the route response has no bridges field (backward compat)', async () => {
    // Old route response without bridges
    const fetchImpl = makeOkFetch({
      conn1: { data: [] },
    })

    const result = await fetchConnectionsNetworks(['conn1'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.bridges).toEqual([])
  })

  it('threads vlans from route response, tagging each with connId (#542)', async () => {
    const fetchImpl = makeOkFetch({
      conn1: {
        data: [],
        vlans: [
          { node: 'pve1', iface: 'vmbr0.10', tag: 10 },
          { node: 'pve1', iface: 'vmbr0.20', tag: 20 },
        ],
      } as any,
      conn2: {
        data: [],
        vlans: [
          { node: 'pve2', iface: 'bond0.7', tag: 7 },
        ],
      } as any,
    })

    const result = await fetchConnectionsNetworks(['conn1', 'conn2'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.vlans).toHaveLength(3)
    expect(result.vlans.every((v) => typeof v.connId === 'string')).toBe(true)
    expect(result.vlans.filter((v) => v.connId === 'conn1').map((v) => v.tag)).toEqual([10, 20])
    const conn2Vlans = result.vlans.filter((v) => v.connId === 'conn2')
    expect(conn2Vlans).toHaveLength(1)
    expect(conn2Vlans[0].node).toBe('pve2')
  })

  it('contributes no vlans from a failed connection', async () => {
    const fetchImpl = makeFailFetch('bad-conn', {
      'good-conn': {
        data: [],
        vlans: [{ node: 'pve1', iface: 'vmbr0.10', tag: 10 }],
      } as any,
    })

    const result = await fetchConnectionsNetworks(['good-conn', 'bad-conn'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.failedConnIds).toEqual(['bad-conn'])
    expect(result.vlans).toHaveLength(1)
    expect(result.vlans[0].connId).toBe('good-conn')
  })

  it('returns vlans: [] when the route response has no vlans field (backward compat)', async () => {
    const fetchImpl = makeOkFetch({
      conn1: { data: [] },
    })

    const result = await fetchConnectionsNetworks(['conn1'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.vlans).toEqual([])
  })

  it('returns vlans: [] immediately for empty connIds input', async () => {
    const result = await fetchConnectionsNetworks([], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: vi.fn() as any,
    })

    expect(result.vlans).toEqual([])
  })

  it('collects vnetAliases per connection into vnetAliasesByConn', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const match = /\/connections\/([^/]+)\/networks/.exec(url)
      const connId = match ? decodeURIComponent(match[1]) : '__unknown__'
      const bodies: Record<string, any> = {
        conn1: { data: [], bridges: [], vnetAliases: { v42fc503: 'Production LAN' } },
        conn2: { data: [], bridges: [], vnetAliases: { vaaaabbb: 'Dev Network' } },
      }
      const body = bodies[connId]
      if (!body) throw new Error(`Unexpected connId: ${connId}`)
      return new Response(JSON.stringify(body), { status: 200 })
    })

    const result = await fetchConnectionsNetworks(['conn1', 'conn2'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.vnetAliasesByConn).toEqual({
      conn1: { v42fc503: 'Production LAN' },
      conn2: { vaaaabbb: 'Dev Network' },
    })
  })

  it('sets vnetAliasesByConn[connId] to {} when route response omits vnetAliases (backward compat)', async () => {
    const fetchImpl = makeOkFetch({
      conn1: { data: [] },
    })

    const result = await fetchConnectionsNetworks(['conn1'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(result.vnetAliasesByConn).toEqual({ conn1: {} })
  })

  it('returns vnetAliasesByConn: {} immediately for empty connIds input', async () => {
    const result = await fetchConnectionsNetworks([], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: vi.fn() as any,
    })

    expect(result.vnetAliasesByConn).toEqual({})
  })

  it('does not include failed connections in vnetAliasesByConn', async () => {
    const fetchImpl = makeFailFetch('bad-conn', {
      'good-conn': { data: [] },
    })

    const result = await fetchConnectionsNetworks(['good-conn', 'bad-conn'], {
      retries: 0,
      retryDelayMs: 0,
      fetchImpl: fetchImpl as any,
    })

    expect(Object.keys(result.vnetAliasesByConn)).toEqual(['good-conn'])
    expect(result.failedConnIds).toContain('bad-conn')
  })

  it('threads sdnVnets from route response, tagging each with connId', async () => {
    const fetchImpl = makeOkFetch({
      conn1: { data: [], sdnVnets: [{ vnet: 'v42fc503', alias: 'lan', zone: 'z', zoneType: 'vxlan', tag: 10000 }] } as any,
      conn2: { data: [], sdnVnets: [{ vnet: 'vaaa', zone: 'z2', zoneType: 'vlan', tag: 30 }] } as any,
    })
    const result = await fetchConnectionsNetworks(['conn1', 'conn2'], { retries: 0, retryDelayMs: 0, fetchImpl: fetchImpl as any })
    expect(result.sdnVnets).toHaveLength(2)
    expect(result.sdnVnets.every((v) => typeof v.connId === 'string')).toBe(true)
    expect(result.sdnVnets.find((v) => v.vnet === 'v42fc503')?.connId).toBe('conn1')
    expect(result.sdnVnets.find((v) => v.vnet === 'vaaa')?.connId).toBe('conn2')
  })

  it('returns sdnVnets: [] when the route omits the field (back-compat) and for empty input', async () => {
    const r1 = await fetchConnectionsNetworks(['conn1'], { retries: 0, retryDelayMs: 0, fetchImpl: makeOkFetch({ conn1: { data: [] } }) as any })
    expect(r1.sdnVnets).toEqual([])
    const r2 = await fetchConnectionsNetworks([], { retries: 0, retryDelayMs: 0, fetchImpl: vi.fn() as any })
    expect(r2.sdnVnets).toEqual([])
  })

  it('contributes no sdnVnets from a failed connection', async () => {
    const fetchImpl = makeFailFetch('bad', { good: { data: [], sdnVnets: [{ vnet: 'v1', zone: 'z', zoneType: 'vxlan', tag: 5 }] } as any })
    const result = await fetchConnectionsNetworks(['good', 'bad'], { retries: 0, retryDelayMs: 0, fetchImpl: fetchImpl as any })
    expect(result.failedConnIds).toEqual(['bad'])
    expect(result.sdnVnets).toHaveLength(1)
    expect(result.sdnVnets[0].connId).toBe('good')
  })
})
