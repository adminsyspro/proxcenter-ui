import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import AvailabilityTiles from './AvailabilityTiles'

const base = { nodesUp: 1, nodesTotal: 3, clustersQuorate: 0, clustersTotal: 0, nodesMaintenance: 1, coverage: 80 }

afterEach(cleanup)

const renderTiles = (coveredGuestsDown: number | null) =>
  renderWithProviders(<AvailabilityTiles tiles={{ ...base, coveredGuestsDown }} nodesDown={0} lowCoverage={0} connectionsTotal={2} filter={null} onFilter={() => {}} />)

describe('AvailabilityTiles covered guests down', () => {
  it('is absent when the figure is null', () => {
    renderTiles(null)

    expect(screen.queryByText('Covered guests down')).not.toBeInTheDocument()
  })

  it('is shown, and not clickable, with its value', () => {
    renderTiles(4)

    expect(screen.getByText('Covered guests down')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })
})

describe('AvailabilityTiles figures', () => {
  it('words the counts out of their total and filters on the last three', async () => {
    const onFilter = vi.fn()

    renderWithProviders(<AvailabilityTiles tiles={{ ...base, coveredGuestsDown: null }} nodesDown={2} lowCoverage={1} connectionsTotal={2} filter='down' onFilter={onFilter} />)

    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByText('0 / 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('2')
    await userEvent.click(screen.getByRole('button', { pressed: true }))
    expect(onFilter).toHaveBeenCalledWith(null)
    await userEvent.click(screen.getAllByRole('button', { pressed: false })[1])
    expect(onFilter).toHaveBeenLastCalledWith('coverage')
  })
})
