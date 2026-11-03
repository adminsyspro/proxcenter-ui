/**
 * The Emergency stop turns the Proxmox cluster firewall off: what the stop dialog says, what the resume dialog says
 * and does when the management rules are missing, and how the banner shows the state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import type { MicrosegRun } from '@/lib/microseg/types'

import ApplyResult from './ApplyResult'
import PlanNotices from './PlanNotices'
import PreflightPanel from './PreflightPanel'
import { calls, mock, policy, renderTab, reply, resetMocks, status, zone } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'

// A portal, like the real MUI dialog.
vi.mock('../DeploymentWizard', async () => {
  const { createPortal } = await import('react-dom')
  return {
    default: (props: { open: boolean }) => props.open
      ? createPortal(<div role='dialog' aria-label='Deployment wizard' />, document.body)
      : null,
  }
})

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const FIREWALL = { clusterOptions: null, clusterRules: [], nodesList: ['pve1'], firewallMode: 'cluster' as const, onComplete: vi.fn() }
const engine = (clusterFirewall?: 'enabled' | 'disabled' | 'unknown') => ({
  paused_until: null, held: false, last_runs: {}, last_log: null, ...(clusterFirewall ? { cluster_firewall: clusterFirewall } : {}),
})
const renderConfigured = () => renderTab(<MicrosegTab connectionId='c1' connectionName='prod' firewall={FIREWALL} />)

describe('the stop dialog', () => {
  it('says on one line each that it disables the cluster firewall, what stops being evaluated, what stays and when to use it', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    const dialog = await screen.findByRole('dialog')

    for (const text of [
      'Disables the Proxmox cluster firewall with a single request: immediate on every node',
      'Every firewall rule stops being evaluated, including the ones ProxCenter does not manage (management rules, host and guest rules)',
      'The micro-segmentation objects stay in place; Resume re-enables the cluster firewall and re-applies the policy',
      'Use it when the segmentation blocks something it should not',
    ]) {
      const line = within(dialog).getByText(text)
      expect(line.className).toContain('MuiTypography-noWrap')
      expect(line.previousElementSibling?.tagName).toBe('I')
    }
    expect(calls('POST /emergency-stop')).toHaveLength(0)
  })

  it('still asks the same confirmation: nothing is sent before the button', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: true })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
  })
})

describe('the resume dialog', () => {
  beforeEach(() => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine('disabled') }))
  })

  it('says it re-enables the cluster firewall then re-applies the last revision, and when it is refused', async () => {
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Re-enables the cluster firewall, then re-applies the last revision')).toBeTruthy()
    expect(within(dialog).getByText('Refused if the management rules (SSH 22, web 8006) are missing: fix them in the Dashboard deployment wizard first')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
  })

  it('keeps the dialog open on a SOCLE_MISSING refusal, with the message, the server wording and a way to the wizard', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'SOCLE_MISSING', error: 'cluster firewall not re-enabled: rule SSH 22 missing' })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))

    expect(await within(dialog).findByText(/The management rules \(SSH 22, web 8006\) are missing, so the cluster firewall was not re-enabled/)).toBeTruthy()
    expect(within(dialog).getByText('cluster firewall not re-enabled: rule SSH 22 missing')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(JSON.parse(calls('POST /emergency-stop')[0][1]!.body as string)).toEqual({ on: false })
    // The dialog keeps the refusal: the banner shows no second error.
    expect(document.querySelectorAll('.MuiAlert-standardError')).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('opens the deployment wizard from the refusal and closes the dialog', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'SOCLE_MISSING', error: 'x' })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resume' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open the deployment wizard' }))

    expect(await screen.findByRole('dialog', { name: 'Deployment wizard' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Resume micro-segmentation?' })).toBeNull())
  })

  it('offers no wizard button when the page gives no wizard, but still explains the refusal', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'SOCLE_MISSING', error: 'x' })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))

    expect(await within(dialog).findByText(/so the cluster firewall was not re-enabled/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
  })

  it('clears the refusal when the dialog is asked again', async () => {
    let refuse = true
    mock.routes['POST /emergency-stop'] = () => (refuse ? reply(409, { code: 'SOCLE_MISSING', error: 'x' }) : reply(200, { accepted: true, applied_by: 'self', on: false }))
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))
    await within(dialog).findByText(/so the cluster firewall was not re-enabled/)

    refuse = false
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    const again = await screen.findByRole('dialog')
    expect(within(again).queryByText(/so the cluster firewall was not re-enabled/)).toBeNull()
    fireEvent.click(within(again).getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(2))
  })

  it('sends other refusals to the banner and closes the dialog, as before', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(403, { code: 'FORBIDDEN', error: 'no' })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resume' }))

    expect(await screen.findByText('You do not have permission to do this.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('the banner', () => {
  it.each([
    ['disabled', true],
    ['enabled', false],
    ['unknown', false],
    [undefined, false],
  ] as const)('with the stop on and the cluster firewall %s, the "Cluster firewall disabled" mark is %s', async (state, shown) => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine(state) }))
    renderTab()
    const alert = (await screen.findByText('Emergency stop active: every zone is in observation')).closest('[role="alert"]') as HTMLElement
    expect(within(alert).queryByText('Cluster firewall disabled') !== null).toBe(shown)
  })

  it('shows no mark while the stop is off, whatever the cluster firewall', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: false, engine: engine('disabled') }))
    renderTab()
    await screen.findByRole('button', { name: 'Emergency stop' })
    await waitFor(() => expect(calls('GET /status').length).toBeGreaterThan(0))
    expect(screen.queryByText('Cluster firewall disabled')).toBeNull()
  })
})

describe('the stop button', () => {
  it('waits for a first revision, with the reason in a tooltip', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: null }))
    renderTab()
    const button = await screen.findByRole('button', { name: 'Emergency stop' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.mouseOver(button.parentElement as HTMLElement)
    expect(await screen.findByText('Nothing deployed')).toBeTruthy()
  })

  it('is available once something is deployed', async () => {
    renderTab()
    const button = await screen.findByRole('button', { name: 'Emergency stop' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('says it with its own message when the server answers 409 NOT_DEPLOYED', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'NOT_DEPLOYED', error: 'x' })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Emergency stop' }))
    expect(await screen.findByText('Nothing is deployed yet: apply a plan first, the emergency stop acts on a deployed policy.')).toBeTruthy()
  })
})

describe('the banner, when the engine cannot read the cluster firewall', () => {
  const withFlag = (flag: boolean | undefined) => () => reply(200, {
    ...policy({ zones: [zone('a')] }),
    policy: { ...policy().policy, emergency_stop: true, stop_cluster_disabled: flag },
    last_revision: { id: 'r1', version: 2, author: 'me', created_at: '2026-11-02T09:00:00Z' },
  })

  it.each(['unknown', undefined] as const)('shows the mark from the policy flag when the state is %s', async state => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine(state) }))
    mock.routes['GET /policy'] = withFlag(true)
    renderTab()
    expect(await screen.findByText('Cluster firewall disabled')).toBeTruthy()
  })

  it('does not contradict an engine that reads the firewall as enabled', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine('enabled') }))
    mock.routes['GET /policy'] = withFlag(true)
    renderTab()
    await screen.findByText('Emergency stop active: every zone is in observation')
    expect(screen.queryByText('Cluster firewall disabled')).toBeNull()
  })

  it('shows no mark without the flag', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine('unknown') }))
    mock.routes['GET /policy'] = withFlag(undefined)
    renderTab()
    await screen.findByText('Emergency stop active: every zone is in observation')
    expect(screen.queryByText('Cluster firewall disabled')).toBeNull()
  })
})

describe('the pre-flight panel during a stop', () => {
  const held = { id: 'cluster_firewall', status: 'warn', fix: 'enable_cluster_firewall', detail: { reason: 'emergency_stop', held_by_stop: true } }
  const checks = (check: object) => () => reply(200, { checks: [check, { id: 'socle_rules', status: 'pass' }] })

  it('says the stop holds the firewall off and offers Resume instead of the wizard', async () => {
    mock.routes['GET /preflight'] = checks(held)
    const onResume = vi.fn()
    const onOpenWizard = vi.fn()
    renderTab(<PreflightPanel open connectionId='c1' onClose={vi.fn()} onOpenWizard={onOpenWizard} onResume={onResume} />)

    expect(await screen.findByText('Cluster firewall held off by the emergency stop: lift the stop to re-enable it')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onOpenWizard).not.toHaveBeenCalled()
  })

  it('keeps the wizard fix for a firewall that is plainly off, with no Resume', async () => {
    mock.routes['GET /preflight'] = checks({ id: 'cluster_firewall', status: 'fail', fix: 'enable_cluster_firewall' })
    renderTab(<PreflightPanel open connectionId='c1' onClose={vi.fn()} onOpenWizard={vi.fn()} onResume={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Open the deployment wizard' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })

  it('opens the resume dialog of the tab from the Resume button', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine('disabled') }))
    mock.routes['GET /preflight'] = checks(held)
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [], last_revision: null }))
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Run the checks' }))
    const panel = await screen.findByRole('dialog', { name: 'Pre-flight checks' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'Resume' }))

    expect(await screen.findByRole('dialog', { name: 'Resume micro-segmentation?' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pre-flight checks' })).toBeNull())
  })
})

describe('a plan or an apply written during a stop', () => {
  const LINE = 'Written while the emergency stop holds the cluster firewall off; takes effect when the stop is lifted'
  const run = (result: object): MicrosegRun => ({
    id: 'run1', policy_id: 'p1', kind: 'apply', status: 'done', started_at: '2026-11-03T10:00:00Z', duration_ms: 10, api_calls: 1, writes: 1, error: '',
    result: { guests: 1, members: 1, steps: 1, drifts: 0, ...result } as never,
  })

  it('warns in the plan notices', () => {
    renderTab(<PlanNotices result={run({ stop_active: true }).result!} guests={[]} />)
    expect(screen.getByText(LINE)).toBeTruthy()
  })

  it('draws no plan notice without the mark', () => {
    const { container } = renderTab(<PlanNotices result={run({}).result!} guests={[]} />)
    expect(container.textContent).not.toContain('Written while the emergency stop')
  })

  it('warns in the apply result, next to the counts', () => {
    renderTab(<ApplyResult run={run({ stop_active: true, done: [] })} guests={[]} />)
    expect(screen.getByText(LINE)).toBeTruthy()
    expect(screen.getByText('0 done, 0 failed, 0 not run')).toBeTruthy()
  })

  it('shows the warning once when the orchestrator also notes it, and keeps its other notes', () => {
    const note = 'written while the emergency stop holds the cluster firewall off; takes effect when the stop is lifted'
    renderTab(<ApplyResult run={run({ stop_active: true, done: [], notes: [note, 'one guest was skipped'] })} guests={[]} />)
    expect(screen.getAllByText(new RegExp(note.slice(8), 'i'))).toHaveLength(1)
    expect(screen.getByText(LINE)).toBeTruthy()
    expect(screen.getByText('Notes: one guest was skipped')).toBeTruthy()
  })

  it('keeps the orchestrator note when the mark is absent', () => {
    renderTab(<ApplyResult run={run({ done: [], notes: ['held by the emergency stop'] })} guests={[]} />)
    expect(screen.getByText(/held by the emergency stop/)).toBeTruthy()
  })

  it('draws no warning in the apply result without the mark', () => {
    renderTab(<ApplyResult run={run({ done: [] })} guests={[]} />)
    expect(screen.queryByText(LINE)).toBeNull()
  })
})
