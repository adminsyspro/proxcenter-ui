/** roadmap#198: the Nodes table offers checkboxes when its parent follows a selection of nodes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import NodesTable from '@/components/NodesTable'

const nodes = ['pve1', 'pve2'].map(n => ({ id: `c1:${n}`, connId: 'c1', node: n, name: n, status: 'online' as const, cpu: 0.1, ram: 0.2, storage: 0.3 }))

afterEach(() => cleanup())

describe('NodesTable selection', () => {
  it('has no checkbox without a parent selection', () => {
    renderWithProviders(<NodesTable nodes={nodes} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('reports the ticked rows, and every row for the header checkbox', () => {
    const onSelectionChange = vi.fn()
    renderWithProviders(<NodesTable nodes={nodes} selectedIds={new Set(['c1:pve1'])} onSelectionChange={onSelectionChange} />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    expect((boxes[1] as HTMLInputElement).checked).toBe(true)

    fireEvent.click(boxes[2])
    expect([...onSelectionChange.mock.calls.at(-1)![0]].sort((x, y) => x.localeCompare(y))).toEqual(['c1:pve1', 'c1:pve2'])
  })
})
