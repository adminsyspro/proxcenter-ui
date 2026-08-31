'use client'

import { useCallback, useEffect } from 'react'

import {
  Background,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { MsCardNodeData, MsFlowNodeData, MsVmNodeData } from './buildFlowGraph'
import { FlowEdge } from './FlowEdge'
import { FlowRuleNode, MicrosegCardNode, MicrosegLaneNode, MicrosegVmNode } from './MicrosegNodes'

const nodeTypes = {
  msVm: MicrosegVmNode,
  msFlow: FlowRuleNode,
  msCard: MicrosegCardNode,
  msLane: MicrosegLaneNode,
}

const edgeTypes = {
  flowEdge: FlowEdge,
}

interface EastWestCanvasProps {
  nodes: Node[]
  edges: Edge[]
  /** A VM card was clicked in one of the two columns. */
  onVmClick: (side: 'source' | 'dest', vmid: number) => void
  /** A connection card was clicked: open the rule behind it. */
  onFlowClick: (data: MsFlowNodeData) => void
  onAddRuleClick: () => void
  onPaneClick: () => void
}

/**
 * The east-west React Flow canvas: same interaction envelope as the topology
 * page (pan/zoom, fitView, click-to-select, non-editable graph), with the
 * micro-segmentation card set.
 */
export default function EastWestCanvas({ nodes, edges, onVmClick, onFlowClick, onAddRuleClick, onPaneClick }: EastWestCanvasProps) {
  const { fitView } = useReactFlow()

  // Refit when the graph reshapes (selection, search), like the topology view.
  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.15, duration: 300, maxZoom: 1 })
      }, 100)

      return () => clearTimeout(timer)
    }
  }, [nodes, fitView])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === 'msVm') {
        const data = node.data as unknown as MsVmNodeData

        onVmClick(data.side, data.vmid)
      } else if (node.type === 'msFlow') {
        onFlowClick(node.data as unknown as MsFlowNodeData)
      } else if (node.type === 'msCard' && (node.data as unknown as MsCardNodeData).variant === 'addRule') {
        onAddRuleClick()
      }
    },
    [onVmClick, onFlowClick, onAddRuleClick],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={0} />
    </ReactFlow>
  )
}
