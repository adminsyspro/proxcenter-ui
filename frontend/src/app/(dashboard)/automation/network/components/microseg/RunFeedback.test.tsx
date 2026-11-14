/**
 * What the page says while a run writes Proxmox: the pending changes are "being applied" with no button to discard
 * or plan them, the zone whose state changes shows it, and a run still going on when the tab opens is followed again.
 */

import { describe, expect, it } from 'vitest'
import { act, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegRun } from '@/lib/microseg/types'

import { REVISION_HEAD, mock, policy, reply } from './microsegTestKit'
import { installFreshMocks, run, setup, web } from './policyTestKit'

installFreshMocks()

const chooseState = async (zoneName: string, label: string) => {
  const row = await screen.findByRole('listitem', { name: zoneName })
  fireEvent.click(within(row).getByRole('button', { name: 'Change state' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: label }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: label }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

const done = () => run('done', { guests: 1, members: 1, steps: 1, drifts: 0, done: [{ index: 0, kind: 'guest.tags', object: 'g', summary: 's' }] })

describe('feedback while a run writes Proxmox', () => {
  it('says the pending changes are being applied, without the buttons to discard or plan them', async () => {
    // As the engine does: the state change puts the zone in the draft, pending until the run has written it.
    let pendingNow = false
    mock.routes['POST /zones/zw/state'] = () => { pendingNow = true; return reply(202, { run_id: 'r1' }) }
    let finish: (r: MicrosegRun) => void = () => undefined
    const pending = new Promise<MicrosegRun>(resolve => { finish = resolve })
    mock.routes['GET /runs/r1'] = async () => reply(200, await pending)
    setup({ zones: [web({ state: 'disabled' })] })
    mock.routes['GET /policy'] = () => reply(200, policy({
      zones: [web({ state: 'disabled' })], flows: [], pending_members: [], last_revision: REVISION_HEAD, pending_changes: pendingNow,
    }))

    await chooseState('web', 'Observe')

    expect(await screen.findByText(/being applied/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review and apply' })).toBeNull()
    expect(screen.queryByText(/^Not applied yet|^Changes not applied yet/)).toBeNull()

    pendingNow = false
    await act(async () => { finish(done()) })
    expect(await screen.findByText('web: 1 done, 0 failed, 0 not run')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(/being applied/i)).toBeNull())
  })

  it('shows on the zone that its state is being changed, and takes no other state meanwhile', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    let finish: (r: MicrosegRun) => void = () => undefined
    const pending = new Promise<MicrosegRun>(resolve => { finish = resolve })
    mock.routes['GET /runs/r1'] = async () => reply(200, await pending)
    setup({ zones: [web({ state: 'disabled' })] })

    const row = await screen.findByRole('listitem', { name: 'web' })
    expect(within(row).queryByLabelText('State change in progress')).toBeNull()
    await chooseState('web', 'Observe')

    expect(await within(row).findByLabelText('State change in progress')).toBeTruthy()
    expect((within(row).getByRole('button', { name: 'Change state' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { finish(done()) })
    await waitFor(() => expect(within(row).queryByLabelText('State change in progress')).toBeNull())
    expect((within(row).getByRole('button', { name: 'Change state' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('follows again an application still running when the tab opens', async () => {
    mock.routes['GET /runs?limit=100'] = () => reply(200, {
      runs: [
        { ...run('running'), id: 'full1', kind: 'full' },
        { ...run('running'), id: 'r9', kind: 'apply' },
        { ...run('done'), id: 'old', kind: 'apply' },
      ],
      limit: 100, offset: 0,
    })
    mock.routes['GET /runs/r9'] = () => reply(200, { ...run('running', { progress: { phase: 'writing', done: 3, total: 9 } } as MicrosegRun['result']), id: 'r9', kind: 'apply' })
    setup({ zones: [web()] })

    const line = (await screen.findByText('Plan apply in progress')).closest('[role="alert"]') as HTMLElement
    expect(await within(line).findByText('writing to Proxmox, 3 / 9')).toBeTruthy()
    // Only the application: neither the engine's own full run nor the application that ended.
    expect(screen.getByTestId('microseg-run-strip').querySelectorAll('[role="alert"]').length).toBe(1)
  })

  it('opens with no line when no application is running', async () => {
    mock.routes['GET /runs?limit=100'] = () => reply(200, { runs: [{ ...run('done'), id: 'old', kind: 'apply' }], limit: 100, offset: 0 })
    setup({ zones: [web()] })

    await screen.findByRole('listitem', { name: 'web' })
    expect(screen.queryByTestId('microseg-run-strip')).toBeNull()
  })

  it('floats a copy of the strip under the page header once its place has scrolled above it', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running', { progress: { phase: 'writing', done: 3, total: 9 } } as MicrosegRun['result']))
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('web', 'Observe')

    const place = await screen.findByTestId('microseg-run-strip')
    await within(place).findByText('writing to Proxmox, 3 / 9')
    expect(screen.queryByTestId('microseg-run-strip-floating')).toBeNull()

    // jsdom lays nothing out: the place is said to end 260 px above the top of the window, 900 px wide.
    const rect = (top: number) => ({ top, left: 120, width: 900, bottom: top + 40, right: 1020, height: 40, x: 120, y: top, toJSON: () => ({}) })
    place.getBoundingClientRect = () => rect(-300)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    const floating = await screen.findByTestId('microseg-run-strip-floating')
    expect(floating.style.top).toBe('8px')
    expect(floating.style.left).toBe('120px')
    expect(floating.style.width).toBe('900px')
    expect(await within(floating).findByText(/web: change to observation in progress/)).toBeTruthy()
    expect(within(floating).getByText('writing to Proxmox, 3 / 9')).toBeTruthy()
    // The page keeps its own line, the only one announced.
    expect(within(place).getByText(/web: change to observation in progress/)).toBeTruthy()
    expect(within(floating).queryByRole('alert')).toBeNull()

    place.getBoundingClientRect = () => rect(200)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    await waitFor(() => expect(screen.queryByTestId('microseg-run-strip-floating')).toBeNull())
    expect(within(place).getByText('writing to Proxmox, 3 / 9')).toBeTruthy()
  })
})
