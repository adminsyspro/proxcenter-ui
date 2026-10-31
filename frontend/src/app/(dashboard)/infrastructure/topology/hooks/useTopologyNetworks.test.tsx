import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import type { InventoryCluster } from '../types'
import { useTopologyNetworks } from './useTopologyNetworks'

const NETWORKS_URL = '*/api/v1/vms/networks'

const CONN = 'cmtk6hu1r00007zjlo0kto72x'
const KEY = `${CONN}:qemu:pve2-dr:100`

const clusters: InventoryCluster[] = [
  {
    id: CONN,
    name: 'PVE-DR',
    type: 'pve',
    isCluster: true,
    status: 'online',
    nodes: [
      {
        node: 'pve2-dr',
        status: 'online',
        guests: [
          { vmid: 100, name: 'Debian13', status: 'stopped', type: 'qemu', node: 'pve2-dr' },
          { vmid: '101', name: 'ct-web', status: 'running', type: 'lxc', node: 'pve2-dr' },
        ],
      },
      { node: 'pve3-dr', status: 'online', guests: [] },
    ],
  },
]

const vnetSegment = {
  key: 'vnet-tv1',
  label: 'VLAN 137',
  vlan: 137,
  tag: 137,
  bridgeLabel: 'prod-lan',
  vnet: 'tv1',
  zone: 'tzvl1',
  zoneType: 'vlan',
}

/** Serve one payload and capture the bodies the hook posted. */
function serve(payload: unknown): { bodies: any[] } {
  const bodies: any[] = []

  server.use(
    http.post(NETWORKS_URL, async ({ request }) => {
      bodies.push(await request.json())

      return HttpResponse.json(payload)
    }),
  )

  return { bodies }
}

afterEach(() => {
  cleanup()
})

