import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import { makeIncident } from './fixtures'
import IncidentPostmortem from './IncidentPostmortem'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const run = async (fn: () => Promise<unknown>) => { await fn(); return null }

const renderPostmortem = (over = {}, canManage = true, coverage: { inReport?: boolean } = { inReport: true }) =>
  renderWithProviders(<IncidentPostmortem view={makeIncident(over)} canManage={canManage} run={run} inReport={coverage.inReport} />)

describe('IncidentPostmortem', () => {
  it('disables the validation while the incident is open, and says why', () => {
    renderPostmortem({ status: 'open', root_cause: 'disk', impact: 'none' })

    expect(screen.getByRole('button', { name: 'Validate the post-mortem' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Validate the post-mortem' })).toHaveAccessibleDescription('The post-mortem can be validated once every alert of the incident is resolved.')
  })

  it('disables the validation while a field is empty', () => {
    renderPostmortem({ status: 'resolved', root_cause: 'disk', impact: '' })

    expect(screen.getByRole('button', { name: 'Validate the post-mortem' })).toBeDisabled()
  })

  it('enables the validation for a resolved incident with both fields', async () => {
    const user = userEvent.setup()

    renderPostmortem({ status: 'resolved', root_cause: 'disk', impact: 'none' })
    const button = screen.getByRole('button', { name: 'Validate the post-mortem' })

    expect(button).toBeEnabled()
    await user.click(button)
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/v1/incidents/i1/close')
  })

  it('offers to reopen a closed incident and locks the fields', async () => {
    const user = userEvent.setup()

    renderPostmortem({ status: 'closed', root_cause: 'disk', impact: 'none', postmortem_by: 'alice' })

    expect(screen.queryByRole('button', { name: 'Validate the post-mortem' })).toBeNull()
    expect(screen.getByLabelText('Root cause')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/incidents/i1/reopen')
  })

  it('states that internal notes never reach the SLA report', () => {
    renderPostmortem()

    expect(screen.getByText('Included in the SLA report; internal notes never appear in it.')).toBeInTheDocument()
  })

  it('says nothing of the report while the coverage is read', () => {
    renderPostmortem({}, true, {})

    expect(screen.queryByText(/SLA report/)).not.toBeInTheDocument()
  })

  it('adds and ticks a corrective action', async () => {
    const user = userEvent.setup()

    renderPostmortem({ actions: [{ id: 'x1', incident_id: 'i1', text: 'Replace the disk', done: false, position: 0 }] })
    await user.type(screen.getByLabelText('Corrective action'), 'Add monitoring')
    await user.click(screen.getByRole('button', { name: 'Add an action' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: 'Add monitoring' })

    await user.click(screen.getByRole('checkbox', { name: 'Replace the disk' }))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/incidents/i1/actions/x1')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ done: true })
  })

  it('hides every writing control without alerts.manage', () => {
    renderPostmortem({ status: 'resolved', root_cause: 'a', impact: 'b' }, false)

    expect(screen.queryByRole('button', { name: 'Validate the post-mortem' })).toBeNull()
    expect(screen.queryByLabelText('Corrective action')).toBeNull()
  })
})
