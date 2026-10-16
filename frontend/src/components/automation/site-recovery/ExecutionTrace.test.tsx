/**
 * ExecutionTrace (ui#943): the state of each step of a failover or cutover,
 * from the orchestrator's events, and the log polled while the run lasts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { RecoveryExecutionEvent } from '@/lib/orchestrator/site-recovery.types'

import ExecutionTrace, { CUTOVER_STEPS, FAILOVER_STEPS, stepViews } from './ExecutionTrace'

let nextId = 1

function ev(step: string, level: RecoveryExecutionEvent['level'], at: string, message = `${step} ${level}`): RecoveryExecutionEvent {
  return { id: nextId++, execution_id: 'exec-1', vm_id: 9943, step, level, message, at: `2026-10-16T14:31:${at}Z` }
}

describe('stepViews', () => {
  beforeEach(() => { nextId = 1 })

  it('marks the current step active, the ones behind done, the ones ahead pending', () => {
    const events = [ev('fencing', 'info', '00'), ev('fencing', 'check', '04'), ev('starting', 'info', '05')]

    expect(stepViews(FAILOVER_STEPS, events, 'starting', 'running')).toEqual([
      { step: 'fencing', state: 'done', seconds: 4 },
      { step: 'starting', state: 'active', seconds: null },
    ])
  })

  it('lists the rollback only when a restore point was used', () => {
    const events = [ev('fencing', 'check', '00'), ev('restoring', 'info', '01')]

    expect(stepViews(FAILOVER_STEPS, events, 'restoring', 'running').map(v => [v.step, v.state])).toEqual([
      ['fencing', 'done'], ['restoring', 'active'], ['starting', 'pending'],
    ])
  })

  it('fails the step that logged an error, and completes every step of a finished run', () => {
    const failed = [ev('fencing_dr', 'check', '00'), ev('final_sync', 'info', '01'), ev('final_sync', 'error', '09')]

    expect(stepViews(CUTOVER_STEPS, failed, 'final_sync', 'failed').map(v => v.state)).toEqual(['done', 'failed', 'pending', 'pending'])
    expect(stepViews(CUTOVER_STEPS, [], '', 'completed').map(v => v.state)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('keeps every step pending before the first event', () => {
    expect(stepViews(CUTOVER_STEPS, [], undefined, 'running').every(v => v.state === 'pending')).toBe(true)
  })
})

describe('ExecutionTrace', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    nextId = 1
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the checks and the log lines, each with its level', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [ev('fencing', 'info', '00', 'Stopping the source VM 9943 on node pve1'), ev('fencing', 'check', '03', 'Source VM 9943 stopped on node pve1')],
    })

    renderWithProviders(<ExecutionTrace executionId='exec-1' steps={FAILOVER_STEPS} currentStep='starting' status='running' />)

    const log = screen.getByTestId('trace-log')
    await within(log).findByText('Source VM 9943 stopped on node pve1')
    expect(log.querySelector('[data-level="check"]')).not.toBeNull()
    expect(screen.getByTestId('trace-step-fencing').getAttribute('data-state')).toBe('done')
    expect(screen.getByTestId('trace-step-starting').getAttribute('data-state')).toBe('active')
    expect(within(screen.getByTestId('trace-step-fencing')).getByText('3 s')).toBeTruthy()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/replication/executions/exec-1/events?after=0')
  })

  it('polls only the new lines while the run lasts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [ev('', 'info', '00', 'Cutover requested')] })
      .mockResolvedValue({ ok: true, json: async () => [] })

    renderWithProviders(<ExecutionTrace executionId='exec-1' steps={CUTOVER_STEPS} status='running' />)
    await screen.findByText('Cutover requested')
    await vi.advanceTimersByTimeAsync(2100)

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1))
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('after=1')
  })

  it('says it waits for the first event, and lists no checks for the reverse sync', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })

    renderWithProviders(<ExecutionTrace executionId='exec-1' steps={[]} status='completed' />)

    expect(await screen.findByText('Waiting for the first event…')).toBeTruthy()
    expect(screen.queryByText('Checks')).toBeNull()
  })
})
