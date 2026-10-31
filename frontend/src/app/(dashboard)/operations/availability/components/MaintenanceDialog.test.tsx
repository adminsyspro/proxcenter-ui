import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent, within } from '@/__tests__/setup/renderWithProviders'

import { inventoryFixture } from './fixtures'
import { inventoryOptions } from './inventoryOptions'
import MaintenanceDialog, { toLocalInput } from './MaintenanceDialog'
import type { WindowItem } from './slaApi'

vi.mock('../hooks/useSlaLists', () => ({
  useInventoryOptions: () => ({ options: inventoryOptions(inventoryFixture), error: undefined, isLoading: false }),
  useAllPolicies: () => ({ data: { items: [{ id: 'p1', name: 'Gold', enabled: true }] } }),
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

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(within(screen.getByRole('listbox')).getByText(option))
}

describe('MaintenanceDialog', () => {
  it('declares a node window with ISO dates and a reason', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()

    renderWithProviders(<MaintenanceDialog open window={null} onClose={() => {}} onSaved={onSaved} />)

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Node' }))
    await pick(user, 'Connection', 'Paris')
    await pick(user, 'Node', 'pve1')
    await user.type(screen.getByLabelText(/Reason/), 'Firmware')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)

    expect(url).toBe('/api/v1/sla/maintenance-windows')
    expect(init.method).toBe('POST')
    expect(body).toMatchObject({ scope: 'node', connectionId: 'c1', node: 'pve1', reason: 'Firmware' })
    expect(body.startsAt).toMatch(/Z$/)
    expect(Date.parse(body.endsAt)).toBeGreaterThan(Date.parse(body.startsAt))
  })

  it('needs a reason', async () => {
    const user = userEvent.setup()

    renderWithProviders(<MaintenanceDialog open window={null} onClose={() => {}} onSaved={() => {}} />)

    await pick(user, 'Connection', 'Paris')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.type(screen.getByLabelText(/Reason/), 'x')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('shows a 400 invalid_window in the dialog', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_window' }) })
    renderWithProviders(<MaintenanceDialog open window={null} onClose={() => {}} onSaved={() => {}} />)

    await pick(user, 'Connection', 'Paris')
    await user.type(screen.getByLabelText(/Reason/), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('31 days at most')
  })

  it('targets a policy and edits with a PUT', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <MaintenanceDialog
        open
        window={{ id: 'w9', scope: 'policy', connectionId: null, node: null, vmid: null, policyId: 'p1', startsAt: '2026-10-27T11:00:00.000Z', endsAt: '2026-10-27T12:00:00.000Z', reason: 'r', createdBy: 'a', createdAt: '2026-10-20T10:00:00.000Z' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/sla/maintenance-windows/w9')
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ scope: 'policy', policyId: 'p1', startsAt: '2026-10-27T11:00:00.000Z' })
  })
})

const stored = (over: Partial<WindowItem> = {}): WindowItem => ({
  id: 'w9', scope: 'node', connectionId: 'c1', node: 'pve1', vmid: null, policyId: null,
  startsAt: '2026-10-25T01:30:00.123Z', endsAt: '2026-10-25T02:30:00.000Z',
  reason: 'Firmware', createdBy: 'a', createdAt: '2026-10-20T10:00:00.000Z', ...over,
})

describe('MaintenanceDialog edit keeps the stored dates', () => {
  it('save without touching the dates keeps the exact original ISO', async () => {
    const user = userEvent.setup()

    renderWithProviders(<MaintenanceDialog open window={stored()} onClose={() => {}} onSaved={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ startsAt: '2026-10-25T01:30:00.123Z', endsAt: '2026-10-25T02:30:00.000Z' })
  })

  it('keeps the second 02:30 of the clock change hour in Europe/Paris', async () => {
    const user = userEvent.setup()
    const before = process.env.TZ

    // 2026-10-25: Paris goes back from 03:00 to 02:00, so 02:30 happens twice; 01:30Z is the second one.
    process.env.TZ = 'Europe/Paris'

    try {
      const probe = new Date('2026-10-25T01:30:00.000Z')

      // The zone must really be applied, else this test proves nothing.
      expect(probe.getHours()).toBe(2)
      expect(toLocalInput(probe)).toBe('2026-10-25T02:30')
      expect(new Date(toLocalInput(probe)).toISOString()).toBe('2026-10-25T00:30:00.000Z')

      renderWithProviders(<MaintenanceDialog open window={stored({ startsAt: '2026-10-25T01:30:00.000Z', endsAt: '2026-10-25T03:00:00.000Z' })} onClose={() => {}} onSaved={() => {}} />)
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).startsAt).toBe('2026-10-25T01:30:00.000Z')
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })

  it('treats a date typed back to its original value as untouched', async () => {
    const user = userEvent.setup()

    renderWithProviders(<MaintenanceDialog open window={stored()} onClose={() => {}} onSaved={() => {}} />)

    const start = screen.getByLabelText('Start')
    const original = (start as HTMLInputElement).value

    await user.clear(start)
    await user.type(start, '2026-10-25T01:00')
    await user.clear(start)
    await user.type(start, original)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).startsAt).toBe('2026-10-25T01:30:00.123Z')
  })

  it('reconverts only the field the user touched', async () => {
    const user = userEvent.setup()

    renderWithProviders(<MaintenanceDialog open window={stored()} onClose={() => {}} onSaved={() => {}} />)

    const end = screen.getByLabelText('End')

    await user.clear(end)
    await user.type(end, '2026-10-25T04:00')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(body.startsAt).toBe('2026-10-25T01:30:00.123Z')
    expect(body.endsAt).toBe(new Date('2026-10-25T04:00').toISOString())
  })
})

describe('MaintenanceDialog reset', () => {
  it('opens empty after an edit once closed and reopened for a creation', () => {
    const { rerender } = renderWithProviders(<MaintenanceDialog open window={stored()} onClose={() => {}} onSaved={() => {}} />)

    expect(screen.getByLabelText(/Reason/)).toHaveValue('Firmware')

    rerender(<MaintenanceDialog open={false} window={stored()} onClose={() => {}} onSaved={() => {}} />)
    rerender(<MaintenanceDialog open window={null} onClose={() => {}} onSaved={() => {}} />)

    expect(screen.getByLabelText(/Reason/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Connection' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('toLocalInput', () => {
  it('uses the local getters', () => {
    expect(toLocalInput(new Date(2026, 9, 27, 8, 5))).toBe('2026-10-27T08:05')
  })
})
