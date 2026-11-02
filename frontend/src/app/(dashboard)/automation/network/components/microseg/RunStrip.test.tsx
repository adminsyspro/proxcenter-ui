/**
 * The strip of runs under the banner: a run started on the Policy sub-tab stays
 * visible, and refreshes the policy and the status, whatever sub-tab is shown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegRun } from '@/lib/microseg/types'

import { calls, mock, reply } from './microsegTestKit'
import { db, installFreshMocks, run, setup, web } from './policyTestKit'

installFreshMocks()

const chooseState = async (zoneName: string, label: string) => {
  const row = await screen.findByRole('listitem', { name: zoneName })
  fireEvent.click(within(row).getByRole('button', { name: 'Change state' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: label }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('run strip', () => {
  it('keeps the line and refreshes the policy and the status when the sub-tab is switched mid-run', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    let finish: (r: MicrosegRun) => void = () => undefined
    const pending = new Promise<MicrosegRun>(resolve => { finish = resolve })
    mock.routes['GET /runs/r1'] = async () => reply(200, await pending)
    setup({ zones: [web({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    expect(await screen.findByText(/web: change to observation in progress/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(/web: change to observation in progress/)).toBeTruthy()

    const policyReads = calls('GET /policy').length
    const statusReads = calls('GET /status').length
    await act(async () => { finish(run('done', { guests: 1, members: 1, steps: 1, drifts: 0, done: [{ index: 0, kind: 'guest.tags', object: 'g', summary: 's' }] })) })

    expect(await screen.findByText('web: 1 done, 0 failed, 0 not run')).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(policyReads))
    await waitFor(() => expect(calls('GET /status').length).toBeGreaterThan(statusReads))
  })

  it('keeps the first run line when a second state change starts', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['POST /zones/zd/state'] = () => reply(202, { run_id: 'r2' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    mock.routes['GET /runs/r2'] = () => reply(200, { ...run('running'), id: 'r2' })
    setup({ zones: [web({ state: 'disabled' }), db({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    expect(await screen.findByText(/web: change to observation in progress/)).toBeTruthy()
    await chooseState('db', 'Observe')
    expect(await screen.findByText(/db: change to observation in progress/)).toBeTruthy()
    expect(screen.getByText(/web: change to observation in progress/)).toBeTruthy()
  })

  it('removes a finished run after ten seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('done', { guests: 0, members: 0, steps: 0, drifts: 0 }))
    setup({ zones: [web({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    expect(await screen.findByText('web: 0 done, 0 failed, 0 not run')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
    expect(screen.getByText('web: 0 done, 0 failed, 0 not run')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(screen.queryByText('web: 0 done, 0 failed, 0 not run')).toBeNull()
  })

  it('lets a finished run be dismissed, and keeps a running one without a close button', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('web', 'Observe')
    const line = (await screen.findByText(/web: change to observation in progress/)).closest('[role="alert"]') as HTMLElement
    expect(within(line).queryByRole('button', { name: /close/i })).toBeNull()
  })

  it('dismisses a failed run with its close button', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('failed'))
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('web', 'Observe')
    const line = (await screen.findByText('web: the run failed')).closest('[role="alert"]') as HTMLElement
    fireEvent.click(within(line).getByRole('button', { name: /close/i }))
    expect(screen.queryByText('web: the run failed')).toBeNull()
  })
})
