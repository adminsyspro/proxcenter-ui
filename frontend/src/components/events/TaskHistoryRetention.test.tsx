import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import TaskHistoryRetention from './TaskHistoryRetention'

const { swrMock, mutateMock, permissions } = vi.hoisted(() => ({
  swrMock: vi.fn(),
  mutateMock: vi.fn(),
  permissions: new Set<string>(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: (p: string) => permissions.has(p) }) }))
vi.mock('@/hooks/useSWRFetch', () => ({ useSWRFetch: (...a: any[]) => swrMock(...a) }))

const fetchMock = vi.fn()

beforeEach(() => {
  permissions.add('admin.settings')
  swrMock.mockReturnValue({ data: { retentionDays: 90, maxRetentionDays: 730 }, mutate: mutateMock })
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
})

afterEach(() => {
  cleanup()
  permissions.clear()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function open() {
  render(<TaskHistoryRetention />)
  fireEvent.click(screen.getByLabelText('eventsPage.archive.retentionTitle'))
}

describe('TaskHistoryRetention', () => {
  it('stays hidden, and reads nothing, for a user who may not change settings', () => {
    permissions.clear()
    render(<TaskHistoryRetention />)

    expect(screen.queryByLabelText('eventsPage.archive.retentionTitle')).toBeNull()
    expect(swrMock).toHaveBeenCalledWith(null)
  })

  it('opens on the current retention and saves the chosen one', async () => {
    open()

    expect(screen.getByText(/eventsPage\.archive\.retentionDays/).textContent).toContain('"days":90')

    const slider = screen.getByRole('slider')

    fireEvent.keyDown(slider, { key: 'End' })
    expect(screen.getByText(/eventsPage\.archive\.retentionDays/).textContent).toContain('"days":730')

    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(mutateMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe('/api/v1/events/archive/settings')
    expect(JSON.parse(init.body)).toEqual({ retentionDays: 730 })
    await waitFor(() => expect(screen.queryByText('common.save')).toBeNull())
  })

  it('shows why a save was refused and keeps the dialog open', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'provider only' }), { status: 403 }))
    open()

    fireEvent.click(screen.getByText('common.save'))

    expect(await screen.findByText('provider only')).toBeTruthy()
    expect(mutateMock).not.toHaveBeenCalled()

    fetchMock.mockRejectedValue(new Error('network down'))
    fireEvent.click(screen.getByText('common.save'))
    expect(await screen.findByText('network down')).toBeTruthy()
  })

  it('falls back to the defaults while the settings load, and cancels', () => {
    swrMock.mockReturnValue({ data: undefined, mutate: mutateMock })
    open()

    expect(screen.getByText(/eventsPage\.archive\.retentionDays/).textContent).toContain('"days":90')
    fireEvent.click(screen.getByText('common.cancel'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
