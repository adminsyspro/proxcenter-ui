import type { ReactElement } from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enMessages from '@/messages/en.json'

import Page from './page'

// Not renderWithProviders: its setup stubs next/navigation, and this file
// needs its own router and search params.
const renderWithProviders = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale='en' messages={enMessages as Record<string, unknown>}>
      <ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>
    </NextIntlClientProvider>,
  )

const { licenseMock, replaceMock, searchMock, setPageInfoMock, settingsMock } = vi.hoisted(() => ({
  settingsMock: vi.fn(),
  licenseMock: vi.fn(),
  replaceMock: vi.fn(),
  searchMock: vi.fn(),
  setPageInfoMock: vi.fn(),
}))

vi.mock('@/contexts/LicenseContext', () => ({
  Features: { SLA_MONITORING: 'sla_monitoring' },
  useLicense: () => licenseMock(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => searchMock(),
  usePathname: () => '/',
}))
vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: setPageInfoMock }) }))
vi.mock('./components/OverviewTab', async () => {
  const { useIncidentDialog } = await import('./components/IncidentDialogContext')

  return {
    default: function OverviewTab() {
      const { open } = useIncidentDialog()

      return (
        <div>
          overview body
          <button onClick={() => open('i1')}>open incident</button>
          <button onClick={() => open(null, 'a1')}>open alert</button>
        </div>
      )
    },
  }
})
vi.mock('./components/MeasuredConnectionsDialog', () => ({
  useMeasuredSettings: () => settingsMock(),
  default: (p: { open: boolean; measured: string[] }) => <div data-testid='measured' data-open={String(p.open)} data-measured={p.measured.join(',')} />,
}))
vi.mock('@/components/incidents/IncidentDialog', () => ({
  default: (p: { open: boolean; incidentId: string | null; seedAlertId?: string }) => (
    <div data-testid='drawer' data-open={String(p.open)} data-incident={p.incidentId ?? ''} data-seed={p.seedAlertId ?? ''} />
  ),
}))

beforeEach(() => {
  licenseMock.mockReset()
  replaceMock.mockReset()
  searchMock.mockReset().mockReturnValue(new URLSearchParams())
  setPageInfoMock.mockReset()
  settingsMock.mockReset().mockReturnValue({ data: undefined })
})

afterEach(cleanup)

describe('availability page', () => {
  it('sets the navbar title and clears it on unmount', () => {
    licenseMock.mockReturnValue({ hasFeature: () => false })

    const { unmount } = renderWithProviders(<Page />)

    expect(setPageInfoMock).toHaveBeenCalledWith(enMessages.availability.title, enMessages.availability.subtitle, 'ri-heart-pulse-line')
    unmount()
    expect(setPageInfoMock).toHaveBeenLastCalledWith('', '', '')
  })

  it('shows the Enterprise prompt and none of the page without sla_monitoring', () => {
    licenseMock.mockReturnValue({ hasFeature: () => false, loading: false })

    renderWithProviders(<Page />)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByText('overview body')).not.toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(enMessages.availability.title)).length).toBeGreaterThan(0)
  })

  it('shows the three tabs with sla_monitoring', () => {
    licenseMock.mockReturnValue({ hasFeature: (id: string) => id === 'sla_monitoring' })

    renderWithProviders(<Page />)

    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Overview', 'Policies', 'Maintenance'])
  })

  it('opens the tab named by ?tab= when the feature allows it', () => {
    licenseMock.mockReturnValue({ hasFeature: () => true })
    searchMock.mockReturnValue(new URLSearchParams('tab=policies'))

    renderWithProviders(<Page />)

    expect(screen.getByRole('tab', { name: 'Policies' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('overview body')).not.toBeInTheDocument()
  })

  it('falls back to the overview when ?tab= names an unknown tab', () => {
    licenseMock.mockReturnValue({ hasFeature: () => true })
    searchMock.mockReturnValue(new URLSearchParams('tab=nope'))

    renderWithProviders(<Page />)

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('overview body')).toBeInTheDocument()
  })

  it('writes the tab to the URL when it changes', async () => {
    licenseMock.mockReturnValue({ hasFeature: () => true })

    renderWithProviders(<Page />)

    await userEvent.click(screen.getByRole('tab', { name: 'Maintenance' }))

    expect(replaceMock).toHaveBeenCalledWith('?tab=maintenance')
  })

  it('mounts the incident panel at the first opening only, on what the tab asked for', async () => {
    licenseMock.mockReturnValue({ hasFeature: () => true })

    renderWithProviders(<Page />)

    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'open incident' }))
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-incident', 'i1')
    await userEvent.click(screen.getByRole('button', { name: 'open alert' }))
    expect(screen.getAllByTestId('drawer')).toHaveLength(1)
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-seed', 'a1')
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-incident', '')
  })

  it('opens the measured connections from the settings button, offered to whoever reads the settings only', async () => {
    licenseMock.mockReturnValue({ hasFeature: (id: string) => id === 'sla_monitoring' })
    renderWithProviders(<Page />)
    expect(screen.queryByRole('button', { name: 'Measured connections' })).not.toBeInTheDocument()
    cleanup()

    settingsMock.mockReturnValue({ data: { measuredConnections: ['c1'] } })
    renderWithProviders(<Page />)
    expect(screen.getByTestId('measured')).toHaveAttribute('data-open', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Measured connections' }))
    expect(screen.getByTestId('measured')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('measured')).toHaveAttribute('data-measured', 'c1')
  })
})

