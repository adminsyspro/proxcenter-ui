/**
 * Component tests for RootChoiceButton.
 *
 * This is the way out of a conversion parked on an ambiguous guest inspection
 * (#738): the pipeline refuses to guess among several bootable systems, so
 * both the state it keys on and the choice it posts are asserted here.
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

import RootChoiceButton, { isAwaitingRootChoice } from './RootChoiceButton'

const candidates = [
  { device: '/dev/sda1', description: 'Debian GNU/Linux 12' },
  { device: '/dev/sdb', description: '13.3' },
]
const waiting = { id: 'j1', status: 'converting_disks', currentStep: 'awaiting_root_choice', config: { v2vRootCandidates: candidates } }
const converting = { id: 'j2', status: 'converting_disks', currentStep: 'converting_disks', config: { v2vRootCandidates: candidates } }
const noCandidates = { id: 'j3', status: 'converting_disks', currentStep: 'awaiting_root_choice', config: {} }

const LABEL = 'Choose system'
const TITLE = 'Choose the system to convert'
const CONFIRM = 'Convert this system'

afterEach(() => {
  cleanup()
})

describe('isAwaitingRootChoice', () => {
  it('is true while the conversion is parked on the choice', () => {
    expect(isAwaitingRootChoice(waiting)).toBe(true)
  })

  it('is false everywhere else', () => {
    expect(isAwaitingRootChoice(converting)).toBe(false)
    expect(isAwaitingRootChoice(null)).toBe(false)
    expect(isAwaitingRootChoice(undefined)).toBe(false)
  })

  it('is false once the job has finished on that step', () => {
    // A failed job keeps its last step; the action would be a dead button.
    for (const status of ['completed', 'failed', 'cancelled']) {
      expect(isAwaitingRootChoice({ ...waiting, status })).toBe(false)
    }
  })
})

describe('RootChoiceButton', () => {
  it('stays out of the way until the conversion is actually waiting', () => {
    renderWithProviders(<RootChoiceButton job={converting} />)
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument()
  })

  it('renders nothing without candidates, even on the waiting step', () => {
    renderWithProviders(<RootChoiceButton job={noCandidates} />)
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument()
  })

  it('lists every candidate with its description and device', async () => {
    renderWithProviders(<RootChoiceButton job={waiting} />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByText('Debian GNU/Linux 12')).toBeInTheDocument()
    expect(screen.getByText('/dev/sda1')).toBeInTheDocument()
    expect(screen.getByText('13.3')).toBeInTheDocument()
    expect(screen.getByText('/dev/sdb')).toBeInTheDocument()
    // The first candidate is preselected, so a straight confirm is valid.
    expect(screen.getAllByRole('radio')[0]).toBeChecked()
  })

  it('posts the selected device for that job, then closes and reports back', async () => {
    const bodies: Array<{ id: string; body: unknown }> = []
    server.use(http.post('*/api/v1/migrations/:id/root-choice', async ({ params, request }) => {
      bodies.push({ id: String(params.id), body: await request.json() })
      return HttpResponse.json({ data: { status: 'root_choice_requested', root: '/dev/sdb' } })
    }))
    const onRequested = vi.fn()

    renderWithProviders(<RootChoiceButton job={waiting} onRequested={onRequested} />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))

    // Pick the second system, not the preselected first one.
    const radios = await screen.findAllByRole('radio')
    fireEvent.click(radios[1])
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(bodies).toEqual([{ id: 'j1', body: { root: '/dev/sdb' } }]))
    await waitFor(() => expect(onRequested).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument())
  })

  it('surfaces the refusal inside the dialog and stays open', async () => {
    server.use(http.post('*/api/v1/migrations/:id/root-choice', () =>
      HttpResponse.json({ error: 'not one of the candidates' }, { status: 400 })
    ))
    const onRequested = vi.fn()

    renderWithProviders(<RootChoiceButton job={waiting} onRequested={onRequested} />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))
    fireEvent.click(await screen.findByRole('button', { name: CONFIRM }))

    expect(await screen.findByText('not one of the candidates')).toBeInTheDocument()
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    expect(onRequested).not.toHaveBeenCalled()
  })
})
