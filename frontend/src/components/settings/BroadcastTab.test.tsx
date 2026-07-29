import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/hooks/useUsers', () => ({
  useTenants: () => ({ data: { data: [{ id: 'tenant-a', name: 'Tenant A' }] } }),
  useRbacRoles: () => ({ data: { data: [{ id: 'role_viewer', name: 'Viewer' }] } }),
}))

const rows = [
  {
    id: 'b1',
    message: 'Maintenance Saturday 22:00 UTC',
    linkUrl: null,
    linkLabel: null,
    bgColor: '#f59e0b',
    fgColor: '#000000',
    dismissible: true,
    enabled: true,
    startsAt: null,
    endsAt: null,
    targetKind: 'all',
    targetIds: [],
    updatedAt: '2026-08-01T10:00:00.000Z',
  },
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method === undefined || init.method === 'GET') {
        return new Response(JSON.stringify({ data: rows }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 'b2' }), { status: 201 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('BroadcastTab', () => {
  it('lists the existing banners with their state', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    expect(await screen.findByText('Maintenance Saturday 22:00 UTC')).toBeInTheDocument()
  })

  it('opens the create dialog with the default colours prefilled', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-create'))
    expect(await screen.findByTestId('broadcast-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('broadcast-message-input')).toHaveValue('')
  })

  it('counts the message in code points, so one emoji counts as one', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-create'))
    fireEvent.change(await screen.findByTestId('broadcast-message-input'), { target: { value: 'ab🎉' } })
    // "ab🎉".length is 4 in UTF-16 units; the counter must say 3.
    expect(screen.getByTestId('broadcast-message-count')).toHaveTextContent('3 / 500')
  })

  it('warns when the colour pair is unreadable', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-create'))
    // Queried by test id, not by label: the labels come from en.json and
    // would change the moment Task 15 lands the real translations.
    const pickers = await screen.findAllByTestId('color-picker-native')
    fireEvent.change(pickers[0], { target: { value: '#111827' } })
    fireEvent.change(pickers[1], { target: { value: '#7f1d1d' } })
    expect(await screen.findByTestId('broadcast-contrast-warning')).toBeInTheDocument()
  })

  it('posts the new banner and reloads the list', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-create'))
    fireEvent.change(await screen.findByTestId('broadcast-message-input'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByTestId('broadcast-save'))
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls
      expect(calls.some((c: any[]) => c[1]?.method === 'POST')).toBe(true)
    })
  })

  it('asks for confirmation before deleting', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    const deleteCalls = () => (globalThis.fetch as any).mock.calls.filter((c: any[]) => c[1]?.method === 'DELETE')
    expect(deleteCalls()).toHaveLength(0)
    fireEvent.click(await screen.findByTestId('broadcast-delete-b1'))
    expect(await screen.findByTestId('broadcast-delete-dialog')).toBeInTheDocument()
    // Opening the confirmation must not have fired the request.
    expect(deleteCalls()).toHaveLength(0)
    fireEvent.click(screen.getByTestId('broadcast-delete-confirm'))
    await waitFor(() => {
      expect(deleteCalls()).toHaveLength(1)
    })
    expect(deleteCalls()[0][0]).toBe('/api/v1/settings/broadcast/b1')
    await waitFor(() => {
      expect(screen.queryByTestId('broadcast-delete-dialog')).not.toBeInTheDocument()
    })
  })
})

// Beyond the six contract tests above: every remaining branch of the tab.
// Same rule as above — assertions target test ids or data-driven text
// (mocked tenant/role names, HTTP error literals), never a translated label.
const stubFetch = (data: unknown, failWrites?: { status: number; body: unknown }) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined || init.method === 'GET') {
        return new Response(JSON.stringify(data), { status: 200 })
      }
      if (failWrites) return new Response(JSON.stringify(failWrites.body), { status: failWrites.status })
      return new Response(JSON.stringify({ id: 'b2' }), { status: 201 })
    }),
  )

