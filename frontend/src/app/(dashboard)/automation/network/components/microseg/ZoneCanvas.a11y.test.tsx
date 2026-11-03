/**
 * The screen-reader texts of the map come from the catalog, not from React Flow: its own are English and describe
 * moving and deleting nodes, which this map does not allow.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'

vi.mock('@xyflow/react/dist/style.css', () => ({}))

const received: { props: Record<string, any> | null } = { props: null }
vi.mock('@xyflow/react', async () => {
  const base = (await import('./xyflowTestMock')).xyflowMock
  return {
    ...base,
    ReactFlow: (props: Record<string, any>) => { received.props = props; return null },
  }
})

import ZoneCanvas, { ariaLabels } from './ZoneCanvas'

const nodes: Node[] = [{ id: 'zone:zw', position: { x: 0, y: 0 }, data: {} }]
const edges: Edge[] = [{ id: 'e1', source: 'zone:zw', target: 'zone:zd' }]
const noop = () => undefined

function render(locale: string, messages: Record<string, unknown>) {
  received.props = null
  renderWithProviders(
    <ZoneCanvas nodes={nodes} edges={edges} onSelectZone={noop} onSelectGuest={noop} onSelectEdge={noop} onHover={noop} onFocusNode={noop} onClear={noop} />,
    { locale, messages },
  )
  return received.props as Record<string, any>
}

describe('zone map screen-reader texts', () => {
  it('hands the translated default description to React Flow', () => {
    const config = render('en', en as Record<string, unknown>).ariaLabelConfig
    expect(config['node.a11yDescription.default']).toBe('Press enter or space to open its details.')
    expect(config['edge.a11yDescription.default']).toBe('Press enter or space to open the details of this flow.')
    expect(config['controls.zoomIn.ariaLabel']).toBe('Zoom in')
    expect(config['minimap.ariaLabel']).toBe('Overview of the map')
    expect(config['node.a11yDescription.ariaLiveMessage']({ direction: 'left', x: 1, y: 2 })).toContain('left')
  })

  it('has French texts, and none of the English defaults is left', () => {
    const props = render('fr', fr as Record<string, unknown>)
    const config = props.ariaLabelConfig
    expect(config['node.a11yDescription.default']).toBe('Appuyez sur Entrée ou Espace pour ouvrir ses détails.')
    expect(config['edge.a11yDescription.default']).toContain('flux')
    for (const key of ['controls.ariaLabel', 'controls.zoomIn.ariaLabel', 'controls.zoomOut.ariaLabel', 'controls.fitView.ariaLabel', 'controls.interactive.ariaLabel', 'minimap.ariaLabel', 'handle.ariaLabel']) {
      expect(typeof config[key], key).toBe('string')
    }
    expect(Object.keys(config).sort()).toEqual(Object.keys(ariaLabels((key: string) => key)).sort())
    expect(props.nodes[0].domAttributes['aria-roledescription']).toBe('élément de la carte')
    expect(props.edges[0].domAttributes['aria-roledescription']).toBe('flux')
  })
})
