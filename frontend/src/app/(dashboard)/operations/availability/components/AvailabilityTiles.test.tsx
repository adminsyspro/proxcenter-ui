import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import AvailabilityTiles from './AvailabilityTiles'

const base = { nodesUp: 1, nodesTotal: 3, clustersQuorate: 0, clustersTotal: 0, nodesMaintenance: 1, coverage: 80 }

afterEach(cleanup)

const renderTiles = (coveredGuestsDown: number | null) =>
  renderWithProviders(<AvailabilityTiles tiles={{ ...base, coveredGuestsDown }} nodesDown={0} lowCoverage={0} filter={null} onFilter={() => {}} />)

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
