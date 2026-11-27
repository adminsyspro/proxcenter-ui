import { test, expect } from 'vitest'
import { layoutGraph } from './layoutGraph'
import type { Node, Edge } from '@xyflow/react'

const nodes: Node[] = [
  { id: 'a', position: { x: 0, y: 0 }, data: { width: 100, height: 40 } },
  { id: 'b', position: { x: 0, y: 0 }, data: { width: 100, height: 40 } },
]
const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b' }]

test('default rankdir TB stacks vertically (b below a)', () => {
  const out = layoutGraph(nodes, edges)
  expect(out.nodes[1].position.y).toBeGreaterThan(out.nodes[0].position.y)
})

test('rankdir LR stacks horizontally (b right of a)', () => {
  const out = layoutGraph(nodes, edges, { rankdir: 'LR' })
  expect(out.nodes[1].position.x).toBeGreaterThan(out.nodes[0].position.x)
})
