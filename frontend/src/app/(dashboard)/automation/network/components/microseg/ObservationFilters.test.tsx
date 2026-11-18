/**
 * The filters of the Observation row: the value never runs under or against the arrow of its select, and a filter
 * whose name and value are long takes more of the row than the short ones.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import ObservationFilters from './ObservationFilters'

afterEach(cleanup)

function open() {
  return renderWithProviders(
    <ObservationFilters
      values={{ kind: '', status: 'pending', zone: '', direction: '', cluster: '' }}
      zones={[]}
      clusters={[{ value: 'c1', label: 'PVE-DR' }]}
      onChange={vi.fn()}
    />,
  )
}

describe('ObservationFilters layout', () => {
  it('cuts the value with an ellipsis in a box of its own, before the room of the arrow', () => {
    open()
    const select = screen.getByRole('combobox', { name: 'Cluster' })
    // The value text sits in one box that cuts it; the select's own padding keeps the arrow's room.
    const value = select.firstElementChild as HTMLElement
    expect(value).toHaveStyle({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
    expect(value.textContent).toBe('ClusterAll clusters')
    expect(Number.parseFloat(getComputedStyle(select).paddingRight)).toBeGreaterThanOrEqual(28)
  })

  it('lets a filter grow from the width of its content, never from zero', () => {
    open()
    const root = screen.getByRole('combobox', { name: 'Cluster' }).closest('.MuiInputBase-root') as HTMLElement
    expect(root).toHaveStyle({ flexGrow: '1', flexShrink: '1', flexBasis: 'auto' })
  })
})
