import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server } from '@/__tests__/setup/msw-server'

import BulkCutoverDialog from './BulkCutoverDialog'

const jobs = [
  { jobId: 'j1', name: 'web-1', projectedDowntimeSec: 95 },
  { jobId: 'j2', name: 'web-2', projectedDowntimeSec: 130 },
  { jobId: 'j3', name: 'db-1', projectedDowntimeSec: 600 },
]
const capture = (bodies: any[], answer: any = { data: { requested: ['j1', 'j2', 'j3'], skipped: [] } }, status = 200) => server.use(
  http.post('*/api/v1/migrations/batches/b1/cutover', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(answer, { status }) }),
)
const box = (testId: string) => screen.getByTestId(testId).querySelector('input[type="checkbox"]') as HTMLInputElement
const confirm = () => screen.getByTestId('bulk-cutover-confirm')

afterEach(() => cleanup())

describe('BulkCutoverDialog', () => {
  it('lists every waiting VM with its projected downtime, all selected', () => {
    renderWithProviders(<BulkCutoverDialog open batchId="b1" jobs={jobs} onClose={vi.fn()} onDone={vi.fn()} />)

    for (const j of jobs) expect(box(`bulk-cutover-row-${j.jobId}`).checked).toBe(true)
    expect(screen.getByTestId('bulk-cutover-row-j1')).toHaveTextContent('web-1')
    expect(screen.getByTestId('bulk-cutover-row-j1')).toHaveTextContent('1 min 35 s')
    expect(box('bulk-cutover-all').checked).toBe(true)
    expect(confirm()).toHaveTextContent('3')
  })

  it('cuts over the selected VMs only, by id', async () => {
    const bodies: any[] = []
    capture(bodies, { data: { requested: ['j1', 'j3'], skipped: [] } })
    const onDone = vi.fn()
    const onClose = vi.fn()
    renderWithProviders(<BulkCutoverDialog open batchId="b1" jobs={jobs} onClose={onClose} onDone={onDone} />)

    fireEvent.click(box('bulk-cutover-row-j2'))
    expect(box('bulk-cutover-all').dataset.indeterminate).toBe('true')
    fireEvent.click(confirm())

    await waitFor(() => expect(bodies).toEqual([{ jobIds: ['j1', 'j3'] }]))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('"All" clears a full selection, selects everything otherwise, and nothing can be sent while empty', () => {
    renderWithProviders(<BulkCutoverDialog open batchId="b1" jobs={jobs} onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.click(box('bulk-cutover-all'))
    for (const j of jobs) expect(box(`bulk-cutover-row-${j.jobId}`).checked).toBe(false)
    expect(confirm()).toBeDisabled()

    fireEvent.click(box('bulk-cutover-row-j3'))
    fireEvent.click(box('bulk-cutover-all'))
    for (const j of jobs) expect(box(`bulk-cutover-row-${j.jobId}`).checked).toBe(true)
  })

  it('stays open and names the VMs the server left alone', async () => {
    capture([], { data: { requested: ['j1'], skipped: [{ jobId: 'j2', sourceVmName: 'web-2', status: 'cutover' }, { jobId: 'j3', sourceVmName: 'db-1', status: 'failed' }] } })
    const onClose = vi.fn()
    renderWithProviders(<BulkCutoverDialog open batchId="b1" jobs={jobs} onClose={onClose} onDone={vi.fn()} />)

    fireEvent.click(confirm())

    const note = await screen.findByTestId('bulk-cutover-skipped')
    expect(note).toHaveTextContent('web-2')
    expect(note).toHaveTextContent('db-1')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the refusal of the server and keeps the selection', async () => {
    capture([], { error: 'Migration batch not found' }, 404)
    renderWithProviders(<BulkCutoverDialog open batchId="b1" jobs={jobs} onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.click(confirm())

    expect(await screen.findByTestId('bulk-cutover-error')).toHaveTextContent('Migration batch not found')
    expect(box('bulk-cutover-row-j1').checked).toBe(true)
  })
})
