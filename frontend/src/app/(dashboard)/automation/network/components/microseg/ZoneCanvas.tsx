'use client'

import { useCallback, useEffect } from 'react'
import { Background, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { FlowEdge } from './FlowEdge'
import { BoundaryNode, ZoneActivateContext, ZoneNode } from './ZoneNode'
import type { ZoneNodeData } from './zoneGraph'

const nodeTypes = { zone: ZoneNode, boundary: BoundaryNode }
const edgeTypes = { flow: FlowEdge }

type Props = {
  nodes: Node[]
  edges: Edge[]
  /** A zone node was clicked. */
  onSelectZone: (zoneId: string) => void
  /** The canvas itself was clicked. */
  onClear: () => void
  /** The side panel is open: the canvas changes width, so it fits the graph again when this flips. */
  panelOpen?: boolean
}

function Canvas({ nodes, edges, onSelectZone, onClear, panelOpen }: Props) {
  const { fitView } = useReactFlow()

  // Refit when the graph reshapes (a zone added) or when the side panel opens or closes, like the topology view.
  const shape = nodes.map(n => n.id).join(',')
  useEffect(() => {
    if (!shape) return
    const timer = setTimeout(() => { void fitView({ padding: 0.15, duration: 300, maxZoom: 1 }) }, 100)
    return () => clearTimeout(timer)
  }, [shape, fitView, panelOpen])

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'zone') onSelectZone((node.data as unknown as ZoneNodeData).zone.id)
  }, [onSelectZone])

  return (
    <ZoneActivateContext.Provider value={onSelectZone}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onClear}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
      </ReactFlow>
    </ZoneActivateContext.Provider>
  )
}

/** The React Flow canvas of the zone map: pan and zoom, no dragging, no connecting. */
export default function ZoneCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
