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
})
