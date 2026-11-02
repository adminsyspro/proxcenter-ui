/**
 * Micro-segmentation banner: engine, coverage, zones, held writes, emergency
 * stop and the pending changes bar (rendered through the tab).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import MicrosegTab from './MicrosegTab'
import {
  calls, flow, mock, policy, renderTab, reply, resetMocks, revisionWithSnapshot, status, zone, REVISION_HEAD,
} from './microsegTestKit'

beforeEach(resetMocks)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('banner: engine, coverage and zones', () => {
  it('shows coverage, zones by state and the last run of each kind', async () => {
    mock.routes['GET /status'] = () => reply(200, status({
      engine: {
        paused_until: null, held: false, last_log: null,
        last_runs: { apply: { started_at: '2026-11-02T10:00:00Z', status: 'done', api_calls: 42, writes: 7 } },
      },
    }))
    renderTab()
    expect(await screen.findByText('3 of 5 running guests in a zone')).toBeTruthy()
    expect(screen.getByText('2 of 3 members protected')).toBeTruthy()
    expect(screen.getByText('Disabled: 1')).toBeTruthy()
    expect(screen.getByText('Observation: 2')).toBeTruthy()
    expect(screen.getByText('Enforced: 0')).toBeTruthy()
    expect(screen.getByText(/^Apply: .*42 API calls$/)).toBeTruthy()
  })

  it('says so when no run happened yet', async () => {
    renderTab()
    expect(await screen.findByText('No run yet')).toBeTruthy()
  })

  it('shows the pause as a warning chip', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ engine: { paused_until: '2099-01-01T10:00:00Z', held: false, last_runs: {}, last_log: null } }))
    renderTab()
    const chip = await screen.findByText(/^Paused until /)
    expect(chip.closest('.MuiChip-root')).toBeTruthy()
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
    const onOpenPlan = vi.fn()
    renderTab(<MicrosegTab connectionId="c1" onOpenPlan={onOpenPlan} />)

    // 2 zones added + 1 flow added
    expect(await screen.findByText('3 unapplied changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View plan' }))
    expect(onOpenPlan).toHaveBeenCalledTimes(1)
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
    await screen.findByText('3 of 5 running guests in a zone')
    expect(screen.queryByText(/unapplied change/i)).toBeNull()
  })

  it('does not read revisions when nothing is pending', async () => {
    renderTab()
    await screen.findByText('3 of 5 running guests in a zone')
    expect(calls('GET /revisions?limit=1')).toHaveLength(0)
  })
})
