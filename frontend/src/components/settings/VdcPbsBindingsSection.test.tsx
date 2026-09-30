/**
 * Component tests for VdcPbsBindingsSection: the datastore list of the add
 * form follows the picked PBS connection, fetched per connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import VdcPbsBindingsSection from '@/components/settings/VdcPbsBindingsSection'

const PBS = [
  { id: 'pbs-a', name: 'pbs-paris', fingerprint: 'AA:BB' },
  { id: 'pbs b', name: 'pbs-lyon', fingerprint: 'CC:DD' },
]

let fetchMock: ReturnType<typeof vi.fn>

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  fetchMock = vi.fn(async (input: any) => {
    const url = String(input)

    if (url.endsWith('/pbs-bindings')) return jsonRes({ data: [] })
    if (url === '/api/v1/admin/pbs-connections/pbs-a/datastores') return jsonRes({ data: ['ds-main', 'ds-archive'] })
    if (url === '/api/v1/admin/pbs-connections/pbs%20b/datastores') throw new Error('network down')

    return jsonRes({})
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderSection() {
  renderWithProviders(<VdcPbsBindingsSection vdcId="vdc-1" tenantSlug="acme" vdcSlug="paris" pbsConnections={PBS} />)
}

async function pickConnection(name: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'PBS connection' }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name }))
}

describe('VdcPbsBindingsSection datastore list', () => {
  it('fetches the datastores of the picked PBS connection and offers them', async () => {
    renderSection()
    await screen.findByText('No binding yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Add binding' }))
    await pickConnection('pbs-paris')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/pbs-connections/pbs-a/datastores'))

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Datastore' }))
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)

    expect(options).toEqual(['ds-main', 'ds-archive'])
  })

  it('leaves the datastore list empty when the fetch fails', async () => {
    renderSection()
    await screen.findByText('No binding yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Add binding' }))
    await pickConnection('pbs-lyon')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/pbs-connections/pbs%20b/datastores'))

    const datastore = screen.getByRole('combobox', { name: 'Datastore' })

    expect(datastore).not.toHaveAttribute('aria-disabled')
    fireEvent.mouseDown(datastore)
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toHaveLength(0)
  })
})
