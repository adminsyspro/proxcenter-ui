'use client'

import { useCallback, useEffect, useMemo } from 'react'
import {
  Background, ControlButton, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type AriaLabelConfig, type Edge, type EdgeMouseHandler, type Node, type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Box, alpha, useTheme, type Theme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { EdgeClickContext, FlowEdge } from './FlowEdge'
import { IpNode, ZoneBoxNode } from './MapBoxNodes'
import { BoundaryNode, GuestNode, MapActionsContext, MoreNode, UnzonedNode, ZoneNode, type MapActions } from './ZoneNode'
import { UNZONED_ID, type MapNodeData } from './zoneGraph'

const nodeTypes = { zone: ZoneNode, zoneBox: ZoneBoxNode, unzoned: UnzonedNode, guest: GuestNode, more: MoreNode, boundary: BoundaryNode, ip: IpNode }
const edgeTypes = { flow: FlowEdge }

/** What the fit-to-view follows: the top-level nodes (circles and boxes) and their size, which grows with the guests. */
export function fitKey(nodes: Node[]): string {
  return nodes.filter(n => !n.parentId).map(n => `${n.id}:${n.width ?? 0}`).join(',')
}

/** Above every edge (their z-index stays under 10) and every node: a label is never painted over by a line or a circle. */
export const LABEL_LAYER_Z = 1000

/**
 * The guests (and their "+N") sit above every edge but under the edge labels: their names are never painted over by a
 * line. The edges end on the border of a guest glyph, so raising the glyph hides no arrowhead.
 */
export const GUEST_LAYER_Z = 50

/** The look of the canvas: dimmed items, the label layer on top, the controls and the mini-map in the theme. */
export function canvasSx(theme: Theme) {
  return {
    width: '100%', height: '100%',
    '& .microseg-dim': { opacity: 0.25 },
    '& .react-flow__edgelabel-renderer': { zIndex: LABEL_LAYER_Z },
    // React Flow writes the z-index of a node inline: only !important lifts the guests above the edges.
    '& .react-flow__node-guest, & .react-flow__node-more': { zIndex: `${GUEST_LAYER_Z} !important` },
    '& .react-flow__node, & .react-flow__edge, & .react-flow__edgelabel-renderer > div': { transition: 'opacity 150ms' },
    '@media (prefers-reduced-motion: reduce)': { '& *': { transition: 'none !important' } },
    '& .react-flow__controls': { boxShadow: theme.shadows[1], borderRadius: 1, overflow: 'hidden' },
    '& .react-flow__controls-button': {
      bgcolor: 'background.paper', color: 'text.primary', borderBottom: `1px solid ${theme.palette.divider}`,
      '& svg': { fill: 'currentColor' }, '&:hover': { bgcolor: 'action.hover' },
    },
    '& .react-flow__minimap': { bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`, borderRadius: 1 },
  }
}

/**
 * The screen-reader texts React Flow brings are English and describe moving and deleting nodes, which this map does
 * not allow: every one of them goes through the catalog, and the description says what the keyboard really does.
 */
export function ariaLabels(t: (key: string, values?: Record<string, string | number>) => string): Partial<AriaLabelConfig> {
  return {
    'node.a11yDescription.default': t('a11y.nodeDescription'),
    'node.a11yDescription.keyboardDisabled': t('a11y.nodeDescriptionKeyboard'),
    'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) => t('a11y.nodeMoved', { direction, x, y }),
    'edge.a11yDescription.default': t('a11y.edgeDescription'),
    'controls.ariaLabel': t('controls'),
    'controls.zoomIn.ariaLabel': t('zoomIn'),
    'controls.zoomOut.ariaLabel': t('zoomOut'),
    'controls.fitView.ariaLabel': t('fitView'),
    'controls.interactive.ariaLabel': t('a11y.interactive'),
    'minimap.ariaLabel': t('minimap'),
    'handle.ariaLabel': t('a11y.handle'),
  }
}

type Props = {
  nodes: Node[]
  edges: Edge[]
  /** A zone circle (or its "+N" node) was clicked, or activated with the keyboard. */
  onSelectZone: (zoneId: string) => void
  /** A guest was clicked, or activated with the keyboard. */
  onSelectGuest: (nodeId: string) => void
  /** An edge (or its label) was clicked. */
  onSelectEdge: (edgeId: string) => void
  /** The pointer or the keyboard focus is on a node or an edge (null: on nothing). */
  onHover: (id: string | null) => void
  onFocusNode: (id: string | null) => void
  /** The canvas itself was clicked. */
  onClear: () => void
  /** The side panel is open: the canvas changes width, so it fits the graph again when this flips. */
  panelOpen?: boolean
  /** The nodes the view fits to instead of the whole graph (a targeted guest: its zone and its neighbours). */
  fitTo?: string[] | null
}

/** The options of a fit-to-view: the whole graph, or only the nodes asked for. */
export function fitOptions(fitTo: string[] | null | undefined) {
  const base = { padding: 0.1, duration: 300, maxZoom: 1 }
  return fitTo?.length ? { ...base, nodes: fitTo.map(id => ({ id })) } : base
}

function Canvas({ nodes, edges, onSelectZone, onSelectGuest, onSelectEdge, onHover, onFocusNode, onClear, panelOpen, fitTo }: Props) {
  const { fitView, zoomIn, zoomOut } = useReactFlow()
  const theme = useTheme()
  const t = useTranslations('microsegPilot.overview')
  const ariaLabelConfig = useMemo(() => ariaLabels(t), [t])
  // The wrapper of every node and edge carries a hard-coded English role description: the DOM attributes win over it.
  const nodeRole = t('a11y.nodeRole')
  const edgeRole = t('a11y.edgeRole')
  const labelledNodes = useMemo(
    () => nodes.map(n => ({ ...n, domAttributes: { ...n.domAttributes, 'aria-roledescription': nodeRole } })),
    [nodes, nodeRole],
  )
  const labelledEdges = useMemo(
    () => edges.map(e => ({ ...e, domAttributes: { ...e.domAttributes, 'aria-roledescription': edgeRole } })),
    [edges, edgeRole],
  )

  // Refit when the graph reshapes (a zone added, a circle grown once its guests are known), when the side panel
  // opens or closes, like the topology view, or when a guest is targeted (then on its zone and its neighbours).
  const shape = fitKey(nodes)
  const focusKey = fitTo?.join(',') ?? ''
  useEffect(() => {
    if (!shape) return
    const timer = setTimeout(() => { void fitView(fitOptions(focusKey ? focusKey.split(',') : null)) }, 100)
    return () => clearTimeout(timer)
  }, [shape, fitView, panelOpen, focusKey])

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const d = node.data as unknown as MapNodeData
    if (d.kind === 'zone') onSelectZone(d.zone.id)
    else if (d.kind === 'guest') onSelectGuest(node.id)
    else if (d.kind === 'more' && d.groupId !== UNZONED_ID) onSelectZone(d.groupId)
  }, [onSelectZone, onSelectGuest])
  const onEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => onSelectEdge(edge.id), [onSelectEdge])
  const onNodeMouseEnter: NodeMouseHandler = useCallback((_event, node) => onHover(node.id), [onHover])
  const onEdgeMouseEnter: EdgeMouseHandler = useCallback((_event, edge) => onHover(edge.id), [onHover])
  const leave = useCallback(() => onHover(null), [onHover])
  const actions = useMemo<MapActions>(() => ({ openZone: onSelectZone, selectGuest: onSelectGuest, setFocus: onFocusNode }), [onSelectZone, onSelectGuest, onFocusNode])

  const minimapColor = useCallback((node: Node) => {
    const d = node.data as unknown as MapNodeData
    if (d.kind === 'zone') return d.zone.color || theme.palette.text.disabled
    return d.kind === 'guest' || d.kind === 'more' ? theme.palette.text.secondary : theme.palette.text.disabled
  }, [theme])

  return (
    <MapActionsContext.Provider value={actions}>
      <EdgeClickContext.Provider value={onSelectEdge}>
        <Box sx={canvasSx(theme)}>
          <ReactFlow
            nodes={labelledNodes}
            edges={labelledEdges}
            ariaLabelConfig={ariaLabelConfig}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={leave}
            onEdgeMouseEnter={onEdgeMouseEnter}
            onEdgeMouseLeave={leave}
            onPaneClick={onClear}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            elevateNodesOnSelect={false}
            fitView
            fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            {/* Own buttons: the built-in ones carry English titles ("Zoom In", "Fit View") that cannot be translated. */}
            <Controls showZoom={false} showFitView={false} showInteractive={false} position='bottom-left' aria-label={t('controls')}>
              <ControlButton title={t('zoomIn')} aria-label={t('zoomIn')} onClick={() => { void zoomIn({ duration: 200 }) }}>
                <i className='ri-add-line' aria-hidden />
              </ControlButton>
              <ControlButton title={t('zoomOut')} aria-label={t('zoomOut')} onClick={() => { void zoomOut({ duration: 200 }) }}>
                <i className='ri-subtract-line' aria-hidden />
              </ControlButton>
              <ControlButton title={t('fitView')} aria-label={t('fitView')} onClick={() => { void fitView(fitOptions(fitTo)) }}>
                <i className='ri-fullscreen-line' aria-hidden />
              </ControlButton>
            </Controls>
            <MiniMap
              pannable
              zoomable
              position='bottom-right'
              ariaLabel={t('minimap')}
              nodeColor={minimapColor}
              nodeStrokeWidth={0}
              bgColor={theme.palette.background.paper}
              maskColor={alpha(theme.palette.text.primary, 0.08)}
              style={{ width: 160, height: 100 }}
            />
          </ReactFlow>
        </Box>
      </EdgeClickContext.Provider>
    </MapActionsContext.Provider>
  )
}

/** The React Flow canvas of the zone map: pan by drag, zoom, fit, mini-map; no dragging of nodes, no connecting. */
export default function ZoneCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
