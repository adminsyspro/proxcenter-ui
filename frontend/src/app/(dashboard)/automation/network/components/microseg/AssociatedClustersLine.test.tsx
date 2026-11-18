/**
 * The "Associated clusters" line of the Settings: the chips of the group, the add button and its limits, and the
 * list a chip of a shared policy opens, where each cluster has its remove icon.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegCluster } from '@/lib/microseg/types'

import AssociatedClustersLine from './AssociatedClustersLine'

afterEach(cleanup)

const cluster = (connection_id: string, active = true): MicrosegCluster =>
  ({ connection_id, active, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })
const NAMES: Record<string, string> = { c1: 'PVE-PROD', c2: 'PVE-DR' }

function show(clusters: MicrosegCluster[], props: Partial<Parameters<typeof AssociatedClustersLine>[0]> = {}) {
  const handlers = { onAdd: vi.fn(), onRemove: vi.fn() }
  renderWithProviders(
    <AssociatedClustersLine connectionId='c1' clusters={clusters} max={8} candidateCount={1} clusterName={id => NAMES[id] ?? id} {...handlers} {...props} />,
  )
  return handlers
}

const FOUR: Record<string, string> = { c1: 'PVE-1', c2: 'PVE-2', c3: 'PVE-3', c4: 'PVE-4' }
const openList = () => fireEvent.click(screen.getByTestId('associated-clusters').querySelector('.MuiChip-root') as HTMLElement)
const addButton = () => screen.getByRole('button', { name: 'Add a cluster' }) as HTMLButtonElement

describe('AssociatedClustersLine', () => {
  it('shows only the chip of a single cluster, without a remove icon', () => {
    show([cluster('c1')])
    expect(screen.getByText('Associated clusters')).toBeTruthy()
    expect(screen.getByText('PVE-PROD')).toBeTruthy()
    expect(screen.queryByLabelText(/^Dissociate/)).toBeNull()
    expect(screen.queryByText(/next application/)).toBeNull()
    expect(addButton().disabled).toBe(false)
  })

  it('offers to remove each cluster of a shared policy and says when an inactive one applies', () => {
    const { onRemove, onAdd } = show([cluster('c1'), cluster('c2', false)])
    // The note is an icon on the chip (its name on hover), so the two names keep the room of the line.
    expect(screen.getByRole('img', { name: 'applies at the next application' })).toBeTruthy()
    // The remove icons are in the list a chip opens, so the chips keep their room for the names.
    expect(screen.queryByLabelText(/^Dissociate/)).toBeNull()
    openList()
    expect(screen.getByLabelText('Dissociate PVE-PROD')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Dissociate PVE-DR'))
    expect(onRemove).toHaveBeenCalledWith('c2')
    fireEvent.click(addButton())
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('disables the add button at the maximum the backend gives, with the reason', () => {
    const many = Array.from({ length: 8 }, (_, i) => cluster(`c${i}`))
    show(many)
    expect(addButton().disabled).toBe(true)
    expect(screen.getByLabelText('A policy takes at most 8 clusters.')).toBeTruthy()
  })

  it('takes the maximum from the backend, not a fixed number', () => {
    show([cluster('c1'), cluster('c2')], { max: 2 })
    expect(addButton().disabled).toBe(true)
  })

  it('disables the add button when no other cluster can be associated', () => {
    show([cluster('c1')], { candidateCount: 0 })
    expect(addButton().disabled).toBe(true)
    expect(screen.getByLabelText('No other cluster to associate.')).toBeTruthy()
  })
})

describe('AssociatedClustersLine on one line', () => {
  const four = () => show([cluster('c1'), cluster('c2'), cluster('c3'), cluster('c4', false)], { clusterName: id => FOUR[id] })

  it('never wraps: the first chip of a large group, then a "+N" chip, then the add button', () => {
    four()
    const line = screen.getByTestId('associated-clusters')
    expect(getComputedStyle(line).flexWrap).toBe('nowrap')
    expect(screen.getByText('PVE-1')).toBeTruthy()
    expect(screen.queryByText('PVE-2')).toBeNull()
    const more = screen.getByRole('button', { name: '+3' })
    expect(more.compareDocumentPosition(addButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('names the hidden clusters in the tooltip of the "+N" chip', async () => {
    four()
    fireEvent.mouseOver(screen.getByRole('button', { name: '+3' }))
    expect(await screen.findByText('PVE-2, PVE-3, PVE-4')).toBeTruthy()
  })

  it('lists every cluster on its own line from the "+N" chip, with its remove icon', () => {
    const { onRemove } = four()
    const more = screen.getByRole('button', { name: '+3' })
    expect(more.getAttribute('aria-haspopup')).toBe('true')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const rows = screen.getAllByTestId('associated-cluster-row')
    expect(rows.map(r => r.textContent)).toEqual(['PVE-1', 'PVE-2', 'PVE-3', 'PVE-4applies at the next application'])
    // Each line is headed by the glyph of its cluster or standalone node.
    for (const row of rows) expect((row.firstElementChild as HTMLElement).dataset.testid).toBe('connection-glyph-cluster')
    fireEvent.click(screen.getByRole('button', { name: 'Dissociate PVE-4' }))
    expect(onRemove).toHaveBeenCalledWith('c4')
  })

  it('makes a chip a button only on a shared policy, where it opens the list', () => {
    show([cluster('c1'), cluster('c2')])
    expect(screen.queryAllByTestId('associated-cluster-row')).toHaveLength(0)
    openList()
    expect(screen.getAllByTestId('associated-cluster-row').map(r => r.textContent)).toEqual(['PVE-PROD', 'PVE-DR'])
    cleanup()
    show([cluster('c1')])
    expect(screen.getByTestId('associated-clusters').querySelector('.MuiChip-clickable')).toBeNull()
  })
})

describe('AssociatedClustersLine with a cluster the user cannot see', () => {
  it('names it in general words, never by its ID, and offers no remove action for it', () => {
    show([cluster('c1'), cluster('c9')])
    const line = screen.getByTestId('associated-clusters')
    expect(screen.getByText('Another cluster')).toBeTruthy()
    expect(line.textContent).not.toContain('c9')
    expect(line.innerHTML).not.toMatch(/\bc9\b/)
    openList()
    expect(screen.getByLabelText('Dissociate PVE-PROD')).toBeTruthy()
    expect(screen.queryAllByLabelText(/^Dissociate/).map(e => e.getAttribute('aria-label'))).toEqual(['Dissociate PVE-PROD'])
  })

  it('names it in general words in the tooltip and the list of the "+N" chip, without its remove icon', async () => {
    const { onRemove } = show([cluster('c1'), cluster('c2'), cluster('c8'), cluster('c9')])
    const more = screen.getByRole('button', { name: '+3' })
    fireEvent.mouseOver(more)
    expect(await screen.findByText('PVE-DR, Another cluster, Another cluster')).toBeTruthy()
    fireEvent.click(more)
    const rows = screen.getAllByTestId('associated-cluster-row')
    expect(rows.map(r => r.textContent)).toEqual(['PVE-PROD', 'PVE-DR', 'Another cluster', 'Another cluster'])
    expect(rows.map(r => r.querySelectorAll('button').length)).toEqual([1, 1, 0, 0])
    // Word boundaries: the generated class names of the styles may hold the same letters.
    for (const row of rows) expect(row.innerHTML).not.toMatch(/\bc[89]\b/)
    expect(onRemove).not.toHaveBeenCalled()
  })
})

describe('AssociatedClustersLine names in full', () => {
  it('keeps the room of the line for the names: the pending note is an icon, not text after the name', () => {
    show([cluster('c2', false), cluster('c1')])
    const line = screen.getByTestId('associated-clusters')
    expect(line.textContent).toBe('PVE-DRPVE-PROD')
  })

  it('gives every chip of the line its full name on hover, with the pending note when there is one', () => {
    show([cluster('c2', false), cluster('c1')])
    const line = screen.getByTestId('associated-clusters')
    const chips = Array.from(line.querySelectorAll('.MuiChip-root'))
    expect(chips.map(c => c.getAttribute('title'))).toEqual(['PVE-DR · applies at the next application', 'PVE-PROD'])
  })

  it('gives every row of the "+N" list its full name on hover', () => {
    show([cluster('c1'), cluster('c2'), cluster('c3'), cluster('c4', false)], { clusterName: id => FOUR[id] })
    fireEvent.click(screen.getByRole('button', { name: '+3' }))
    const rows = screen.getAllByTestId('associated-cluster-row')
    expect(rows.map(r => r.querySelector('[title]')?.getAttribute('title'))).toEqual(['PVE-1', 'PVE-2', 'PVE-3', 'PVE-4 · applies at the next application'])
  })
})
