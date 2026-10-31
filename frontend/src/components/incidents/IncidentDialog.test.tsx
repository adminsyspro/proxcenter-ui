import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import IncidentDialog from './IncidentDialog'
import { makeIncident } from './fixtures'

const { incidentMock, candidatesMock, coverageMock, rbacMock } = vi.hoisted(() => ({ incidentMock: vi.fn(), candidatesMock: vi.fn(), coverageMock: vi.fn(), rbacMock: vi.fn() }))

vi.mock('./useIncident', async importOriginal => ({
  ...(await importOriginal<typeof import('./useIncident')>()),
  useIncident: (id: string | null) => incidentMock(id),
  useCandidates: (id: string | null, enabled: boolean) => candidatesMock(id, enabled),
  useIncidentCoverage: () => coverageMock(),
}))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: (p: string) => rbacMock(p) }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1', name: 'Alice' } }, status: 'authenticated' }) }))

const fetchMock = vi.fn()
const mutate = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  mutate.mockReset().mockResolvedValue(undefined)
  rbacMock.mockReset().mockReturnValue(true)
  incidentMock.mockReset().mockImplementation((id: string | null) => ({ data: id ? makeIncident({ id }) : undefined, error: undefined, isLoading: false, mutate }))
  candidatesMock.mockReset().mockReturnValue({ data: { alerts: [] }, mutate })
  coverageMock.mockReset().mockReturnValue({ data: undefined })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('IncidentDialog', () => {
  it('offers to open an incident for a seed alert, then shows the one created', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'i9' }) })
    renderWithProviders(<IncidentDialog open incidentId={null} seedAlertId='a1' onClose={() => {}} />)

    expect(screen.getByText('No incident has been opened for this alert yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open an incident' }))

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/incidents')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ alert_id: 'a1' })
    expect(await screen.findByText('Node pve1 down')).toBeInTheDocument()
    expect(incidentMock).toHaveBeenLastCalledWith('i9')
  })

  it('shows the alerts, the status and the severity of an incident', () => {
    renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)

    expect(screen.getByText('Node pve1 down')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByText('Node pve1 is down')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Detach' })).toHaveLength(2)
  })

  it('marks a guest alert out of every SLA policy and says the incident stays out of the report', () => {
    coverageMock.mockReturnValue({ data: { uncovered: ['a2'], report: false } })
    renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)

    expect(screen.getAllByText('Out of SLA policy')).toHaveLength(1)
    expect(screen.getByText('Not included')).toBeInTheDocument()
    expect(screen.queryByText('Included in the SLA report; internal notes never appear in it.')).not.toBeInTheDocument()
  })

  it('says the incident enters the SLA report when a covered guest is in it, and words an alert still running', () => {
    coverageMock.mockReturnValue({ data: { uncovered: [], report: true } })
    renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)

    expect(screen.getByText('Included in the SLA report; internal notes never appear in it.')).toBeInTheDocument()
    expect(screen.queryByText(/Out of SLA policy/)).not.toBeInTheDocument()
    expect(screen.getByText('Included')).toBeInTheDocument()
    expect(screen.getAllByText(/^Active for /)).toHaveLength(2)
    expect(screen.queryByText(/^Resolved at /)).not.toBeInTheDocument()
    expect(screen.getByText('2 alerts, 2 active')).toBeInTheDocument()
  })

  it('lays the alerts out by start time, words a resolved one and folds past six', async () => {
    const user = userEvent.setup()
    const alerts = Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`,
      type: 'vm_down',
      resource: `vm-${i}`,
      message: `VM ${i} is down`,
      first_seen_at: `2026-10-27T10:0${7 - i}:00.000Z`,
      resolved_at: '2026-10-27T10:30:00.000Z',
    }))
    incidentMock.mockReturnValue({ data: makeIncident({ status: 'resolved', ended_at: '2026-10-27T10:30:00.000Z', alerts }), error: undefined, isLoading: false, mutate })
    renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)

    const names = () => screen.getAllByText(/^vm-\d$/).map(n => n.textContent)
    expect(names()).toEqual(['vm-7', 'vm-6', 'vm-5', 'vm-4', 'vm-3', 'vm-2'])
    expect(screen.getAllByText(/^Resolved at .+ after /)).toHaveLength(6)
    expect(screen.getByText('8 alerts, all resolved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show 2 more alerts' }))
    expect(names()).toHaveLength(8)
    await user.click(screen.getByRole('button', { name: 'Show less' }))
    expect(names()).toHaveLength(6)
  })

  it('attaches every ticked candidate with one POST each', async () => {
    const user = userEvent.setup()

    candidatesMock.mockReturnValue({
      data: { alerts: [
        { id: 'c1', type: 'vm_down', resource: 'vm-1', message: 'VM 1 is down' },
        { id: 'c2', type: 'vm_down', resource: 'vm-2', message: 'VM 2 is down' },
      ] },
      mutate,
    })
    renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)

    await user.click(screen.getByLabelText('All'))
    await user.click(screen.getByRole('button', { name: 'Attach (2)' }))

    const posts = fetchMock.mock.calls.filter(([url]) => url === '/api/v1/incidents/i1/alerts')

    expect(posts).toHaveLength(2)
    expect(posts.map(([, init]) => JSON.parse(init.body).alert_id).sort()).toEqual(['c1', 'c2'])
  })

  it('hides the writing controls without alerts.manage', () => {
    rbacMock.mockReturnValue(false)
    renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Detach' })).toBeNull()
    expect(screen.queryByLabelText('Add a comment')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit the title' })).toBeNull()
  })

  it('shows a readable message when the register refuses', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'incident_closed', code: 'INCIDENT_CLOSED' }) })
    renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)
    await user.click(screen.getAllByRole('button', { name: 'Detach' })[0])

    expect(await screen.findByText('The incident is closed. Reopen it to change it.')).toBeInTheDocument()
  })

  describe('deleting the incident', () => {
    it('sends the DELETE after the confirmation, then closes and refreshes', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onChanged = vi.fn()

      renderWithProviders(<IncidentDialog open incidentId='i1' onClose={onClose} onChanged={onChanged} />)
      await user.click(screen.getByRole('button', { name: 'Delete the incident' }))
      expect(fetchMock).not.toHaveBeenCalled()
      await user.click(await screen.findByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/incidents/i1')
      expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
      expect(onChanged).toHaveBeenCalled()
    })

    it('shows the refusal in the dialog and keeps the incident open', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'incident_closed', code: 'INCIDENT_CLOSED' }) })
      renderWithProviders(<IncidentDialog open incidentId='i1' onClose={onClose} />)
      await user.click(screen.getByRole('button', { name: 'Delete the incident' }))
      await user.click(await screen.findByRole('button', { name: 'Delete' }))

      expect(await screen.findByText('The incident is closed. Reopen it to change it.')).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('is absent without admin.settings', () => {
      rbacMock.mockImplementation((p: string) => p !== 'admin.settings')
      renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)

      expect(screen.queryByRole('button', { name: 'Delete the incident' })).toBeNull()
    })

    it('is absent on a closed incident', () => {
      incidentMock.mockImplementation((id: string | null) => ({ data: id ? makeIncident({ id, status: 'closed' }) : undefined, error: undefined, isLoading: false, mutate }))
      renderWithProviders(<IncidentDialog open incidentId='i1' onClose={() => {}} />)

      expect(screen.queryByRole('button', { name: 'Delete the incident' })).toBeNull()
    })
  })
})
