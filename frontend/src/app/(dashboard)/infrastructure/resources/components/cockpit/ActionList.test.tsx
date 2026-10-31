import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import type { ActionItem } from '../../algorithms/capacityPlanning'
import ActionList from './ActionList'

afterEach(cleanup)

const items: ActionItem[] = [
  {
    id: 'n1:c1',
    severity: 'critical',
    kind: 'nPlusOne',
    params: { cluster: 'prod', node: 'pve1', ram: 97, cpu: 60 },
    tab: 'simulation',
    target: { section: 'simulator', key: 'c1' },
  },
  {
    id: 'runway:c1:ram',
    severity: 'warning',
    kind: 'runway',
    params: { cluster: 'prod', resource: 'ram', days: 21, threshold: 90 },
    tab: 'capacity',
    target: { section: 'clusters', key: 'c1' },
  },
  {
    id: 'dormant',
    severity: 'info',
    kind: 'dormant',
    params: { count: 4, ramGiB: 96, vcpu: 12 },
    tab: 'efficiency',
    target: { section: 'efficiency' },
  },
]

describe('ActionList', () => {
  it('starts folded with the item count and the critical count in the header', () => {
    renderWithProviders(<ActionList items={items} onOpen={vi.fn()} />)

    expect(screen.getByText('To handle')).toBeInTheDocument()
    expect(screen.getByText('3 items, 1 critical')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/losing pve1/)).toBeNull()
  })

  it('lists each item in words once opened, the runway resource translated', () => {
    renderWithProviders(<ActionList items={items} onOpen={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))

    expect(screen.getByText('prod: losing pve1 would push the other nodes to 97% RAM and 60% CPU')).toBeInTheDocument()
    expect(screen.getByText('prod: RAM reaches 90% in 21 days')).toBeInTheDocument()
    expect(screen.getByText('4 stopped guests hold 96 GB of RAM and 12 vCPU')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hands the clicked item to the page, its button naming the tab it leads to', () => {
    const onOpen = vi.fn()

    renderWithProviders(<ActionList items={items} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('To handle'))

    expect(screen.getByRole('button', { name: 'Simulation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Efficiency' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Capacity' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(items[1])
  })

  it('leaves a runway resource that is not a known key untranslated', () => {
    const odd: ActionItem = { ...items[1], id: 'runway:odd', params: { cluster: 'lab', resource: 7, days: 3, threshold: 80 } }

    renderWithProviders(<ActionList items={[odd]} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))

    expect(screen.getByText('lab: 7 reaches 80% in 3 days')).toBeInTheDocument()
    expect(screen.getByText('1 items, 0 critical')).toBeInTheDocument()
  })

  it('says there is nothing to handle, without a count', () => {
    renderWithProviders(<ActionList items={[]} onOpen={vi.fn()} />)

    expect(screen.queryByText(/items,/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByText('Nothing to handle: every cluster and pool is within its thresholds')).toBeInTheDocument()
  })
})
