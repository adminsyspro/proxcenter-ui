import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import NotificationRetentionCard from './NotificationRetentionCard'

const API = '/api/v1/orchestrator/notifications/retention'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init))

  vi.stubGlobal('fetch', fn)

  return fn
}

const field = () => screen.getByLabelText('Keep the history for') as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save the retention' })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NotificationRetentionCard', () => {
  it('loads the retention and enables the form', async () => {
    mockFetch(() => json({ retentionDays: 30, maxRetentionDays: 365 }))
    renderWithProviders(<NotificationRetentionCard />)

    expect(field()).toBeDisabled()
    await waitFor(() => expect(field().value).toBe('30'))
    expect(field()).toBeEnabled()
    expect(save()).toBeEnabled()
  })

  it('saves a new retention and confirms', async () => {
    const fetchMock = mockFetch((_url, init) => (init?.method === 'PUT' ? json({ status: 'ok', retentionDays: 7 }) : json({ retentionDays: 30, maxRetentionDays: 365 })))

    renderWithProviders(<NotificationRetentionCard />)
    await waitFor(() => expect(field().value).toBe('30'))

    fireEvent.change(field(), { target: { value: '7' } })
    fireEvent.click(save())

    expect(await screen.findByText('Retention saved.')).toBeInTheDocument()
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!

    expect(put[0]).toBe(API)
    expect(JSON.parse(String(put[1]?.body))).toEqual({ retentionDays: 7 })

    // Editing again withdraws the confirmation of the previous value.
    fireEvent.change(field(), { target: { value: '8' } })
    expect(screen.queryByText('Retention saved.')).not.toBeInTheDocument()
  })

  it.each(['0', '366', '1.5', ''])('refuses %j without calling the server', async value => {
    const fetchMock = mockFetch(() => json({ retentionDays: 30, maxRetentionDays: 365 }))

    renderWithProviders(<NotificationRetentionCard />)
    await waitFor(() => expect(field().value).toBe('30'))

    fireEvent.change(field(), { target: { value } })

    expect(screen.getByText('Enter a whole number between 1 and 365.')).toBeInTheDocument()
    expect(save()).toBeDisabled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('uses the maximum the orchestrator announces', async () => {
    mockFetch(() => json({ retentionDays: 30, maxRetentionDays: 90 }))
    renderWithProviders(<NotificationRetentionCard />)
    await waitFor(() => expect(field().value).toBe('30'))

    fireEvent.change(field(), { target: { value: '120' } })
    expect(screen.getByText('Enter a whole number between 1 and 90.')).toBeInTheDocument()
  })

  it('shows a load failure and keeps the form locked', async () => {
    mockFetch(() => json({ error: 'Orchestrator unavailable' }, 500))
    renderWithProviders(<NotificationRetentionCard />)

    expect(await screen.findByText('Orchestrator unavailable')).toBeInTheDocument()
    expect(field()).toBeDisabled()
    expect(save()).toBeDisabled()
  })

  it('shows a save failure and can dismiss it', async () => {
    mockFetch((_url, init) => (init?.method === 'PUT' ? json({}, 502) : json({ retentionDays: 30, maxRetentionDays: 365 })))
    renderWithProviders(<NotificationRetentionCard />)
    await waitFor(() => expect(field().value).toBe('30'))

    fireEvent.click(save())

    expect(await screen.findByText('HTTP 502')).toBeInTheDocument()
    expect(screen.queryByText('Retention saved.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('HTTP 502')).not.toBeInTheDocument()
  })

  it('reports a network failure', async () => {
    mockFetch(() => Promise.reject(new Error('network down')))
    renderWithProviders(<NotificationRetentionCard />)

    expect(await screen.findByText('network down')).toBeInTheDocument()
  })
})
