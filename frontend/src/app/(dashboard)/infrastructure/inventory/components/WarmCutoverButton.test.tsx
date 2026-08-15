/**
 * Component tests for WarmCutoverButton.
 *
 * This control is the only way an operator ends a manual hold, and it is now
 * rendered from two places (the VM panel and the migrate dialog), so both the
 * decision helpers and the rendered path are asserted here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import WarmCutoverButton, { canRequestCutover, isAwaitingOperator, isWarmHold } from './WarmCutoverButton'

const hold = { id: 'j1', status: 'delta_sync', projectedDowntimeSec: 59, config: { cutoverMode: 'manual' } }
const auto = { id: 'j2', status: 'delta_sync', projectedDowntimeSec: 59, config: { cutoverMode: 'auto' } }
const gate = { id: 'j3', status: 'awaiting_cutover', projectedDowntimeSec: 2505, config: { cutoverMode: 'auto' } }

const CUTOVER_LABEL = 'Cutover now'
const CONFIRM_TITLE = 'Cut over now?'
const NOT_CONVERGING = /will not cut over on its own/i

afterEach(() => {
  cleanup()
})

describe('isWarmHold', () => {
  it('recognises a manual run still replicating', () => {
    expect(isWarmHold(hold)).toBe(true)
  })

  it('is false for an automatic run in the same status', () => {
    // Same status, opposite meaning: this one is converging towards its own
    // cutover, nobody is waiting on a human.
    expect(isWarmHold(auto)).toBe(false)
    expect(isWarmHold({ ...hold, config: null })).toBe(false)
  })

  it('is false once the hold has moved on', () => {
    expect(isWarmHold({ ...hold, status: 'cutover' })).toBe(false)
    expect(isWarmHold(null)).toBe(false)
  })
})

describe('isAwaitingOperator', () => {
  it('covers both ways a migration ends up waiting on a human', () => {
    expect(isAwaitingOperator(hold)).toBe(true)
    expect(isAwaitingOperator(gate)).toBe(true)
  })

  it('leaves a converging run alone', () => {
    expect(isAwaitingOperator(auto)).toBe(false)
    expect(isAwaitingOperator(undefined)).toBe(false)
  })
})

describe('canRequestCutover', () => {
  it('allows the request from delta_sync and from the gate', () => {
    expect(canRequestCutover(auto)).toBe(true)
    expect(canRequestCutover(hold)).toBe(true)
    expect(canRequestCutover(gate)).toBe(true)
  })

  it('refuses before the first estimate exists', () => {
    // projectedDowntimeSec is written after the first delta pass; earlier there
    // is nothing to show and no change id to resume from.
    expect(canRequestCutover({ ...auto, projectedDowntimeSec: null })).toBe(false)
  })

  it('refuses outside the delta phase', () => {
    for (const status of ['planning', 'full_copy', 'cutover', 'verify', 'completed', 'failed']) {
      expect(canRequestCutover({ ...auto, status })).toBe(false)
    }
    expect(canRequestCutover(null)).toBe(false)
  })
})

describe('WarmCutoverButton', () => {
  it('renders nothing when the job cannot be cut over yet', () => {
    renderWithProviders(<WarmCutoverButton job={{ ...auto, projectedDowntimeSec: null }} />)
    expect(screen.queryByRole('button', { name: CUTOVER_LABEL })).not.toBeInTheDocument()
  })

  it('renders nothing without a job at all', () => {
    renderWithProviders(<WarmCutoverButton job={null} />)
    expect(screen.queryByRole('button', { name: CUTOVER_LABEL })).not.toBeInTheDocument()
  })

  it('offers the switchover once an estimate exists', () => {
    renderWithProviders(<WarmCutoverButton job={auto} />)
    expect(screen.getByRole('button', { name: CUTOVER_LABEL })).toBeInTheDocument()
  })

  it('asks for confirmation with the estimated downtime before firing anything', async () => {
    const calls: string[] = []
    server.use(http.post('*/api/v1/migrations/:id/cutover', ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json({ data: {} })
    }))

    renderWithProviders(<WarmCutoverButton job={hold} />)
    fireEvent.click(screen.getByRole('button', { name: CUTOVER_LABEL }))

    expect(await screen.findByText(CONFIRM_TITLE)).toBeInTheDocument()
    expect(screen.getByText(/roughly 1 min of downtime/i)).toBeInTheDocument()
    // opening the confirmation must not have requested anything yet
    expect(calls).toEqual([])
  })

  it('does not tell a manual hold that it fails to converge', () => {
    // The hold is waiting on purpose. The warning belongs to the automatic gate,
    // where the projection really did stay above the budget.
    renderWithProviders(<WarmCutoverButton job={hold} />)
    fireEvent.click(screen.getByRole('button', { name: CUTOVER_LABEL }))
    expect(screen.queryByText(NOT_CONVERGING)).not.toBeInTheDocument()
  })

  it('keeps the warning for a job parked at the automatic gate', async () => {
    renderWithProviders(<WarmCutoverButton job={gate} />)
    fireEvent.click(screen.getByRole('button', { name: CUTOVER_LABEL }))
    expect(await screen.findByText(NOT_CONVERGING)).toBeInTheDocument()
    expect(screen.getByText(/roughly 42 min of downtime/i)).toBeInTheDocument()
  })

  it('requests the cutover for that job, then closes and reports back', async () => {
    const calls: string[] = []
    server.use(http.post('*/api/v1/migrations/:id/cutover', ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json({ data: {} })
    }))
    const onRequested = vi.fn()

    renderWithProviders(<WarmCutoverButton job={hold} onRequested={onRequested} />)
    fireEvent.click(screen.getByRole('button', { name: CUTOVER_LABEL }))

    const dialogButtons = await screen.findAllByRole('button', { name: CUTOVER_LABEL })
    fireEvent.click(dialogButtons[dialogButtons.length - 1])

    await waitFor(() => expect(calls).toEqual(['j1']))
    await waitFor(() => expect(onRequested).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument())
  })

  it('fires nothing when the confirmation is dismissed', async () => {
    const calls: string[] = []
    server.use(http.post('*/api/v1/migrations/:id/cutover', ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json({ data: {} })
    }))

    renderWithProviders(<WarmCutoverButton job={hold} />)
    fireEvent.click(screen.getByRole('button', { name: CUTOVER_LABEL }))
    fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }))

    await waitFor(() => expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument())
    expect(calls).toEqual([])
  })
})