describe('BroadcastTab branches', () => {
  it('closes the dialog and reloads after a successful create', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-create'))
    fireEvent.change(await screen.findByTestId('broadcast-message-input'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByTestId('broadcast-save'))
    await waitFor(() => {
      expect(screen.queryByTestId('broadcast-dialog')).not.toBeInTheDocument()
    })
    // The reload leaves the list rendered again once loading settles.
    expect(await screen.findByText('Maintenance Saturday 22:00 UTC')).toBeInTheDocument()
    const gets = (globalThis.fetch as any).mock.calls.filter((c: any[]) => !c[1] || c[1].method === undefined)
    expect(gets.length).toBeGreaterThanOrEqual(2)
  })

  it('edits a banner in place: prefills the form, PUTs to its id, round-trips the schedule', async () => {
    stubFetch({
      data: [
        {
          ...rows[0],
          startsAt: '2026-08-01T10:00:00.000Z',
          targetKind: 'roles',
          targetIds: ['role_viewer'],
        },
      ],
    })
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-edit-b1'))
    expect(await screen.findByTestId('broadcast-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('broadcast-message-input')).toHaveValue('Maintenance Saturday 22:00 UTC')
    // The roles targeting branch renders the selected role as a chip.
    expect(screen.getAllByText('Viewer').length).toBeGreaterThanOrEqual(1)
    fireEvent.click(screen.getByTestId('broadcast-save'))
    await waitFor(() => {
      expect(screen.queryByTestId('broadcast-dialog')).not.toBeInTheDocument()
    })
    const put = (globalThis.fetch as any).mock.calls.find((c: any[]) => c[1]?.method === 'PUT')
    expect(put[0]).toBe('/api/v1/settings/broadcast/b1')
    const body = JSON.parse(put[1].body)
    // An untouched schedule must survive the edit round-trip exactly: the
    // datetime-local field is local time, so a UTC-sliced prefill would
    // shift startsAt by the timezone offset on every save.
    expect(body.startsAt).toBe('2026-08-01T10:00:00.000Z')
    expect(body.targetKind).toBe('roles')
    expect(body.targetIds).toEqual(['role_viewer'])
  })

  it('DELETEs the confirmed row and closes the confirmation', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-delete-b1'))
    fireEvent.click(await screen.findByTestId('broadcast-delete-confirm'))
    await waitFor(() => {
      expect(screen.queryByTestId('broadcast-delete-dialog')).not.toBeInTheDocument()
    })
    const del = (globalThis.fetch as any).mock.calls.find((c: any[]) => c[1]?.method === 'DELETE')
    expect(del[0]).toBe('/api/v1/settings/broadcast/b1')
  })

  it('keeps the confirmation open and surfaces the error when the delete fails', async () => {
    stubFetch({ data: rows }, { status: 500, body: {} })
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-delete-b1'))
    fireEvent.click(await screen.findByTestId('broadcast-delete-confirm'))
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument()
    expect(screen.getByTestId('broadcast-delete-dialog')).toBeInTheDocument()
  })

  it('keeps the dialog open and shows the server error when the save fails', async () => {
    stubFetch({ data: rows }, { status: 422, body: { error: 'boom' } })
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-create'))
    fireEvent.change(await screen.findByTestId('broadcast-message-input'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByTestId('broadcast-save'))
    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByTestId('broadcast-dialog')).toBeInTheDocument()
  })

  it('surfaces a load failure in the snackbar and still renders the empty list', async () => {
    stubFetch(null)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument()
    expect(screen.getByTestId('broadcast-empty')).toBeInTheDocument()
  })

  it('treats a payload without an array as an empty list', async () => {
    stubFetch({})
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    expect(await screen.findByTestId('broadcast-empty')).toBeInTheDocument()
  })

  it('keeps the contrast warning advisory: an unreadable pair still saves', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-create'))
    fireEvent.change(await screen.findByTestId('broadcast-message-input'), { target: { value: 'Low contrast' } })
    const pickers = screen.getAllByTestId('color-picker-native')
    fireEvent.change(pickers[0], { target: { value: '#111827' } })
    fireEvent.change(pickers[1], { target: { value: '#7f1d1d' } })
    expect(await screen.findByTestId('broadcast-contrast-warning')).toBeInTheDocument()
    expect(screen.getByTestId('broadcast-save')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('broadcast-save'))
    await waitFor(() => {
      expect(screen.queryByTestId('broadcast-dialog')).not.toBeInTheDocument()
    })
    expect((globalThis.fetch as any).mock.calls.some((c: any[]) => c[1]?.method === 'POST')).toBe(true)
  })

  it('applies a colour preset, toggles the switches and cancels without writing', async () => {
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    fireEvent.click(await screen.findByTestId('broadcast-create'))
    fireEvent.click(await screen.findByTestId('broadcast-preset-critical'))
    const pickers = screen.getAllByTestId('color-picker-native')
    expect(pickers[0]).toHaveValue('#dc2626')
    expect(pickers[1]).toHaveValue('#ffffff')
    // Both MUI switches (dismissible, enabled) start on and flip off.
    const toggles = screen.getAllByRole('switch')
    fireEvent.click(toggles[0])
    fireEvent.click(toggles[1])
    expect(toggles[0]).not.toBeChecked()
    expect(toggles[1]).not.toBeChecked()
    // common.cancel exists in en.json today, so this label is stable.
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => {
      expect(screen.queryByTestId('broadcast-dialog')).not.toBeInTheDocument()
    })
    const writes = (globalThis.fetch as any).mock.calls.filter((c: any[]) => c[1]?.method && c[1].method !== 'GET')
    expect(writes).toHaveLength(0)
  })

  it('derives every row state and resolves target names per kind', async () => {
    stubFetch({
      data: [
        { ...rows[0], id: 's1', message: 'm-active' },
        { ...rows[0], id: 's2', message: 'm-disabled', enabled: false },
        { ...rows[0], id: 's3', message: 'm-scheduled', startsAt: '2099-01-01T00:00:00.000Z' },
        {
          ...rows[0],
          id: 's4',
          message: 'm-expired',
          endsAt: '2000-01-01T00:00:00.000Z',
          targetKind: 'tenants',
          targetIds: ['tenant-a'],
        },
        { ...rows[0], id: 's5', message: 'm-ghost', targetKind: 'roles', targetIds: ['ghost'] },
        { ...rows[0], id: 's6', message: 'm-mixed', targetKind: 'tenants', targetIds: ['tenant-a', 'ghost-2'] },
        { ...rows[0], id: 's7', message: 'm-none', targetKind: 'roles', targetIds: [] },
      ],
    })
    const BroadcastTab = (await import('./BroadcastTab')).default
    renderWithProviders(<BroadcastTab />)
    for (const message of ['m-active', 'm-disabled', 'm-scheduled', 'm-expired', 'm-ghost', 'm-mixed', 'm-none']) {
      expect(await screen.findByText(message)).toBeInTheDocument()
    }
    // The four-way derivation, asserted on the machine-readable state
    // attribute: the chip label is a translated string that only lands
    // with task 15, so it is never queried here.
    for (const [id, state] of [
      ['s1', 'active'],
      ['s2', 'disabled'],
      ['s3', 'scheduled'],
      ['s4', 'expired'],
    ] as const) {
      expect(screen.getByTestId(`broadcast-state-${id}`)).toHaveAttribute('data-state', state)
    }
    // Tenant targeting resolves the id to its name; unresolvable ids stay
    // visible as raw ids, even mixed with resolvable ones, instead of being
    // silently dropped; an empty target list shows a placeholder.
    expect(screen.getByText('Tenant A')).toBeInTheDocument()
    expect(screen.getByText('ghost')).toBeInTheDocument()
    expect(screen.getByText('Tenant A, ghost-2')).toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument()
  })
})
