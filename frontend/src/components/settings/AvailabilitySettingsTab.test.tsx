import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import AvailabilitySettingsTab from './AvailabilitySettingsTab'

const API = '/api/v1/availability/settings'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init))
  vi.stubGlobal('fetch', fn)
  return fn
}

const retention = async () => (await screen.findByLabelText('History retention (days)')) as HTMLInputElement
const target = () => screen.getByLabelText('Default SLA target (%)') as HTMLInputElement

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AvailabilitySettingsTab', () => {
  it('loads both values with a plain help text under each field', async () => {
    mockFetch(() => json({ retentionDays: 400, defaultTarget: 99.9 }))
    renderWithProviders(<AvailabilitySettingsTab />)

    expect((await retention()).value).toBe('400')
    expect(target().value).toBe('99.9')
    expect(screen.getByText(/How many days of availability history the orchestrator keeps. From 30 to 1825 days/)).toBeInTheDocument()
    expect(screen.getByText(/The target a new policy starts with. From 90 to 99.999/)).toBeInTheDocument()
  })

  it('saves both values and confirms', async () => {
    const fetchMock = mockFetch((_url, init) =>
      init?.method === 'PUT' ? json({ retentionDays: 90, defaultTarget: 99.5 }) : json({ retentionDays: 400, defaultTarget: 99.9 }))
    renderWithProviders(<AvailabilitySettingsTab />)

    fireEvent.change(await retention(), { target: { value: '90' } })
    fireEvent.change(target(), { target: { value: '99.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe(API)
    expect(JSON.parse(String(put[1]?.body))).toEqual({ retentionDays: 90, defaultTarget: 99.5 })
  })

  it('shows a 400 by its code, translated', async () => {
    mockFetch((_url, init) =>
      init?.method === 'PUT' ? json({ error: 'invalid_retention' }, 400) : json({ retentionDays: 400, defaultTarget: 99.9 }))
    renderWithProviders(<AvailabilitySettingsTab />)

    fireEvent.change(await retention(), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('The retention must be a whole number of days from 30 to 1825.')).toBeInTheDocument()
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument()
  })

  it('shows an unknown 400 code as the generic failure', async () => {
    mockFetch((_url, init) =>
      init?.method === 'PUT' ? json({ error: 'whatever' }, 400) : json({ retentionDays: 400, defaultTarget: 99.9 }))
    renderWithProviders(<AvailabilitySettingsTab />)

    await retention()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('The settings could not be saved.')).toBeInTheDocument()
  })

  it('shows a 503 as the orchestrator being unavailable', async () => {
    mockFetch((_url, init) =>
      init?.method === 'PUT' ? json({ error: 'orchestrator_unavailable' }, 503) : json({ retentionDays: 400, defaultTarget: 99.9 }))
    renderWithProviders(<AvailabilitySettingsTab />)

    await retention()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('The orchestrator is unavailable, nothing was saved.')).toBeInTheDocument()
  })

  it('shows a load failure without claiming anything was saved, and keeps Save disabled', async () => {
    mockFetch(() => json({ error: 'orchestrator_unavailable' }, 503))
    renderWithProviders(<AvailabilitySettingsTab />)

    expect(await screen.findByText('The settings could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByText(/nothing was saved/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled())
  })

  it('keeps the typed values when the answer has no settings', async () => {
    mockFetch((_url, init) =>
      init?.method === 'PUT' ? json({ success: true, demo: true }) : json({ retentionDays: 400, defaultTarget: 99.9 }))
    renderWithProviders(<AvailabilitySettingsTab />)

    fireEvent.change(await retention(), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    expect((await retention()).value).toBe('90')
    expect(target().value).toBe('99.9')
  })

  it('hides the confirmation as soon as a field changes', async () => {
    mockFetch((_url, init) =>
      init?.method === 'PUT' ? json({ retentionDays: 400, defaultTarget: 99.9 }) : json({ retentionDays: 400, defaultTarget: 99.9 }))
    renderWithProviders(<AvailabilitySettingsTab />)

    await retention()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Settings saved')).toBeInTheDocument()

    fireEvent.change(target(), { target: { value: '99.5' } })
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument()
  })
})
