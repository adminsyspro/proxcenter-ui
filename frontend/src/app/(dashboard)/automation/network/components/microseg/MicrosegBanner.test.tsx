/**
 * Micro-segmentation banner: held writes, pause, emergency stop and the pending
 * changes bar (rendered through the tab). The engine state and the coverage live on the Dashboard tab.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import {
  calls, flow, mock, policy, renderTab, reply, resetMocks, revisionWithSnapshot, status, zone, REVISION_HEAD,
} from './microsegTestKit'

beforeEach(resetMocks)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The status was read and the banner drew itself: the stop button is there and the spinner is gone. */
const bannerReady = async () => {
  await screen.findByRole('button', { name: 'Emergency stop' })
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
}

describe('banner: only what needs an action', () => {
  it('shows neither the engine runs, the API calls, the coverage nor the zones by state (they are on the Dashboard tab)', async () => {
    mock.routes['GET /status'] = () => reply(200, status({
      engine: {
        paused_until: null, held: false, last_log: null,
        last_runs: {
          apply: { started_at: '2026-11-02T10:00:00Z', status: 'done', api_calls: 42, writes: 7 },
          full: { started_at: '2026-11-02T10:05:00Z', status: 'done', api_calls: 9, writes: 0 },
        },
      },
    }))
    renderTab()
    await bannerReady()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/API call/)
    expect(text).not.toMatch(/running guests in a zone|members protected|No run yet|Coverage/)
    expect(screen.queryByText(/^(Disabled|Observation|Enforced): \d/)).toBeNull()
    expect(screen.queryByRole('img', { name: 'Done' })).toBeNull()
  })

  it('shows the pause as a warning chip', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ engine: { paused_until: '2099-01-01T10:00:00Z', held: false, last_runs: {}, last_log: null } }))
    renderTab()
    const chip = await screen.findByText(/^Paused until /)
    expect(chip.closest('.MuiChip-root')).toBeTruthy()
  })

  it('hides the pause once paused_until is in the past', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ engine: { paused_until: '2020-01-01T10:00:00Z', held: false, last_runs: {}, last_log: null } }))
    renderTab()
    await bannerReady()
    expect(screen.queryByText(/^Paused until /)).toBeNull()
  })

  it('warns that the status was not refreshed when a refresh fails after a first success', async () => {
    let down = false
    mock.routes['GET /status'] = () => (down ? reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' }) : reply(200, status()))
    mock.routes['POST /emergency-stop'] = () => { down = true; return reply(200, { accepted: true, applied_by: 'self', on: true }) }
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    expect(await screen.findByText('Status not refreshed, retrying')).toBeTruthy()
  })
})

describe('banner: held writes', () => {
  beforeEach(() => {
    let held = true
    mock.routes['GET /status'] = () => reply(200, status({ engine: { paused_until: null, held, last_runs: {}, last_log: null } }))
    mock.routes['POST /confirm-writes'] = () => { held = false; return reply(200, { ok: true, was_held: true }) }
  })

  it('shows a warning with a Confirm writes button that asks first, then confirms and reloads', async () => {
    renderTab()
    expect(await screen.findByText('Writes on hold')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm writes' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Confirm the held writes?')).toBeTruthy()
    expect(calls('POST /confirm-writes')).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm writes' }))
    await waitFor(() => expect(calls('POST /confirm-writes')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('Writes on hold')).toBeNull())
    expect(calls('GET /status').length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText('Writes confirmed')).toBeTruthy()
  })

  it('does nothing when the confirmation is cancelled', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm writes' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls('POST /confirm-writes')).toHaveLength(0)
  })

  it('shows a translated error when the confirmation fails', async () => {
    mock.routes['POST /confirm-writes'] = () => reply(503, { code: 'NOT_LEADER', error: 'x' })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm writes' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm writes' }))
    expect(await screen.findByText('This orchestrator node is not the leader. Try again in a moment.')).toBeTruthy()
  })
})

