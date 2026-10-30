/**
 * VmsTable asks for the IP/Snap details of the rows it shows, page by page,
 * in the grid's own order (roadmap#179): never the whole list, and the sorted
 * page rather than a slice of the unsorted props.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import VmsTable, { type VmRow } from '@/components/VmsTable'

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

// 25 guests listed in reverse name order: sorting by name changes every page.
const rows: VmRow[] = Array.from({ length: 25 }, (_, i) => {
  const n = 24 - i

  return { id: `c1:qemu:pve1:${300 + n}`, connId: 'c1', node: 'pve1', vmid: 300 + n, name: `guest-${String(n).padStart(2, '0')}`, type: 'qemu', status: 'running' }
})

const names = (call: VmRow[]) => call.map(vm => vm.name)

describe('VmsTable - IP/Snap details of the displayed page', () => {
  it('asks for the rows of the page shown when Load details is clicked, not the whole list', async () => {
    const onLoadIpSnap = vi.fn()

    renderWithProviders(<VmsTable vms={rows} onLoadIpSnap={onLoadIpSnap} />)
    fireEvent.click(await screen.findByText('Load details'))

    expect(onLoadIpSnap).toHaveBeenCalledTimes(1)
    expect(names(onLoadIpSnap.mock.calls[0][0])).toEqual(rows.slice(0, 10).map(vm => vm.name))
  })

  it('follows the sorted page, then the next one, once the details are on', async () => {
    const onLoadIpSnap = vi.fn()

    renderWithProviders(<VmsTable vms={rows} showIpSnap onLoadIpSnap={onLoadIpSnap} />)
    await waitFor(() => expect(onLoadIpSnap).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('columnheader', { name: /name/i }).querySelector('.MuiDataGrid-columnHeaderTitleContainer')!)
    await waitFor(() => expect(names(onLoadIpSnap.mock.lastCall![0])[0]).toBe('guest-00'))
    expect(names(onLoadIpSnap.mock.lastCall![0])).toEqual(Array.from({ length: 10 }, (_, i) => `guest-0${i}`))

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    await waitFor(() => expect(names(onLoadIpSnap.mock.lastCall![0])[0]).toBe('guest-10'))
    expect(onLoadIpSnap.mock.lastCall![0]).toHaveLength(10)
  })
})