describe('useTopologyNetworks', () => {
  it('does not call the API while disabled', async () => {
    const { bodies } = serve({ data: {} })

    const { result } = renderHook(() => useTopologyNetworks(clusters, false))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(bodies).toHaveLength(0)
    expect(result.current.networkMap.size).toBe(0)
  })

  it('does not call the API when there is no connection', async () => {
    const { bodies } = serve({ data: {} })

    renderHook(() => useTopologyNetworks([], true))

    await waitFor(() => expect(bodies).toHaveLength(0))
  })

  it('does not call the API when no node holds a guest', async () => {
    const { bodies } = serve({ data: {} })
    const empty: InventoryCluster[] = [{ ...clusters[0], nodes: [{ node: 'pve3-dr', status: 'online', guests: [] }] }]

    renderHook(() => useTopologyNetworks(empty, true))

    await waitFor(() => expect(bodies).toHaveLength(0))
  })

  it('posts every guest of every node, vmid coerced to a string', async () => {
    const { bodies } = serve({ data: {} })

    renderHook(() => useTopologyNetworks(clusters, true))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      vms: [
        { connId: CONN, type: 'qemu', node: 'pve2-dr', vmid: '100' },
        { connId: CONN, type: 'lxc', node: 'pve2-dr', vmid: '101' },
      ],
    })
  })

  it('keeps the segment the server resolved', async () => {
    serve({
      data: {
        [KEY]: { networks: [{ bridge: 'tv1', vlanTag: null, ip: '10.42.0.37', cidr: 24, segment: vnetSegment }] },
      },
    })

    const { result } = renderHook(() => useTopologyNetworks(clusters, true))

    await waitFor(() => expect(result.current.networkMap.size).toBe(1))
    expect(result.current.networkMap.get(KEY)).toEqual([
      { bridge: 'tv1', vlanTag: null, ip: '10.42.0.37', cidr: 24, segment: vnetSegment },
    ])
    expect(result.current.loading).toBe(false)
  })

  it('rebuilds a segment from the tag when the payload carries none', async () => {
    serve({
      data: {
        [KEY]: { networks: [{ bridge: 'vmbr0', vlanTag: 99 }, { bridge: 'vmbr0' }, {}] },
      },
    })

    const { result } = renderHook(() => useTopologyNetworks(clusters, true))

    await waitFor(() => expect(result.current.networkMap.size).toBe(1))
    expect(result.current.networkMap.get(KEY)).toEqual([
      {
        bridge: 'vmbr0',
        vlanTag: 99,
        ip: null,
        cidr: null,
        segment: { key: 'vlan-99', label: 'VLAN 99', vlan: 99, tag: 99, bridgeLabel: 'vmbr0' },
      },
      {
        bridge: 'vmbr0',
        vlanTag: null,
        ip: null,
        cidr: null,
        segment: { key: 'no-vlan', label: 'No VLAN', vlan: null, tag: null, bridgeLabel: 'vmbr0' },
      },
      {
        bridge: 'unknown',
        vlanTag: null,
        ip: null,
        cidr: null,
        segment: { key: 'no-vlan', label: 'No VLAN', vlan: null, tag: null, bridgeLabel: 'unknown' },
      },
    ])
  })

  it('tolerates a guest entry without a networks array', async () => {
    serve({ data: { [KEY]: {} } })

    const { result } = renderHook(() => useTopologyNetworks(clusters, true))

    await waitFor(() => expect(result.current.networkMap.size).toBe(1))
    expect(result.current.networkMap.get(KEY)).toEqual([])
  })

  it('tolerates a response with no data at all', async () => {
    serve({})

    const { result } = renderHook(() => useTopologyNetworks(clusters, true))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.networkMap.size).toBe(0)
  })

  it('clears the map when the request fails', async () => {
    server.use(http.post(NETWORKS_URL, () => HttpResponse.error()))

    const { result } = renderHook(() => useTopologyNetworks(clusters, true))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.networkMap.size).toBe(0)
  })

  it('drops the map when the view is disabled, and refetches when enabled again', async () => {
    const { bodies } = serve({
      data: { [KEY]: { networks: [{ bridge: 'tv1', vlanTag: null, segment: vnetSegment }] } },
    })

    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useTopologyNetworks(clusters, on),
      { initialProps: { on: true } },
    )

    await waitFor(() => expect(result.current.networkMap.size).toBe(1))

    rerender({ on: false })
    await waitFor(() => expect(result.current.networkMap.size).toBe(0))

    rerender({ on: true })
    await waitFor(() => expect(bodies).toHaveLength(2))
  })

  describe('inventory refresh while enabled', () => {
    const KEY_101 = `${CONN}:lxc:pve2-dr:101`

    /** Echo one NIC per requested guest, keyed like the server does. */
    function echo(): { bodies: any[] } {
      const bodies: any[] = []

      server.use(
        http.post(NETWORKS_URL, async ({ request }) => {
          const body: any = await request.json()

          bodies.push(body)
          const data: Record<string, unknown> = {}

          for (const vm of body.vms) {
            data[`${vm.connId}:${vm.type}:${vm.node}:${vm.vmid}`] = { networks: [{ bridge: `br-${vm.vmid}`, vlanTag: null }] }
          }

          return HttpResponse.json({ data })
        }),
      )

      return { bodies }
    }

    const withGuests = (guests: InventoryCluster['nodes'][number]['guests'], node = 'pve2-dr'): InventoryCluster[] => [
      { ...clusters[0], nodes: [{ node, status: 'online', guests }, { node: 'pve3-dr', status: 'online', guests: [] }] },
    ]

    it('asks only for a guest that appeared, keeping the guests already known', async () => {
      const { bodies } = echo()
      const first = withGuests([clusters[0].nodes[0].guests[0]])

      const { result, rerender } = renderHook(({ c }: { c: InventoryCluster[] }) => useTopologyNetworks(c, true), {
        initialProps: { c: first },
      })

      await waitFor(() => expect(result.current.networkMap.size).toBe(1))

      rerender({ c: withGuests(clusters[0].nodes[0].guests) })

      await waitFor(() => expect(result.current.networkMap.size).toBe(2))
      expect(bodies).toHaveLength(2)
      expect(bodies[1]).toEqual({ vms: [{ connId: CONN, type: 'lxc', node: 'pve2-dr', vmid: '101' }] })
      expect(result.current.networkMap.get(KEY)?.[0].bridge).toBe('br-100')
      expect(result.current.networkMap.get(KEY_101)?.[0].bridge).toBe('br-101')
    })

    it('does not call the API again when a refresh keeps the same guests', async () => {
      const { bodies } = echo()

      const { result, rerender } = renderHook(({ c }: { c: InventoryCluster[] }) => useTopologyNetworks(c, true), {
        initialProps: { c: clusters },
      })

      await waitFor(() => expect(result.current.networkMap.size).toBe(2))

      // A new inventory answer: same guests, other live metrics, new identities.
      rerender({ c: withGuests(clusters[0].nodes[0].guests.map(g => ({ ...g, cpu: 0.5 }))) })
      rerender({ c: withGuests(clusters[0].nodes[0].guests.map(g => ({ ...g, cpu: 0.7 }))) })

      await new Promise(r => setTimeout(r, 50))
      expect(bodies).toHaveLength(1)
      expect(result.current.networkMap.size).toBe(2)
    })

    it('forgets a guest that left the inventory without calling the API', async () => {
      const { bodies } = echo()

      const { result, rerender } = renderHook(({ c }: { c: InventoryCluster[] }) => useTopologyNetworks(c, true), {
        initialProps: { c: clusters },
      })

      await waitFor(() => expect(result.current.networkMap.size).toBe(2))

      rerender({ c: withGuests([clusters[0].nodes[0].guests[0]]) })

      await waitFor(() => expect(result.current.networkMap.size).toBe(1))
      expect(result.current.networkMap.has(KEY_101)).toBe(false)
      expect(bodies).toHaveLength(1)
    })

    it('asks again for a guest that migrated to another node', async () => {
      const { bodies } = echo()

      const { result, rerender } = renderHook(({ c }: { c: InventoryCluster[] }) => useTopologyNetworks(c, true), {
        initialProps: { c: withGuests([clusters[0].nodes[0].guests[0]]) },
      })

      await waitFor(() => expect(result.current.networkMap.size).toBe(1))

      rerender({ c: withGuests([{ ...clusters[0].nodes[0].guests[0], node: 'pve3-dr' }], 'pve3-dr') })

      await waitFor(() => expect(result.current.networkMap.has(`${CONN}:qemu:pve3-dr:100`)).toBe(true))
      expect(result.current.networkMap.has(KEY)).toBe(false)
      expect(bodies[1]).toEqual({ vms: [{ connId: CONN, type: 'qemu', node: 'pve3-dr', vmid: '100' }] })
    })

    it('does not re-issue a request still in flight when the inventory refreshes meanwhile', async () => {
      const bodies: any[] = []
      let release: () => void = () => {}
      const gate = new Promise<void>(r => { release = r })

      server.use(
        http.post(NETWORKS_URL, async ({ request }) => {
          bodies.push(await request.json())
          await gate

          return HttpResponse.json({ data: { [KEY]: { networks: [{ bridge: 'tv1', vlanTag: null, segment: vnetSegment }] } } })
        }),
      )

      const { result, rerender } = renderHook(({ c }: { c: InventoryCluster[] }) => useTopologyNetworks(c, true), {
        initialProps: { c: clusters },
      })

      await waitFor(() => expect(bodies).toHaveLength(1))
      rerender({ c: withGuests(clusters[0].nodes[0].guests.map(g => ({ ...g, cpu: 0.2 }))) })
      release()

      await waitFor(() => expect(result.current.networkMap.size).toBe(1))
      expect(bodies).toHaveLength(1)
      expect(result.current.loading).toBe(false)
    })

    it('asks again, on the next refresh, for guests whose request failed', async () => {
      let fail = true
      const bodies: any[] = []

      server.use(
        http.post(NETWORKS_URL, async ({ request }) => {
          bodies.push(await request.json())
          if (fail) return HttpResponse.error()

          return HttpResponse.json({ data: { [KEY]: { networks: [{ bridge: 'tv1', vlanTag: null, segment: vnetSegment }] } } })
        }),
      )

      const { result, rerender } = renderHook(({ c }: { c: InventoryCluster[] }) => useTopologyNetworks(c, true), {
        initialProps: { c: clusters },
      })

      await waitFor(() => expect(bodies).toHaveLength(1))
      await waitFor(() => expect(result.current.loading).toBe(false))
      fail = false
      rerender({ c: withGuests(clusters[0].nodes[0].guests.map(g => ({ ...g, cpu: 0.3 }))) })

      await waitFor(() => expect(result.current.networkMap.size).toBe(1))
      expect(bodies).toHaveLength(2)
    })
  })
})
