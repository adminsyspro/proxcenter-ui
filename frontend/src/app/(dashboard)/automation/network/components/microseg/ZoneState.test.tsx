/**
 * Policy sub-tab: zone state changes, their progress line and the enforce confirmation.
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { calls, fetchMock, mock, reply } from './microsegTestKit'
import { body, hoursAgo, run, setup, SUGGESTIONS_ROUTE, suggestion, installFreshMocks, web } from './policyTestKit'

installFreshMocks()


describe('zone state', () => {
  const chooseState = async (label: string) => {
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
  }

  it('moves a zone to observation straight away and follows the run', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('Observe')

    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'observe' })
    expect(await screen.findByText(/web: change to observation in progress/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ends the progress line with the done, failed and not run counts', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    const step = (i: number) => ({ index: i, kind: 'guest.tags', object: 'g', summary: 's' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('done', {
      guests: 3, members: 3, steps: 6, drifts: 0, done: [step(0), step(1), step(2)], failed: [step(3)], not_run: [step(4), step(5)],
    }))
    setup({ zones: [web({ state: 'disabled' })] })
    const before = calls('GET /policy').length
    await chooseState('Observe')
    expect(await screen.findByText('web: 3 done, 1 failed, 2 not run')).toBeTruthy()
    expect(calls('GET /policy').length).toBeGreaterThan(before)
  })

  it('shows a failed run', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, { ...run('failed'), error: 'boom' })
    setup({ zones: [web({ state: 'observe' })] })
    await chooseState('Disable')
    expect(await screen.findByText('web: the run failed')).toBeTruthy()
  })

  it('shows the translated error when the state change is refused', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('Observe')
    expect(await screen.findByText('Another operation is running on this connection. Try again in a moment.')).toBeTruthy()
  })

  it('reloads the policy when the state change hits a version conflict', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    setup({ zones: [web({ state: 'disabled' })] })
    const before = calls('GET /policy').length
    await chooseState('Observe')
    expect(await screen.findByText(/changed elsewhere/)).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
  })

  it('does not offer the state the zone is already in', async () => {
    setup({ zones: [web({ state: 'observe' })] })
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    expect(screen.getByRole('menuitem', { name: 'Observe' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Enforce' }).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('enforcing a zone', () => {
  const chooseEnforce = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Enforce' }))
    return screen.findByRole('dialog')
  }

  it('requires typing the zone name to enforce a zone that is not ready', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () =>
      reply(200, { suggestions: [suggestion(hoursAgo(1))], limit: 200, offset: 0 })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(48) })] })
    const dialog = await chooseEnforce()

    const confirm = await within(dialog).findByRole('button', { name: 'Enforce' }) as HTMLButtonElement
    expect(await within(dialog).findByText(/not ready/)).toBeTruthy()
    expect(confirm.disabled).toBe(true)

    const field = within(dialog).getByLabelText('Type web to confirm')
    fireEvent.change(field, { target: { value: 'we' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'web' } })
    expect(confirm.disabled).toBe(false)

    fireEvent.click(confirm)
    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'enforce' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('asks for a plain confirmation when the zone is ready', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () =>
      reply(200, { suggestions: [suggestion(hoursAgo(30))], limit: 200, offset: 0 })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(48) })] })
    const dialog = await chooseEnforce()

    const confirm = await within(dialog).findByRole('button', { name: 'Enforce' }) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    expect(within(dialog).queryByLabelText(/Type web to confirm/)).toBeNull()
    fireEvent.click(confirm)
    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
  })

  it('treats a zone observed for less than the window as not ready', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(2) })] })
    const dialog = await chooseEnforce()
    expect(await within(dialog).findByLabelText('Type web to confirm')).toBeTruthy()
  })

  it('treats the zone as not ready when the suggestions cannot be read', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(48) })] })
    const dialog = await chooseEnforce()
    expect(await within(dialog).findByLabelText('Type web to confirm')).toBeTruthy()
    expect(within(dialog).getByText(/could not be checked/)).toBeTruthy()
  })

  it('sends nothing when the dialog is cancelled', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(2) })] })
    const dialog = await chooseEnforce()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/state') && (i as RequestInit)?.method === 'POST')).toBe(false)
  })
})
