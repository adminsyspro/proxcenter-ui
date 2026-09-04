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
})
