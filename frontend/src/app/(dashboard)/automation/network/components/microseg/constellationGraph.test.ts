import { describe, expect, it } from 'vitest'

import { buildConstellationGraph } from './constellationGraph'
import { demoInput, flow, seen, zone } from './mapViewsTestKit'
import { EXTERNAL_ID, OUTSIDE_ID, UNZONED_ID, zoneNodeId, type MapEdgeData, type MapNodeData, type ZoneNodeData } from './zoneGraph'

const data = (n: { data: unknown }) => n.data as MapNodeData
const edgeKinds = (graph: ReturnType<typeof buildConstellationGraph>) => graph.edges.map(e => `${(e.data as unknown as MapEdgeData).kind}:${e.source}>${e.target}`)

describe('the graph of the constellation', () => {
  it('draws a node per zone with its member count, the guests in no zone, and the boundaries the edges need', () => {
    const graph = buildConstellationGraph(demoInput())
    const ids = graph.nodes.map(n => n.id)
    expect(ids.filter(id => id.startsWith('zone:'))).toHaveLength(6)
    expect(ids).toContain(UNZONED_ID)
    expect(ids).toContain(EXTERNAL_ID)
    expect(ids).toContain(OUTSIDE_ID)
    const web = data(graph.nodes.find(n => n.id === zoneNodeId('zw'))!) as ZoneNodeData
    expect(web.members).toBe(8)
    expect(data(graph.nodes.find(n => n.id === UNZONED_ID)!)).toMatchObject({ kind: 'unzoned', count: 3 })
  })

  it('draws every flow zone to zone: allowed, observed, from a guest in no zone, from an unknown source', () => {
    const kinds = edgeKinds(buildConstellationGraph(demoInput()))
    expect(kinds).toContain('allowed:zone:zw>zone:za')
    expect(kinds).toContain('allowed:external>zone:zw')
    expect(kinds).toContain('unprotected:zone:zw>zone:zd')
    expect(kinds).toContain('blocked:zone:zc>zone:zd')
    // 10.9.0.1 is lost-1, a guest in no zone: its flow comes from the guests in no zone, not from Unknown / External.
    expect(kinds).toContain('unprotected:unzoned>zone:za')
    expect(kinds).toContain('blocked:external>zone:zw')
    expect(kinds.some(k => k.endsWith('>outside'))).toBe(true)
  })

  it('counts the observed flows inside a zone on its node, without an edge', () => {
    const input = { zones: [zone('za', 'a')], flows: [], suggestions: [seen('s1', { src_zone_id: 'za', dst_zone_id: 'za' }), seen('s2', { src_zone_id: 'za', dst_zone_id: 'za', status: 'accepted' })] }
    const graph = buildConstellationGraph(input)
    expect((data(graph.nodes[0]) as ZoneNodeData).inside).toBe(1)
    expect(graph.edges).toHaveLength(0)
  })

  it('draws no member count while the guests are unknown, no node for the guests in no zone, and no boundary nobody needs', () => {
    const graph = buildConstellationGraph({ zones: [zone('zw', 'web'), zone('zd', 'db')], flows: [flow('f1')], suggestions: [], unzoned: [] })
    expect(graph.nodes.map(n => n.id)).toEqual([zoneNodeId('zd'), zoneNodeId('zw')])
    expect((data(graph.nodes[0]) as ZoneNodeData).members).toBeNull()
    expect(edgeKinds(graph)).toEqual(['allowed:zone:zw>zone:zd'])
  })
})
