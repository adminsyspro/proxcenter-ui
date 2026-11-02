/**
 * Micro-segmentation tab: shell, first run guide, errors and sub-tabs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, policy, renderTab, reply, resetMocks, status, zone, REVISION_HEAD } from './microsegTestKit'

beforeEach(resetMocks)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('first run guide', () => {
  beforeEach(() => {
    mock.routes['GET /policy'] = () => reply(200, policy())
  })

  it('shows the first run guide when the policy has no revision and no zone', async () => {
    renderTab()
    expect(await screen.findByText('Set up micro-segmentation')).toBeTruthy()
    expect(screen.getByText('Run the pre-flight checks')).toBeTruthy()
    expect(screen.getByText('Create your first zone')).toBeTruthy()
    expect(screen.getByText('Preview the plan')).toBeTruthy()
  })

  it('does not show it once a zone exists', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')] }))
    renderTab()
    await screen.findByRole('tab', { name: 'Policy' })
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(0))
    expect(screen.queryByText('Set up micro-segmentation')).toBeNull()
  })

  it('does not show it once a revision exists', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ last_revision: REVISION_HEAD }))
    renderTab()
    await screen.findByRole('tab', { name: 'Policy' })
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(0))
    expect(screen.queryByText('Set up micro-segmentation')).toBeNull()
  })

  it('switches to the relevant sub-tab, or opens the plan, from its buttons', async () => {
    renderTab()
    await screen.findByText('Set up micro-segmentation')

    fireEvent.click(screen.getByRole('button', { name: 'Open the policy' }))
    expect(screen.getByRole('tab', { name: 'Policy' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Open the overview' }))
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'View plan' }))
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation plan' })).toBeTruthy()
  })
})

describe('errors', () => {
  it('shows a translated error with a retry button when the orchestrator is down', async () => {
    let up = false
    mock.routes['GET /policy'] = () => (up ? reply(200, policy({ zones: [zone('a')] })) : reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'upstream' }))
    renderTab()

    expect(await screen.findByText('The orchestrator returned an error.')).toBeTruthy()
    expect(screen.queryByText('ORCHESTRATOR_ERROR')).toBeNull()

    up = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeTruthy()
    expect(screen.queryByText('The orchestrator returned an error.')).toBeNull()
  })

  it('shows the network message when the relay cannot be reached', async () => {
    mock.routes['GET /policy'] = () => { throw new TypeError('fetch failed') }
    renderTab()
    expect(await screen.findByText('ProxCenter cannot be reached. Check your network connection.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('offers no retry for an error that trying again cannot cure', async () => {
    mock.routes['GET /policy'] = () => reply(403, { code: 'FEATURE_REQUIRED', error: 'x' })
    renderTab()
    expect(await screen.findByText('Micro-segmentation requires an Enterprise license.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows the generic message for an unknown code', async () => {
    mock.routes['GET /policy'] = () => reply(500, { code: 'WHATEVER', error: 'x' })
    renderTab()
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy()
  })

  it('keeps the page and offers a retry when only the status fails', async () => {
    let ok = false
    mock.routes['GET /status'] = () => (ok ? reply(200, status()) : reply(504, { code: 'ORCHESTRATOR_TIMEOUT', error: 't' }))
    renderTab()
    expect(await screen.findByText('The orchestrator did not answer in time.')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Policy' })).toBeTruthy()

    ok = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('3 of 5 running guests in a zone')).toBeTruthy()
  })
})

describe('sub-tabs', () => {
  it('lists the five sub-tabs and starts on the overview', async () => {
    renderTab()
    for (const name of ['Overview', 'Policy', 'Observation', 'Drifts', 'History']) {
      expect(await screen.findByRole('tab', { name })).toBeTruthy()
    }
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
  })

  it('remembers the selected sub-tab', async () => {
    const first = renderTab()
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }))
    first.unmount()

    renderTab()
    const tab = await screen.findByRole('tab', { name: 'History' })
    expect(tab.getAttribute('aria-selected')).toBe('true')
  })

  it('works when localStorage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    try {
      renderTab()
      fireEvent.click(await screen.findByRole('tab', { name: 'Drifts' }))
      expect(screen.getByRole('tab', { name: 'Drifts' }).getAttribute('aria-selected')).toBe('true')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('ignores a stored value that is not a sub-tab', async () => {
    window.localStorage.setItem('microseg.subTab', 'nonsense')
    renderTab()
    const tab = await screen.findByRole('tab', { name: 'Overview' })
    expect(tab.getAttribute('aria-selected')).toBe('true')
  })
})

