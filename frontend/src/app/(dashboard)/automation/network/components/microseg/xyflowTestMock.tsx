/**
 * A stand-in for @xyflow/react in jsdom, where the real canvas measures nothing
 * and draws no edge. It renders the nodes and edges through the real custom
 * components (nodeTypes, edgeTypes) with their class names, a click on a node
 * or an edge calls onNodeClick / onEdgeClick, the pointer entering or leaving
 * them calls the hover handlers, a click on the canvas calls onPaneClick, and
 * the edge labels go through a portal like the real EdgeLabelRenderer does.
 */

import type { ComponentType, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { vi } from 'vitest'

type AnyProps = Record<string, any>

/** The fit-to-view the canvas asks for, to check when it refits. */
export const fitView = vi.fn(() => Promise.resolve(true))
/** The zoom buttons of the canvas. */
export const zoomIn = vi.fn(() => Promise.resolve(true))
export const zoomOut = vi.fn(() => Promise.resolve(true))

export function ReactFlowMock({ nodes, edges, nodeTypes, edgeTypes, onNodeClick, onPaneClick, onEdgeClick, onNodeMouseEnter, onNodeMouseLeave, onEdgeMouseEnter, onEdgeMouseLeave, children }: AnyProps) {
  return (
    <div data-testid='flow' onClick={() => onPaneClick?.()}>
      {nodes.map((n: AnyProps) => {
        const Node = (nodeTypes as Record<string, ComponentType<AnyProps>>)[n.type]
        return (
          <div
            key={n.id}
            data-testid={`node-${n.id}`}
            data-parent={n.parentId ?? ''}
            className={n.className ?? ''}
            data-focusable={String(n.focusable)}
            onClick={e => { e.stopPropagation(); onNodeClick?.(e, n) }}
            onMouseEnter={e => onNodeMouseEnter?.(e, n)}
            onMouseLeave={e => onNodeMouseLeave?.(e, n)}
          >
            <Node id={n.id} data={n.data} selected={!!n.selected} />
          </div>
        )
      })}
      <svg>
        {edges.map((e: AnyProps) => {
          const Edge = (edgeTypes as Record<string, ComponentType<AnyProps>>)[e.type]
          return (
            <g
              key={e.id}
              data-testid={`edge-${e.id}`}
              className={e.className ?? ''}
              aria-label={e.ariaLabel}
              data-focusable={String(e.focusable)}
              onClick={ev => { ev.stopPropagation(); onEdgeClick?.(ev, e) }}
              onMouseEnter={ev => onEdgeMouseEnter?.(ev, e)}
              onMouseLeave={ev => onEdgeMouseLeave?.(ev, e)}
            >
              <Edge id={e.id} source={e.source} target={e.target} sourceX={0} sourceY={0} targetX={400} targetY={0} data={e.data} style={e.style} markerEnd='url(#arrow)' />
            </g>
          )
        })}
      </svg>
      {children}
    </div>
  )
}

export const xyflowMock = {
  ReactFlow: ReactFlowMock,
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: ({ children, 'aria-label': label }: AnyProps) => <div data-testid='flow-controls' aria-label={label}>{children}</div>,
  ControlButton: ({ children, ...props }: AnyProps) => <button type='button' {...props}>{children}</button>,
  MiniMap: () => <div data-testid='flow-minimap' />,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  useReactFlow: () => ({ fitView, zoomIn, zoomOut }),
  BaseEdge: ({ id, path, style, className }: AnyProps) => <path data-testid={`path-${id}`} d={path} className={className} data-stroke={style?.stroke} data-dash={style?.strokeDasharray ?? ''} />,
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => createPortal(children, document.body),
}
