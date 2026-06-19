import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { DataGrid } from '@mui/x-data-grid'
import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'

function SpikeGrid() {
  return (
    <div style={{ height: 200, width: 300 }}>
      <DataGrid
        rows={[{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }]}
        columns={[{ field: 'name', headerName: 'Name', width: 120 }]}
      />
    </div>
  )
}

describe('spike: jsdom + RTL + MUI DataGrid render', () => {
  it('renders DataGrid rows under jsdom', () => {
    renderWithProviders(<SpikeGrid />)
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })
})
