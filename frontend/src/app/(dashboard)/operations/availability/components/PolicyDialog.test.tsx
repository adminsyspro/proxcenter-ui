import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import { inventoryFixture, makePolicy } from './fixtures'
import { inventoryOptions } from './inventoryOptions'
import PolicyDialog from './PolicyDialog'

vi.mock('../hooks/useSlaLists', () => ({
  useInventoryOptions: () => ({ options: inventoryOptions(inventoryFixture), error: undefined, isLoading: false }),
}))

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderDialog = (policy = null as ReturnType<typeof makePolicy> | null, onSaved = vi.fn()) =>
  renderWithProviders(<PolicyDialog open policy={policy} defaultTarget={99.5} onClose={() => {}} onSaved={onSaved} />)

describe('PolicyDialog', () => {
  it('starts the target at the default of the settings and states the membership limit', () => {
    renderDialog()

    expect(screen.getByLabelText(/Target/)).toHaveValue(99.5)
    expect(screen.getByText(/evaluated when the figures are calculated/)).toBeInTheDocument()
  })

  it('moves the tags All box through its three states', async () => {
    const user = userEvent.setup()

    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Tags (0)' }))

    const tagsAll = screen.getByRole('checkbox', { name: 'All' })

    expect(tagsAll).not.toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: 'db' }))
    expect(tagsAll).toHaveAttribute('data-indeterminate', 'true')

    await user.click(tagsAll)
    expect(tagsAll).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'prod' })).toBeChecked()

    await user.click(tagsAll)
    expect(tagsAll).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'prod' })).not.toBeChecked()
  })

  it('creates a policy with the ticked guests and tags', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()

    renderDialog(null, onSaved)

    await user.type(screen.getByLabelText(/Name/), 'Gold')
    await user.click(screen.getByRole('checkbox', { name: /web/ }))
    await user.click(screen.getByRole('tab', { name: 'Tags (0)' }))
    await user.click(screen.getByRole('checkbox', { name: 'prod' }))
    expect(screen.getByText('Guests 1 · Tags 1 · Pools 0')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe('/api/v1/sla/policies')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      name: 'Gold',
      target: 99.5,
      enabled: true,
      guests: [{ connectionId: 'c1', vmid: 100 }],
      tags: ['prod'],
      pools: [],
    })
  })

  it('edits with a PUT on the policy', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()

    renderDialog(makePolicy(), onSaved)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/sla/policies/p1')
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
  })

  it('shows a 400 guest_out_of_scope in the dialog and stays open', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()

    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'guest_out_of_scope' }) })
    renderDialog(makePolicy(), onSaved)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('outside your perimeter')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('blocks saving a target out of bounds or an empty name', async () => {
    const user = userEvent.setup()

    renderDialog()

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.type(screen.getByLabelText(/Name/), 'Gold')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    await user.clear(screen.getByLabelText(/Target/))
    await user.type(screen.getByLabelText(/Target/), '89')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('PolicyDialog prefill and reset', () => {
  const edited = () => makePolicy({
    name: 'Gold', target: 99.95, guests: [{ connectionId: 'c1', vmid: 100 }], tags: ['prod', 'db'], pools: ['gold'],
  })

  it('sends back exactly what the edited policy holds, untouched', async () => {
    const user = userEvent.setup()

    renderDialog(edited())
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(body).toMatchObject({ name: 'Gold', target: 99.95, enabled: true, guests: [{ connectionId: 'c1', vmid: 100 }] })
    expect([...body.tags].sort()).toEqual(['db', 'prod'])
    expect(body.pools).toEqual(['gold'])
  })

  it('opens empty with the default target after an edit, once closed', () => {
    const noop = () => {}
    const { rerender } = renderWithProviders(<PolicyDialog open policy={edited()} defaultTarget={99.5} onClose={noop} onSaved={noop} />)

    expect(screen.getByLabelText(/Name/)).toHaveValue('Gold')

    rerender(<PolicyDialog open={false} policy={edited()} defaultTarget={99.5} onClose={noop} onSaved={noop} />)
    rerender(<PolicyDialog open policy={null} defaultTarget={99.5} onClose={noop} onSaved={noop} />)

    expect(screen.getByLabelText(/Name/)).toHaveValue('')
    expect(screen.getByLabelText(/Target/)).toHaveValue(99.5)
    for (const box of screen.getAllByRole('checkbox', { name: /^(All|prod|db|gold|web)/ })) {
      if (box.getAttribute('aria-label') !== 'Policy enabled') expect(box).not.toBeChecked()
    }
  })

  it.each([
    [403, {}, 'do not have the right'],
    [503, {}, 'orchestrator is unreachable'],
  ])('shows a %s without a code in the dialog', async (status, body, text) => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValue({ ok: false, status, json: async () => body })
    renderDialog(edited())
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })
})
