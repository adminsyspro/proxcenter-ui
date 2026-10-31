/**
 * Alerts page mutations: a refused write shows the server's reason and never
 * a success toast; a batch says how many of its calls were refused. The data
 * hooks and the grid are stubbed, every write goes through a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

import { renderWithProviders, screen, userEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

const state = vi.hoisted(() => ({
  showToast: vi.fn(),
  mutate: vi.fn(),
  alerts: [] as Array<Record<string, unknown>>,
  rules: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: vi.fn() }) }))
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ currentTenant: { id: 'default' } }) }))
vi.mock('@/components/guards/EnterpriseGuard', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/contexts/LicenseContext', () => ({ Features: { ALERTS: 'alerts' }, useLicense: () => ({ isEnterprise: true }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: state.showToast }) }))
vi.mock('@/hooks/useConnections', () => ({ useConnections: () => ({ data: { data: [] } }) }))
vi.mock('@/hooks/useAlerts', () => ({
  useOrchestratorAlerts: () => ({ data: { data: state.alerts }, error: undefined, isLoading: false, mutate: state.mutate }),
  useAlertsSummary: () => ({ data: undefined, mutate: state.mutate }),
  useAlertRules: () => ({ data: state.rules, mutate: state.mutate }),
}))

// A plain table: every cell through its renderCell, and a button standing for
// the header checkbox.
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: ({ rows, columns, onRowSelectionModelChange }: any) => (
    <div>
      {onRowSelectionModelChange && (
        <button onClick={() => onRowSelectionModelChange({ type: 'include', ids: new Set(rows.map((r: any) => r.id)) })}>Select every row</button>
      )}
      {rows.map((row: any) => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          {columns.map((c: any) => (
            <span key={c.field}>{c.renderCell ? c.renderCell({ row, value: row[c.field], id: row.id }) : String(row[c.field] ?? '')}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}))

import AlertsPage from './page'

const alert = (id: string, status = 'active') => ({
  id, connection_id: 'c1', type: 'memory', severity: 'warning', status, resource: 'pve2', resource_type: 'node',
  message: `Alert ${id}`, current_value: 81, threshold: 80, unit: '%', occurrences: 1,
  first_seen_at: '2026-10-31T08:00:00Z', last_seen_at: '2026-10-31T08:05:00Z', _fingerprint: `fp-${id}`,
})
const RULE = { id: 'rule-1', name: 'Backups failing', description: '', enabled: true, category: 'all', level: 'error', task_types: '', pattern: '', exclude_pattern: '', connection_id: '', node_pattern: '', severity: 'warning', notify_email: false }

type Answer = { status: number; body: unknown }
let answer: (method: string, url: string) => Answer
let fetchMock: ReturnType<typeof vi.fn>

const refused = (error: string): Answer => ({ status: 500, body: { error } })
const accepted: Answer = { status: 200, body: { status: 'ok' } }

beforeEach(() => {
  vi.clearAllMocks()
  state.alerts = [alert('a1'), alert('a2')]
  state.rules = [RULE]
  answer = () => accepted
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const a = answer(init?.method || 'GET', url)

    return new Response(JSON.stringify(a.body), { status: a.status })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const row = (id: string) => within(screen.getByTestId(`row-${id}`))
const toasts = () => state.showToast.mock.calls
const lastToast = () => toasts().at(-1)

async function openRulesTab() {
  await userEvent.click(screen.getByRole('tab', { name: /Event rules/ }))
}

describe('single alert actions', () => {
  it('acknowledges and says so when the orchestrator accepts', async () => {
    renderWithProviders(<AlertsPage />)
    await userEvent.click(row('a1').getByRole('button', { name: 'Acknowledge' }))

    await waitFor(() => expect(lastToast()).toEqual(['Success', 'success']))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/orchestrator/alerts/a1/acknowledge', expect.objectContaining({ method: 'POST', body: '{"acknowledged_by":"test"}' }))
    expect(state.mutate).toHaveBeenCalled()
  })

  it('shows the refusal of an acknowledge, not a success', async () => {
    answer = () => refused('ack refused')
    renderWithProviders(<AlertsPage />)
    await userEvent.click(row('a1').getByRole('button', { name: 'Acknowledge' }))

    await waitFor(() => expect(lastToast()).toEqual(['Error: ack refused', 'error']))
    expect(toasts().some(([, s]) => s === 'success')).toBe(false)
  })

  it('shows the refusal of a mute', async () => {
    answer = (method, url) => (url === '/api/v1/alerts/silence' ? refused('silence refused') : accepted)
    renderWithProviders(<AlertsPage />)
    await userEvent.click(row('a1').getByRole('button', { name: 'Mute this alert' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '1 hour' }))

    await waitFor(() => expect(lastToast()).toEqual(['Error: silence refused', 'error']))
  })

  it('shows the refusal of an unmute', async () => {
    state.alerts = [alert('a3', 'silenced')]
    answer = () => refused('unmute refused')
    renderWithProviders(<AlertsPage />)
    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByRole('option', { name: 'Muted' }))
    await userEvent.click(row('a3').getByRole('button', { name: 'Unmute this alert' }))

    await waitFor(() => expect(lastToast()).toEqual(['Error: unmute refused', 'error']))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/alerts/silence?fingerprint=fp-a3', { method: 'DELETE' })
  })

  it('reports a refused single delete instead of saying nothing', async () => {
    answer = () => refused('delete refused')
    renderWithProviders(<AlertsPage />)
    await userEvent.click(row('a1').getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(lastToast()).toEqual(['1 of 1 actions failed: delete refused', 'error']))
  })

  it('deletes a single alert silently when accepted', async () => {
    renderWithProviders(<AlertsPage />)
    await userEvent.click(row('a1').getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(state.mutate).toHaveBeenCalled())
    expect(toasts()).toEqual([])
  })
})

describe('batch actions', () => {
  it('counts the refused acknowledgements of a selection', async () => {
    answer = (method, url) => (url.includes('/a2/') ? refused('a2 locked') : accepted)
    renderWithProviders(<AlertsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Select every row' }))
    await userEvent.click(screen.getByRole('button', { name: /Acknowledge selected/ }))

    await waitFor(() => expect(lastToast()).toEqual(['1 of 2 actions failed: a2 locked', 'error']))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says success when every acknowledgement went through', async () => {
    renderWithProviders(<AlertsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Select every row' }))
    await userEvent.click(screen.getByRole('button', { name: /Acknowledge selected/ }))

    await waitFor(() => expect(lastToast()).toEqual(['Success', 'success']))
  })
})

describe('event rules', () => {
  it('reports a refused toggle', async () => {
    answer = () => refused('toggle refused')
    renderWithProviders(<AlertsPage />)
    await openRulesTab()
    await userEvent.click(row('rule-1').getByRole('switch'))

    await waitFor(() => expect(lastToast()).toEqual(['Error: toggle refused', 'error']))
  })

  it('keeps the rule dialog open when the save is refused', async () => {
    answer = () => refused('rule save refused')
    renderWithProviders(<AlertsPage />)
    await openRulesTab()
    await userEvent.click(row('rule-1').getByRole('button', { name: 'Edit' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(lastToast()).toEqual(['Error: rule save refused', 'error']))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/orchestrator/alerts/rules/rule-1', expect.objectContaining({ method: 'PUT' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes the rule dialog once the save is accepted', async () => {
    renderWithProviders(<AlertsPage />)
    await openRulesTab()
    await userEvent.click(row('rule-1').getByRole('button', { name: 'Edit' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(lastToast()).toEqual(['Success', 'success']))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reports a refused rule delete', async () => {
    answer = () => refused('rule delete refused')
    renderWithProviders(<AlertsPage />)
    await openRulesTab()
    await userEvent.click(row('rule-1').getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(lastToast()).toEqual(['Error: rule delete refused', 'error']))
  })
})
