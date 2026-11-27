'use client'
import { useMemo, useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { buildK8sTopologyGraph } from '@/lib/k8s/buildK8sTopologyGraph'
import type { K8sTopologyData, DetailRef } from '@/lib/k8s/topologyTypes'
import { AppGroupBox } from './topologyNodes/AppGroupBox'
import { ProxmoxHostBox } from './topologyNodes/ProxmoxHostBox'
import { WorkloadCard } from './topologyNodes/WorkloadCard'
import { K8sNodeCard } from './topologyNodes/K8sNodeCard'

const nodeTypes = {
  appGroup: AppGroupBox,
  proxmoxHost: ProxmoxHostBox,
  deployment: WorkloadCard,
  statefulset: WorkloadCard,
  daemonset: WorkloadCard,
  job: WorkloadCard,
  cronjob: WorkloadCard,
  replicaset: WorkloadCard,
  service: WorkloadCard,
  ingress: WorkloadCard,
  configmap: WorkloadCard,
  podGroup: WorkloadCard,
  pod: WorkloadCard,
  k8sNode: K8sNodeCard,
} as const

interface K8sTopologyCanvasProps {
  data: K8sTopologyData
  onDetailRef: (ref: DetailRef, kindStr: string) => void
}

function CanvasInner({ data, onDetailRef }: K8sTopologyCanvasProps) {
  const { fitView } = useReactFlow()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { nodes: baseNodes, edges: baseEdges } = useMemo(
    () => buildK8sTopologyGraph(data),
    [data],
  )

  // Placement edges (podGroup -> k8s node) stay hidden until the pod group or
  // the node they touch is selected, then they reveal to show where pods run.
  const edges: Edge[] = useMemo(
    () =>
      baseEdges.map((e) => {
        if (String(e.id).startsWith('placement-')) {
          const revealed = !!selectedId && (e.source === selectedId || e.target === selectedId)
          return { ...e, hidden: !revealed }
        }
        return e
      }),
    [baseEdges, selectedId],
  )

  useEffect(() => {
    if (baseNodes.length > 0) {
      const t = setTimeout(() => {
        fitView({ padding: 0.15, duration: 300, maxZoom: 1 })
      }, 120)
      return () => clearTimeout(t)
    }
  }, [baseNodes, fitView])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      // Select the node so its placement links (if any) reveal.
      setSelectedId(node.id)
      const nodeData = node.data as any
      if (nodeData.detailRef) {
        const ref = nodeData.detailRef as DetailRef
        // Use the detailRef's own kind (e.g. 'node', 'deployment') not the
        // node type string ('k8sNode', 'podGroup') which kindByApiKind won't resolve.
        onDetailRef(ref, ref.kind)
      }
    },
    [onDetailRef],
  )

  const onPaneClick = useCallback(() => setSelectedId(null), [])

  return (
    <ReactFlow
      nodes={baseNodes}
      edges={edges}
      nodeTypes={nodeTypes as any}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.05}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={0} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export function K8sTopologyCanvas(props: K8sTopologyCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
