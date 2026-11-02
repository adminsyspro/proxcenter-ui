/**
 * A stand-in for @xyflow/react in jsdom, where the real canvas measures nothing
 * and draws no edge. It renders the nodes and edges through the real custom
 * components (nodeTypes, edgeTypes), a click on a node calls onNodeClick, a
 * click on the canvas calls onPaneClick, and the edge labels go through a
 * portal like the real EdgeLabelRenderer does.
 */

import type { ComponentType, ReactNode } from 'react'
import { createPortal } from 'react-dom'

type AnyProps = Record<string, any>

export function ReactFlowMock({ nodes, edges, nodeTypes, edgeTypes, onNodeClick, onPaneClick }: AnyProps) {
  return (
    <div data-testid='flow' onClick={() => onPaneClick?.()}>
      {nodes.map((n: AnyProps) => {
        const Node = (nodeTypes as Record<string, ComponentType<AnyProps>>)[n.type]
        return (
          <div key={n.id} data-testid={`node-${n.id}`} onClick={e => { e.stopPropagation(); onNodeClick?.(e, n) }}>
            <Node id={n.id} data={n.data} selected={!!n.selected} />
          </div>
        )
      })}
      <svg>
        {edges.map((e: AnyProps) => {
          const Edge = (edgeTypes as Record<string, ComponentType<AnyProps>>)[e.type]
          return (
            <g key={e.id} data-testid={`edge-${e.id}`}>
              <Edge id={e.id} source={e.source} target={e.target} sourceX={0} sourceY={0} targetX={400} targetY={0} data={e.data} style={e.style} markerEnd='url(#arrow)' />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export const xyflowMock = {
  ReactFlow: ReactFlowMock,
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Background: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  useReactFlow: () => ({ fitView: () => Promise.resolve(true) }),
  BaseEdge: ({ id, path, style }: AnyProps) => <path data-testid={`path-${id}`} d={path} data-stroke={style?.stroke} data-dash={style?.strokeDasharray ?? ''} />,
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => createPortal(children, document.body),
}
