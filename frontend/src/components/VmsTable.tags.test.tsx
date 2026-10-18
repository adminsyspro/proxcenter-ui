/**
 * #937: the Tags column sorts on the joined tags. The DataGrid used to sort on
 * the array reference, which compares nothing and left the rows in arrival order.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import VmsTable from '@/components/VmsTable'
import { vmRowsFixture } from '@/__tests__/fixtures/vmRows'

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ loading: false, isFullClusterView: true }),
}))
vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => ({ isEnterprise: false, hasFeature: () => false, loading: false }),
}))
vi.mock('@/hooks/useRefreshInterval', () => ({ useRefreshInterval: () => 60000 }))
vi.mock('@/contexts/TagColorContext', () => ({
  useTagColors: () => ({
    getColor: () => ({ bg: '#1976d2', fg: '#ffffff' }),
    getOverride: () => undefined,
    getShape: () => 'full',
    loadConnection: vi.fn(),
  }),
}))

afterEach(() => cleanup())

// Arrival order puts the 'prod, web' guest before the 'db' one and an
// untagged guest in between, so a working sort has to move rows.
const rows = [
  { ...vmRowsFixture[0], name: 'web-01', tags: ['prod', 'web'] },
  { ...vmRowsFixture[2], name: 'ubuntu-template', tags: [] },
  { ...vmRowsFixture[1], name: 'db-lxc', tags: ['db'] },
]

function rowIndex(container: HTMLElement, name: string): number {
  return [...container.querySelectorAll('.MuiDataGrid-row')].findIndex(r => r.textContent?.includes(name))
}

describe('VmsTable - Tags column sorting (#937)', () => {
  it('orders the tagged rows alphabetically on the joined tags, both directions', () => {
    const { container } = renderWithProviders(<VmsTable vms={rows} />)
    const header = container.querySelector('[role="columnheader"][data-field="tags"]') as HTMLElement
    expect(header).not.toBeNull()

    expect(rowIndex(container, 'web-01')).toBeLessThan(rowIndex(container, 'db-lxc'))

    fireEvent.click(header)
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(rowIndex(container, 'db-lxc')).toBeLessThan(rowIndex(container, 'web-01'))

    fireEvent.click(header)
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(rowIndex(container, 'web-01')).toBeLessThan(rowIndex(container, 'db-lxc'))
  })
})
