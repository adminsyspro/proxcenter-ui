/**
 * Component tests for ComplianceTab.tsx — the Run Scan button and its tooltip.
 *
 * MUI drops the tooltip when its direct child is a disabled <button> (and
 * logs "You are providing a disabled button child to the Tooltip
 * component"). The fix wraps the IconButton in a <span> so the Tooltip's
 * listeners land on an element that keeps receiving mouse events. These
 * tests render that wrapped block and prove the tooltip still opens from the
 * span.
 *
 * Reachability note: the button carries `disabled={isLoading}` but lives
 * inside `{!isLoading && data && (...)}`, and SWR's `isLoading` is only true
 * while a request is in flight with no data yet. So the disabled rendering is
 * unreachable by construction — while loading, the whole score card is
 * replaced by the page spinner. The loading test pins that behaviour rather
 * than forcing a state the component cannot produce.
 *
 * The data hook is SWR-backed; renderWithProviders sets
 * `revalidateOnMount: false`, so the initial fetch would never fire. As
 * elsewhere in this suite, `useSWRFetch` is mocked to drive
 * `data` / `isLoading` / `mutate` directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/__tests__/setup/renderWithProviders'

const { swrMock, mutateMock, fetcherMock } = vi.hoisted(() => ({
  swrMock: vi.fn(),
  mutateMock: vi.fn(),
  fetcherMock: vi.fn(),
}))

vi.mock('@/hooks/useSWRFetch', () => ({
  useSWRFetch: (...args: unknown[]) => swrMock(...args),
  fetcher: (...args: unknown[]) => fetcherMock(...args),
}))

// A collection reads the whole cluster: never repeated on focus or reconnect.
const NO_AUTO_REFRESH = expect.objectContaining({ revalidateOnFocus: false, revalidateOnReconnect: false })

import ComplianceTab from './ComplianceTab'

const CONN_ID = 'conn-1'

const LOADED = {
  score: 72,
  summary: { total: 1, passed: 1, failed: 0, warnings: 0, skipped: 0, critical: 0 },
  checks: [
    { id: 'root_tfa', name: 'Root TFA', category: 'access', severity: 'high', status: 'pass', earned: 10, maxPoints: 10, details: 'ok' },
  ],
}

function runScanButton() {
  return screen.getByRole('button', { name: 'Run Scan' })
}

describe('ComplianceTab', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mutateMock.mockResolvedValue(undefined)
    fetcherMock.mockResolvedValue(LOADED)
  })

  it('requests the hardening checks for the connection (and node) it is given', () => {
    swrMock.mockReturnValue({ data: undefined, isLoading: true, mutate: mutateMock })

    renderWithProviders(<ComplianceTab connectionId={CONN_ID} node="pve1" />)

    expect(swrMock).toHaveBeenCalledWith(`/api/v1/compliance/hardening/${CONN_ID}?node=pve1`, NO_AUTO_REFRESH)
  })

  it('shows the page spinner and no Run Scan button while the first scan is loading', () => {
    swrMock.mockReturnValue({ data: undefined, isLoading: true, mutate: mutateMock })

    renderWithProviders(<ComplianceTab connectionId={CONN_ID} />)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    // The score card (and with it the disabled button) is not mounted while
    // loading: `disabled={isLoading}` can never render as disabled.
    expect(document.querySelector('.ri-refresh-line')).toBeNull()
    expect(screen.queryByText('Hardening Score')).not.toBeInTheDocument()
  })

  it('shows the Run Scan tooltip when hovering the span-wrapped button once results are loaded', async () => {
    swrMock.mockReturnValue({ data: LOADED, isLoading: false, mutate: mutateMock })

    renderWithProviders(<ComplianceTab connectionId={CONN_ID} />)

    expect(screen.getByText('Hardening Score')).toBeInTheDocument()

    const button = runScanButton()

    expect(button).toBeEnabled()
    // The regression guard: the Tooltip's child must be the <span>, not the button.
    expect(button.parentElement?.tagName).toBe('SPAN')

    fireEvent.mouseOver(button.parentElement!)

    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent('Run Scan')
  })

  it('asks the server for a fresh collection when the Run Scan button is clicked', async () => {
    swrMock.mockReturnValue({ data: LOADED, isLoading: false, mutate: mutateMock })

    renderWithProviders(<ComplianceTab connectionId={CONN_ID} node="pve1" />)

    fireEvent.click(runScanButton())

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1))
    // Not a plain revalidation, which the server may answer from its cache.
    expect(fetcherMock).toHaveBeenCalledWith(`/api/v1/compliance/hardening/${CONN_ID}?node=pve1&refresh=1`)
    expect(mutateMock).toHaveBeenCalledWith(expect.any(Promise), { revalidate: false })
  })

  it('shows the scan in progress and keeps the button disabled until it ends', async () => {
    let finish: (v: unknown) => void = () => {}
    mutateMock.mockReturnValue(new Promise(resolve => { finish = resolve }))
    swrMock.mockReturnValue({ data: LOADED, isLoading: false, mutate: mutateMock })

    renderWithProviders(<ComplianceTab connectionId={CONN_ID} />)

    fireEvent.click(runScanButton())

    await waitFor(() => expect(runScanButton()).toBeDisabled())
    finish(undefined)
    await waitFor(() => expect(runScanButton()).toBeEnabled())
  })

  it('keeps the previous result when a fresh scan fails', async () => {
    mutateMock.mockRejectedValue(new Error('API error: 500'))
    swrMock.mockReturnValue({ data: LOADED, isLoading: false, mutate: mutateMock })

    renderWithProviders(<ComplianceTab connectionId={CONN_ID} />)

    fireEvent.click(runScanButton())

    await waitFor(() => expect(runScanButton()).toBeEnabled())
    expect(screen.getByText('Root TFA')).toBeInTheDocument()
  })

  it('renders the loaded checks table', () => {
    swrMock.mockReturnValue({ data: LOADED, isLoading: false, mutate: mutateMock })

    renderWithProviders(<ComplianceTab connectionId={CONN_ID} />)

    expect(screen.getByText('Root TFA')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('10/10')).toBeInTheDocument()
  })

  it('asks the user to pick a connection when none is given', () => {
    swrMock.mockReturnValue({ data: undefined, isLoading: false, mutate: mutateMock })

    renderWithProviders(<ComplianceTab connectionId="" />)

    expect(swrMock).toHaveBeenCalledWith(null, NO_AUTO_REFRESH)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