describe('banner: emergency stop', () => {
  it('asks for confirmation before the emergency stop', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: true })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Stop micro-segmentation?')).toBeTruthy()
    expect(calls('POST /emergency-stop')).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls('POST /emergency-stop')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Emergency stop' }))
    const again = await screen.findByRole('dialog')
    fireEvent.click(within(again).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
    expect(JSON.parse(calls('POST /emergency-stop')[0][1]!.body as string)).toEqual({ on: true })
  })

  it('tells that the leader applies a 202 answer within a minute', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(202, { accepted: true, applied_by: 'leader', on: true })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    expect(await screen.findByText('Request accepted: the leader orchestrator applies it within a minute.')).toBeTruthy()
  })

  it('does not show that message for a 200 answer', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: true })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(/within a minute/)).toBeNull()
  })

  it('shows a persistent red banner with Resume while the stop is on, and resumes after a confirmation', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true }))
    mock.routes['POST /emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: false })
    renderTab()

    const alert = (await screen.findByText('Emergency stop active: every zone is in observation')).closest('[role="alert"]') as HTMLElement
    expect(alert.className).toContain('MuiAlert-filledError')
    expect(screen.queryByRole('button', { name: 'Emergency stop' })).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Resume micro-segmentation?')).toBeTruthy()
    expect(calls('POST /emergency-stop')).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
    expect(JSON.parse(calls('POST /emergency-stop')[0][1]!.body as string)).toEqual({ on: false })
  })

  it('tells it too when a follower relays the resume to the leader', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true }))
    mock.routes['POST /emergency-stop'] = () => reply(202, { accepted: true, applied_by: 'leader', on: false })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText('Request accepted: the leader orchestrator applies it within a minute.')).toBeTruthy()
  })

  it('reaches the stop while /status is still loading', async () => {
    mock.routes['GET /status'] = () => new Promise(() => {})
    mock.routes['POST /emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: true })
    renderTab()
    const button = await screen.findByRole('button', { name: 'Emergency stop' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
    expect(JSON.parse(calls('POST /emergency-stop')[0][1]!.body as string)).toEqual({ on: true })
  })

  it('reaches the stop while /status fails, with Resume still waiting for the state', async () => {
    mock.routes['GET /status'] = () => reply(504, { code: 'ORCHESTRATOR_TIMEOUT', error: 't' })
    mock.routes['POST /emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: true })
    renderTab()
    expect(await screen.findByText('The orchestrator did not answer in time.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Emergency stop' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
  })

  it('drops the leader message once the status shows the stop', async () => {
    let on = false
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: on }))
    mock.routes['POST /emergency-stop'] = () => { on = true; return reply(202, { accepted: true, applied_by: 'leader', on: true }) }
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    await screen.findByText('Emergency stop active: every zone is in observation')
    expect(screen.queryByText('Request accepted: the leader orchestrator applies it within a minute.')).toBeNull()
  })

  it('clears the leader message when the next action starts', async () => {
    let answer = reply(202, { accepted: true, applied_by: 'leader', on: true })
    mock.routes['POST /emergency-stop'] = () => answer
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Emergency stop' }))
    const message = 'Request accepted: the leader orchestrator applies it within a minute.'
    expect(await screen.findByText(message)).toBeTruthy()

    answer = reply(200, { accepted: true, applied_by: 'self', on: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Emergency stop' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText(message)).toBeNull())
  })

  it('shows a translated error when the stop is refused', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(403, { code: 'FORBIDDEN', error: 'no' })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    expect(await screen.findByText('You do not have permission to do this.')).toBeTruthy()
  })
})

describe('banner: pending changes', () => {
  const draftZones = [zone('a'), zone('b'), zone('c')]

  it('shows the pending changes bar with its count once the last revision snapshot is loaded', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: draftZones, flows: [flow('f1')], last_revision: REVISION_HEAD, pending_changes: true }))
    mock.routes['GET /revisions?limit=1'] = () => reply(200, { revisions: [revisionWithSnapshot([zone('a')], [])] })
    renderTab()

    // 2 zones added + 1 flow added
    expect(await screen.findByText('3 unapplied changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View plan' }))
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation plan' })).toBeTruthy()
  })

  it('shows "unapplied changes" without a number while the snapshot is not loaded, or when it cannot be', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: draftZones, last_revision: REVISION_HEAD, pending_changes: true }))
    mock.routes['GET /revisions?limit=1'] = () => reply(500, { code: 'INTERNAL', error: 'boom' })
    renderTab()

    expect(await screen.findByText('Unapplied changes')).toBeTruthy()
    await waitFor(() => expect(calls('GET /revisions?limit=1').length).toBeGreaterThan(0))
    expect(screen.queryByText(/^\d+ unapplied change/)).toBeNull()
    expect(screen.getByText('Unapplied changes')).toBeTruthy()
  })

  it('counts against nothing when no revision exists yet, without reading revisions', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], flows: [flow('f1')], last_revision: null, pending_changes: true }))
    renderTab()
    expect(await screen.findByText('2 unapplied changes')).toBeTruthy()
    expect(calls('GET /revisions?limit=1')).toHaveLength(0)
  })

  it('shows no bar when nothing is pending', async () => {
    renderTab()
    await bannerReady()
    expect(screen.queryByText(/unapplied change/i)).toBeNull()
  })

  it('does not read revisions when nothing is pending', async () => {
    renderTab()
    await bannerReady()
    expect(calls('GET /revisions?limit=1')).toHaveLength(0)
  })
})
