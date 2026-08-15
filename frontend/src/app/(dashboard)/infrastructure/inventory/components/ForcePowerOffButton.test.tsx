/**
 * Component tests for ForcePowerOffButton.
 *
 * This is the way out of the wait that lost a customer six and a half hours of
 * transfer (#587, #614), so both the state it keys on and the request it fires
 * are asserted here.
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

import ForcePowerOffButton, { isAwaitingPowerOff } from './ForcePowerOffButton'

const waiting = { id: 'j1', status: 'cutover', currentStep: 'awaiting_power_off' }
const fallbackWaiting = { id: 'j2', status: 'full_copy', currentStep: 'awaiting_power_off' }
const copying = { id: 'j3', status: 'full_copy', currentStep: 'full_copy' }

const LABEL = 'Force power off'
const CONFIRM_TITLE = 'Power off the source now?'

afterEach(() => {
  cleanup()
})

describe('isAwaitingPowerOff', () => {
  it('is true while either shutdown wait is running', () => {
    expect(isAwaitingPowerOff(waiting)).toBe(true)
    expect(isAwaitingPowerOff(fallbackWaiting)).toBe(true)
  })

  it('is false everywhere else', () => {
    expect(isAwaitingPowerOff(copying)).toBe(false)
    expect(isAwaitingPowerOff(null)).toBe(false)
    expect(isAwaitingPowerOff(undefined)).toBe(false)
  })

  it('is false once the job has finished on that step', () => {
    // A failed job keeps its last step; the action would be a dead button.
    for (const status of ['completed', 'failed', 'cancelled']) {
      expect(isAwaitingPowerOff({ ...waiting, status })).toBe(false)
    }
  })
})

describe('ForcePowerOffButton', () => {
  it('stays out of the way until the migration is actually waiting', () => {
    renderWithProviders(<ForcePowerOffButton job={copying} />)
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument()
  })

  it('offers the hard power off during the wait', () => {
    renderWithProviders(<ForcePowerOffButton job={waiting} />)
    expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument()
  })

  it('warns that the copy becomes crash consistent before firing anything', async () => {
    const calls: string[] = []
    server.use(http.post('*/api/v1/migrations/:id/force-poweroff', ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json({ data: {} })
    }))

    renderWithProviders(<ForcePowerOffButton job={waiting} />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))

    expect(await screen.findByText(CONFIRM_TITLE)).toBeInTheDocument()
    expect(screen.getByText(/crash consistent/i)).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('requests the power off for that job, then closes and reports back', async () => {
    const calls: string[] = []
    server.use(http.post('*/api/v1/migrations/:id/force-poweroff', ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json({ data: {} })
    }))
    const onRequested = vi.fn()

    renderWithProviders(<ForcePowerOffButton job={waiting} onRequested={onRequested} />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))

    const buttons = await screen.findAllByRole('button', { name: LABEL })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(calls).toEqual(['j1']))
    await waitFor(() => expect(onRequested).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument())
  })

  it('fires nothing when the confirmation is dismissed', async () => {
    const calls: string[] = []
    server.use(http.post('*/api/v1/migrations/:id/force-poweroff', ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json({ data: {} })
    }))

    renderWithProviders(<ForcePowerOffButton job={waiting} />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))
    fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }))

    await waitFor(() => expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument())
    expect(calls).toEqual([])
  })
})
