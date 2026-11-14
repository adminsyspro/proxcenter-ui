import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server } from '@/__tests__/setup/msw-server'

import SyncIntervalDialog from './SyncIntervalDialog'
import SyncIntervalButton, { canChangeSyncInterval } from './SyncIntervalButton'

const jobs = [
  { jobId: 'j1', name: 'web-1', syncIntervalSec: 300, suggestedSyncIntervalSec: 3600 },
  { jobId: 'j2', name: 'web-2', syncIntervalSec: 300, suggestedSyncIntervalSec: 900 },
  { jobId: 'j3', name: 'db-1', syncIntervalSec: 60, suggestedSyncIntervalSec: null },
]
const box = (testId: string) => screen.getByTestId(testId).querySelector('input[type="checkbox"]') as HTMLInputElement
const value = () => screen.getByTestId('sync-interval-value')

afterEach(() => cleanup())

describe('SyncIntervalDialog on one migration', () => {
  const single = (bodies: any[], status = 200, answer: any = { data: { syncIntervalSec: 900, overridden: true } }) => server.use(
    http.patch('*/api/v1/migrations/j1/sync-interval', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(answer, { status }) }),
  )

  it('starts on the interval in force and shows the suggestion without applying it', () => {
    renderWithProviders(<SyncIntervalDialog open jobId="j1" jobs={[jobs[1]]} defaultSyncIntervalSec={3600} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(value()).toHaveTextContent('5 min')
    expect(screen.getByTestId('sync-interval-suggestion')).toHaveTextContent('15 min')
    expect(screen.getByTestId('sync-interval-default')).toHaveTextContent('1 h')
    expect(screen.queryByTestId('sync-interval-all')).toBeNull()
  })

  it('moves the slider to the suggestion, then sends it on confirmation', async () => {
    const bodies: any[] = []
    single(bodies)
    const onDone = vi.fn()
    const onClose = vi.fn()
    renderWithProviders(<SyncIntervalDialog open jobId="j1" jobs={[jobs[1]]} onClose={onClose} onDone={onDone} />)

    fireEvent.click(screen.getByTestId('sync-interval-use-suggestion'))
    expect(value()).toHaveTextContent('15 min')
    expect(bodies).toEqual([])
    fireEvent.click(screen.getByTestId('sync-interval-confirm'))

    await waitFor(() => expect(bodies).toEqual([{ syncIntervalSec: 900 }]))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onDone).toHaveBeenCalled()
  })

  it('goes back to the setting of the source connection', async () => {
    const bodies: any[] = []
    single(bodies)
    renderWithProviders(<SyncIntervalDialog open jobId="j1" jobs={[jobs[1]]} defaultSyncIntervalSec={3600} onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.click(screen.getByTestId('sync-interval-default'))

    await waitFor(() => expect(bodies).toEqual([{ syncIntervalSec: null }]))
  })

  it('says there is no suggestion yet before two syncs', () => {
    renderWithProviders(<SyncIntervalDialog open jobId="j3" jobs={[jobs[2]]} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByTestId('sync-interval-suggestion')).toHaveTextContent(/No suggestion yet/)
    expect(screen.queryByTestId('sync-interval-use-suggestion')).toBeNull()
  })

  it('stays open with the reason when the server refuses', async () => {
    single([], 400, { error: 'Only a warm migration that waits for a manual cutover has an interval between two syncs' })
    const onClose = vi.fn()
    renderWithProviders(<SyncIntervalDialog open jobId="j1" jobs={[jobs[1]]} onClose={onClose} onDone={vi.fn()} />)

    fireEvent.click(screen.getByTestId('sync-interval-confirm'))

    expect(await screen.findByTestId('sync-interval-error')).toHaveTextContent(/Only a warm migration/)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('cutover estimate', () => {
  const MB = 1048576
  const measure = { changeRateBytesPerSec: 1 * MB, throughputBytesPerSec: 50 * MB, passOverheadSec: 10, fixedDowntimeSec: 50 }

  it('follows the slider: the catch-up sync grows with the interval, the downtime hardly does', () => {
    renderWithProviders(<SyncIntervalDialog open jobId="j1" jobs={[{ jobId: 'j1', name: 'db', syncIntervalSec: 60, suggestedSyncIntervalSec: 3600, measure }]} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByTestId('sync-interval-estimate')).toHaveTextContent('catch-up sync up to 11 s')
    expect(screen.getByTestId('sync-interval-estimate')).toHaveTextContent('downtime about 50 s')
    fireEvent.click(screen.getByTestId('sync-interval-use-suggestion'))
    expect(screen.getByTestId('sync-interval-estimate')).toHaveTextContent('catch-up sync up to 1 min 22 s')
    expect(screen.getByTestId('sync-interval-estimate')).toHaveTextContent('downtime about 52 s')
  })

  it('sets the estimate against the downtime the migration aims at, and flags an estimate above it', () => {
    renderWithProviders(<SyncIntervalDialog open batchId="b1" jobs={[
      { jobId: 'a', name: 'fits', syncIntervalSec: 60, measure: { ...measure, targetDowntimeSec: 300 } },
      { jobId: 'b', name: 'tight', syncIntervalSec: 60, measure: { ...measure, targetDowntimeSec: 30 } },
    ]} onClose={vi.fn()} onDone={vi.fn()} />)

    // the tightest target of the selection is the one the worst estimate is read against
    expect(screen.getByTestId('sync-interval-estimate')).toHaveTextContent('downtime about 50 s (target 30 s)')
    expect(screen.getByTestId('sync-interval-estimate-over')).toBeInTheDocument()
    fireEvent.click(box('sync-interval-row-b'))
    expect(screen.getByTestId('sync-interval-estimate')).toHaveTextContent('downtime about 50 s (target 5 min)')
    expect(screen.queryByTestId('sync-interval-estimate-over')).toBeNull()
  })

  it('names no target for a migration measured before one was recorded', () => {
    renderWithProviders(<SyncIntervalDialog open jobId="j1" jobs={[{ jobId: 'j1', name: 'db', syncIntervalSec: 60, measure }]} onClose={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByTestId('sync-interval-estimate')).not.toHaveTextContent('target')
  })

  it('shows the worst of the selected VMs on a batch, and says when nothing was measured yet', () => {
    const busy = { ...measure, changeRateBytesPerSec: 10 * MB }
    renderWithProviders(<SyncIntervalDialog open batchId="b1" jobs={[
      { jobId: 'a', name: 'quiet', syncIntervalSec: 3600, measure },
      { jobId: 'b', name: 'busy', syncIntervalSec: 3600, measure: busy },
    ]} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByTestId('sync-interval-estimate')).toHaveTextContent('catch-up sync up to 12 min 10 s')
    fireEvent.click(box('sync-interval-row-a'))
    fireEvent.click(box('sync-interval-row-b'))
    expect(screen.getByTestId('sync-interval-estimate')).toHaveTextContent(/available after two syncs/)
  })
})

describe('SyncIntervalDialog on a batch', () => {
  const batch = (bodies: any[], answer: any = { data: { updated: ['j1', 'j2', 'j3'], skipped: [] } }) => server.use(
    http.post('*/api/v1/migrations/batches/b1/sync-interval', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(answer) }),
  )

  it('lists the waiting VMs with their interval and suggestion, all selected', () => {
    renderWithProviders(<SyncIntervalDialog open batchId="b1" jobs={jobs} onClose={vi.fn()} onDone={vi.fn()} />)

    for (const j of jobs) expect(box(`sync-interval-row-${j.jobId}`).checked).toBe(true)
    expect(screen.getByTestId('sync-interval-row-j1')).toHaveTextContent('5 min, suggested 1 h')
    expect(screen.getByTestId('sync-interval-row-j3')).toHaveTextContent('1 min')
    expect(screen.getByTestId('sync-interval-confirm')).toHaveTextContent('3')
  })

  it('does not repeat a suggestion equal to the interval in force', () => {
    renderWithProviders(<SyncIntervalDialog open batchId="b1" jobs={[{ jobId: 'j9', name: 'same', syncIntervalSec: 900, suggestedSyncIntervalSec: 900 }]} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByTestId('sync-interval-row-j9')).toHaveTextContent('15 min')
    expect(screen.getByTestId('sync-interval-row-j9')).not.toHaveTextContent('suggested')
  })

  it('suggests the shortest interval of the selection, and none while a selected VM has none', () => {
    renderWithProviders(<SyncIntervalDialog open batchId="b1" jobs={jobs} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByTestId('sync-interval-suggestion')).toHaveTextContent(/No suggestion yet/)
    fireEvent.click(box('sync-interval-row-j3'))
    expect(screen.getByTestId('sync-interval-suggestion')).toHaveTextContent('15 min')
  })

  it('sends the interval for the selected VMs only, by id', async () => {
    const bodies: any[] = []
    batch(bodies, { data: { updated: ['j1', 'j2'], skipped: [] } })
    renderWithProviders(<SyncIntervalDialog open batchId="b1" jobs={jobs} onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.click(box('sync-interval-row-j3'))
    fireEvent.click(screen.getByTestId('sync-interval-use-suggestion'))
    fireEvent.click(screen.getByTestId('sync-interval-confirm'))

    await waitFor(() => expect(bodies).toEqual([{ syncIntervalSec: 900, jobIds: ['j1', 'j2'] }]))
  })

  it('names the VMs the server left alone and stays open', async () => {
    batch([], { data: { updated: ['j1'], skipped: [{ jobId: 'j2', sourceVmName: 'web-2', status: 'cutover' }] } })
    const onClose = vi.fn()
    renderWithProviders(<SyncIntervalDialog open batchId="b1" jobs={jobs} onClose={onClose} onDone={vi.fn()} />)

    fireEvent.click(screen.getByTestId('sync-interval-confirm'))

    expect(await screen.findByTestId('sync-interval-skipped')).toHaveTextContent('web-2')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cannot be confirmed with nothing selected', () => {
    renderWithProviders(<SyncIntervalDialog open batchId="b1" jobs={jobs} onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.click(box('sync-interval-all'))
    expect(screen.getByTestId('sync-interval-confirm')).toBeDisabled()
  })
})

describe('SyncIntervalButton', () => {
  const hold = { id: 'j1', status: 'delta_sync', sourceVmName: 'web-1', config: { cutoverMode: 'manual', migrationType: 'warm' } }

  it('is offered for a manual warm migration that still waits, and for nothing else', () => {
    expect(canChangeSyncInterval(hold)).toBe(true)
    expect(canChangeSyncInterval({ ...hold, status: 'full_copy' })).toBe(true)
    expect(canChangeSyncInterval({ ...hold, config: { cutoverMode: 'auto' } })).toBe(false)
    expect(canChangeSyncInterval({ ...hold, status: 'completed' })).toBe(false)
    expect(canChangeSyncInterval({ ...hold, cutoverRequestedAt: '2026-11-14T07:00:00Z' })).toBe(false)
    expect(canChangeSyncInterval(null)).toBe(false)
  })

  it('reads the interval in force and the suggestion when clicked, then opens the dialog on them', async () => {
    server.use(http.get('*/api/v1/migrations/j1/sync-interval', () => HttpResponse.json({
      data: { syncIntervalSec: 600, overridden: false, defaultSyncIntervalSec: 600, suggestedSyncIntervalSec: 3600, editable: true },
    })))
    renderWithProviders(<SyncIntervalButton job={hold} />)

    fireEvent.click(screen.getByTestId('sync-interval-button'))

    await waitFor(() => expect(value()).toHaveTextContent('10 min'))
    expect(screen.getByTestId('sync-interval-suggestion')).toHaveTextContent('1 h')
    expect(screen.getByTestId('sync-interval-default')).toHaveTextContent('10 min')
  })

  it('renders nothing for a migration with an automatic cutover', () => {
    renderWithProviders(<SyncIntervalButton job={{ ...hold, config: { cutoverMode: 'auto' } }} />)
    expect(screen.queryByTestId('sync-interval-button')).toBeNull()
  })
})
