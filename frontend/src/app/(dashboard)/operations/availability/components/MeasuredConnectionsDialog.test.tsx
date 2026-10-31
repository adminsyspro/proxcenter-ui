import { cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import MeasuredConnectionsDialog from './MeasuredConnectionsDialog'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const CONNECTIONS = { data: [{ id: 'c2', name: 'Paris DR' }, { id: 'c1', name: 'Lyon prod' }] }

function mockFetch(put: (body: any) => Response = body => json({ measuredConnections: body.measuredConnections })) {
  const fn = vi.fn(async (url: string, init?: RequestInit) =>
    (init?.method === 'PUT' ? put(JSON.parse(String(init.body))) : json(String(url).startsWith('/api/v1/connections') ? CONNECTIONS : {})))
  vi.stubGlobal('fetch', fn)
  return fn
}

function renderDialog(measured: string[], onClose = vi.fn(), policies: Record<string, string[]> = {}) {
  renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <MeasuredConnectionsDialog open measured={measured} policies={policies} onClose={onClose} />
    </SWRConfig>,
  )
  return onClose
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MeasuredConnectionsDialog', () => {
  it('lists the connections by name, ticks the measured ones and saves the choice', async () => {
    const fetchMock = mockFetch()
    const onClose = renderDialog(['c2'])
    const user = userEvent.setup()

    expect(await screen.findByRole('checkbox', { name: /Paris DR/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Lyon prod/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'All' })).toHaveAttribute('data-indeterminate', 'true')

    await user.click(screen.getByRole('checkbox', { name: 'All' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe('/api/v1/availability/settings')
    expect(JSON.parse(String(put[1]?.body)).measuredConnections.sort()).toEqual(['c1', 'c2'])
  })

  it('stays open on a refusal and words it', async () => {
    mockFetch(() => json({ error: 'invalid_connections' }, 400))
    const onClose = renderDialog([])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: /Lyon prod/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('A ticked connection no longer exists. Reload the page.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes without saving on cancel', async () => {
    const fetchMock = mockFetch()
    const onClose = renderDialog([])

    await screen.findByRole('checkbox', { name: /Lyon prod/ })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('warns before a connection a policy uses stops being measured', async () => {
    mockFetch()
    renderDialog(['c1', 'c2'], vi.fn(), { c1: ['Gold', 'acme'] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: /Paris DR/ }))
    // No policy on Paris DR: nothing to warn about.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Lyon prod/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Lyon prod is used by 2 policies (Gold, acme): its guests will no longer be measured; their history is kept.')

    await user.click(screen.getByRole('checkbox', { name: /Lyon prod/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

