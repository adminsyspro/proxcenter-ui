/**
 * The glyph of a connection in the cluster chip of the Settings and in the label of a selector entry: the page's
 * read is shared through the context, so neither reads the node lists again.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import ClusterChip from './ClusterChip'
import { ConnectionKindsContext, ConnectionsLabel, type ConnectionKind } from './ConnectionGlyph'

afterEach(cleanup)

const KINDS: Record<string, ConnectionKind> = {
  c1: { kind: 'cluster', status: 'online' },
  c2: { kind: 'node', status: 'offline' },
}

describe('ClusterChip glyph', () => {
  it('heads the full chip with the glyph of its cluster or standalone node, without reading anything', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderWithProviders(
      <ConnectionKindsContext.Provider value={KINDS}>
        <ClusterChip connectionId='c1' name='PVE-PROD' />
        <ClusterChip connectionId='c2' name='LAB' note='applies at the next application' noteIcon />
      </ConnectionKindsContext.Provider>,
    )
    expect(screen.getByTestId('connection-glyph-cluster-dot').dataset.status).toBe('online')
    expect(screen.getByTestId('connection-glyph-node-dot').dataset.status).toBe('offline')
    // The pending clock stays next to the glyph.
    expect(screen.getByRole('img', { name: 'applies at the next application' })).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('heads a compact chip too, stays neutral whatever the connection, and shows an unknown state outside the page', () => {
    renderWithProviders(<><ClusterChip connectionId='c1' name='PVE-PROD' compact /><ClusterChip connectionId='c2' name='LAB' /></>)
    const dots = screen.getAllByTestId('connection-glyph-cluster-dot')
    expect(dots.map(d => d.dataset.status)).toEqual(['unknown', 'unknown'])
    const [first, second] = [screen.getByTitle('PVE-PROD'), screen.getByTitle('LAB')].map(chip => getComputedStyle(chip))
    expect(first.borderColor).toBe(second.borderColor)
    expect(first.color).toBe(second.color)
  })
})

describe('ConnectionsLabel', () => {
  it('names each connection of a shared policy with its glyph, joined by a plus', () => {
    renderWithProviders(<ConnectionsLabel connections={[{ id: 'c2', name: 'LAB' }, { id: 'c1', name: 'PVE-PROD' }]} kinds={KINDS} title='LAB + PVE-PROD' />)
    const label = screen.getByTitle('LAB + PVE-PROD')
    expect(label.textContent).toBe('LAB + PVE-PROD')
    expect(within(label).getByTestId('connection-glyph-node')).toBeTruthy()
    expect(within(label).getByTestId('connection-glyph-cluster')).toBeTruthy()
  })

  it('names the first two connections of a large group and counts the others, the full list on hover', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `PVE-${i}` }))
    const full = eight.map(c => c.name).join(' + ')
    renderWithProviders(<ConnectionsLabel connections={eight} kinds={{}} title={full} />)
    const label = screen.getByTitle(full)
    expect(label.textContent).toBe('PVE-0 + PVE-1 +6')
    expect(within(label).getAllByTestId('connection-glyph-cluster')).toHaveLength(2)
  })
})
