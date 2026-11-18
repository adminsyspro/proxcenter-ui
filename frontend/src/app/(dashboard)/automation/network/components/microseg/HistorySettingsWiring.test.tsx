/**
 * How the History, Settings and Preflight pieces hang off the tab: the buttons
 * that open them, the wizard behind a failed preflight check, and the runs they
 * start (restore, removal) in the strip under the banner.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, policy, renderTab, reply, resetMocks, zone, REVISION_HEAD } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { run } from './policyTestKit'
import type { MicrosegRun } from '@/lib/microseg/types'

// A portal, like the real MUI dialog: inside the tab it would be hidden from the accessibility tree by the open pre-flight dialog.
vi.mock('../DeploymentWizard', async () => {
  const { createPortal } = await import('react-dom')
  return {
    default: (props: { open: boolean; selectedConnection: string; onComplete: () => void }) => props.open
      ? createPortal(
        <div role='dialog' aria-label='Deployment wizard' data-conn={props.selectedConnection}><button onClick={props.onComplete}>Wizard done</button></div>,
        document.body,
      )
      : null,
  }
})

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const FIREWALL = { clusterOptions: null, clusterRules: [], nodesList: ['pve1'], firewallMode: 'cluster' as const, onComplete: vi.fn() }

const PREFLIGHT_FAIL = {
  checks: [
    { id: 'cluster_firewall', status: 'fail', fix: 'enable_cluster_firewall' },
    { id: 'socle_rules', status: 'fail', fix: 'socle', detail: { web: false, ssh: false } },
  ],
}

function renderConfigured(over: Partial<Parameters<typeof MicrosegTab>[0]> = {}) {
  return renderTab(<MicrosegTab connectionId='c1' connectionName='prod' firewall={FIREWALL} {...over} />)
}

describe('preflight', () => {
  it('opens from the first step of the first run guide', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy())
    mock.routes['GET /preflight'] = () => reply(200, PREFLIGHT_FAIL)
    renderConfigured()

    fireEvent.click(await screen.findByRole('button', { name: 'Run the checks' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pre-flight checks' })
    expect(await within(dialog).findByRole('listitem', { name: 'Management access: failed' })).toBeTruthy()
  })

  it('opens from a button in the header of the Policy sub-tab', async () => {
    mock.routes['GET /preflight'] = () => reply(200, PREFLIGHT_FAIL)
    window.localStorage.setItem('microseg.subTab', 'policy')
    renderConfigured()

    fireEvent.click(await screen.findByRole('button', { name: 'Pre-flight checks' }))
    expect(await screen.findByRole('dialog', { name: 'Pre-flight checks' })).toBeTruthy()
    expect(calls('GET /preflight')).toHaveLength(1)
  })

  it('opens the deployment wizard from the cluster firewall check, and checks again when the wizard is done', async () => {
    mock.routes['GET /preflight'] = () => reply(200, PREFLIGHT_FAIL)
    window.localStorage.setItem('microseg.subTab', 'policy')
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Pre-flight checks' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pre-flight checks' })

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Open the deployment wizard' }))
    const wizard = await screen.findByRole('dialog', { name: 'Deployment wizard' })
    expect(wizard.getAttribute('data-conn')).toBe('c1')

    fireEvent.click(within(wizard).getByRole('button', { name: 'Wizard done' }))
    expect(FIREWALL.onComplete).toHaveBeenCalled()
    await waitFor(() => expect(calls('GET /preflight').length).toBeGreaterThan(1))
  })

  it('offers no wizard when the page gave no firewall data', async () => {
    mock.routes['GET /preflight'] = () => reply(200, PREFLIGHT_FAIL)
    window.localStorage.setItem('microseg.subTab', 'policy')
    renderConfigured({ firewall: undefined })
    fireEvent.click(await screen.findByRole('button', { name: 'Pre-flight checks' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pre-flight checks' })
    await within(dialog).findByRole('listitem', { name: 'Cluster firewall: failed' })
    expect(within(dialog).queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
  })
})

describe('settings', () => {
  it('opens from the Settings button of the tab', async () => {
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation settings' })).toBeTruthy()
  })

  it('opens from the gear of the Observation sub-tab: its legend, on the row of the pager, has no link of its own', async () => {
    window.localStorage.setItem('microseg.subTab', 'observation')
    mock.routes['GET /suggestions?limit=26&status=pending'] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    renderConfigured()
    const legend = await screen.findByTestId('observation-legend')
    expect(screen.getByTestId('microseg-actions-slot').contains(legend)).toBe(false)
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation settings' })).toBeTruthy()
  })

  it('follows a removal in the strip and shows it complete with the tags kept', async () => {
    mock.routes['POST /remove'] = () => reply(202, { run_id: 'rm1' })
    mock.routes['GET /runs/rm1'] = () => reply(200, {
      ...run('done', { guests: 2, members: 2, steps: 4, drifts: 0, complete: true, notes: ['the zone tags of the guests are kept'] }),
      id: 'rm1', kind: 'remove',
    })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove…' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: 'prod' } })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('prod: removal complete, the zone tags stay on the guests')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Micro-segmentation settings' })).toBeNull())
  })

  it('says a removal is incomplete when the engine kept some of it', async () => {
    mock.routes['POST /remove'] = () => reply(202, { run_id: 'rm1' })
    mock.routes['GET /runs/rm1'] = () => reply(200, {
      ...run('done', { guests: 2, members: 2, steps: 4, drifts: 0, complete: false, notes: ['the removal is not complete: run it again'] }),
      id: 'rm1', kind: 'remove',
    })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove…' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: 'prod' } })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('prod: removal incomplete, run it again')).toBeTruthy()
  })
})

describe('removal run', () => {
  const removeRun = (status: MicrosegRun['status']): MicrosegRun => ({
    ...run(status, status === 'running' ? null : {
      guests: 2, members: 2, steps: 4, drifts: 0, complete: true, notes: ['the zone tags of the guests are kept'],
    }),
    id: 'rm1', kind: 'remove',
  })

  const startRemoval = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove…' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: 'prod' } })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
  }

  it('shows the progress, then the result with its notes, and keeps it until dismissed', async () => {
    window.localStorage.setItem('microseg.subTab', 'history')
    mock.routes['GET /revisions?limit=100'] = () => reply(200, { revisions: [] })
    mock.routes['GET /runs?limit=100'] = () => reply(200, { runs: [], limit: 100, offset: 0 })
    mock.routes['POST /remove'] = () => reply(202, { run_id: 'rm1' })
    let finish: (r: MicrosegRun) => void = () => undefined
    const pending = new Promise<MicrosegRun>(resolve => { finish = resolve })
    let reads = 0
    mock.routes['GET /runs/rm1'] = async () => (reads++ === 0 ? reply(200, removeRun('running')) : reply(200, await pending))
    renderConfigured()

    await startRemoval()
    expect(await screen.findByText('prod: removing micro-segmentation...')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Micro-segmentation settings' })).toBeNull())

    const runsReads = calls('GET /runs?limit=100').length
    await act(async () => { finish(removeRun('done')) })
    expect(await screen.findByText('prod: removal complete, the zone tags stay on the guests', undefined, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByText('the zone tags of the guests are kept')).toBeTruthy()
    // The summary and the note of the engine are two sentences: a separator stands between them.
    const summary = screen.getByText('prod: removal complete, the zone tags stay on the guests')
    const separator = screen.getByText('·')
    const note = screen.getByText('the zone tags of the guests are kept')
    expect(summary.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(separator.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(calls('GET /runs?limit=100').length).toBeGreaterThan(runsReads))
  })

  it('keeps a finished removal past the ten seconds of the other runs, until dismissed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mock.routes['POST /remove'] = () => reply(202, { run_id: 'rm1' })
      mock.routes['GET /runs/rm1'] = () => reply(200, removeRun('done'))
      renderConfigured()
      await startRemoval()
      expect(await screen.findByText('prod: removal complete, the zone tags stay on the guests')).toBeTruthy()

      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
      const line = screen.getByText('prod: removal complete, the zone tags stay on the guests').closest('[role="alert"]') as HTMLElement
      fireEvent.click(within(line).getByRole('button', { name: /close/i }))
      expect(screen.queryByText('prod: removal complete, the zone tags stay on the guests')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)
})

describe('removal run of one cluster of a shared policy', () => {
  const C2 = '/api/v1/firewall/microseg/c2'
  const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }]
  const link = (connection_id: string) => ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })
  const removed = (id: string) => ({ ...run('done', { guests: 2, members: 2, steps: 4, drifts: 0, complete: true, notes: [] }), id, kind: 'remove' as const })

  /** c1 (the tab) and c2 share the policy until the removal run ends; c2's status cannot be read, which its line says. */
  function setupShared(leaving: 'c1' | 'c2') {
    let left = false
    mock.routes['GET /clusters'] = () => reply(200, { clusters: left ? [link('c1')] : [link('c1'), link('c2')], max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD, clusters: left ? [link('c1')] : [link('c1'), link('c2')] }))
    mock.routes[`GET ${C2}/status`] = () => reply(504, { code: 'ORCHESTRATOR_TIMEOUT', error: 't' })
    const base = leaving === 'c1' ? '' : C2
    mock.routes[`POST ${base}/remove`] = () => reply(202, { run_id: 'rm1' })
    mock.routes[`GET ${base}/runs/rm1`] = () => {
      left = true
      return reply(200, removed('rm1'))
    }
  }

  async function removeFrom(name: string) {
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove…' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    fireEvent.mouseDown(within(confirm).getByRole('combobox', { name: 'Cluster or node' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name }))
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: name } })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
  }

  it.each([['the tab\'s own cluster', 'c1', 'PVE-PROD'], ['another cluster', 'c2', 'PVE-DR']] as const)('reads the group and the draft again once the removal of %s ended, and stops reading the cluster that left', async (_, leaving, name) => {
    setupShared(leaving)
    renderConfigured({ connections: CONNECTIONS })
    expect(await screen.findByText('Unreachable: its state is unknown.')).toBeTruthy()
    const groupReads = calls('GET /clusters').length
    const policyReads = calls('GET /policy').length
    await removeFrom(name)
    expect(await screen.findByText(`${name}: removal complete, the zone tags stay on the guests`)).toBeTruthy()
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(groupReads))
    expect(calls('GET /policy').length).toBeGreaterThan(policyReads)
    // The group is the tab's cluster alone: nothing of the cluster that left is read or said any more.
    await waitFor(() => expect(screen.queryByText('Unreachable: its state is unknown.')).toBeNull())
    const c2Reads = fetchedC2()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(fetchedC2()).toBe(c2Reads)
  })

  it('reads no group again after the removal of a policy of one cluster', async () => {
    mock.routes['POST /remove'] = () => reply(202, { run_id: 'rm1' })
    mock.routes['GET /runs/rm1'] = () => reply(200, removed('rm1'))
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove…' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const groupReads = calls('GET /clusters').length
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: 'prod' } })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('prod: removal complete, the zone tags stay on the guests')).toBeTruthy()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(calls('GET /clusters')).toHaveLength(groupReads)
  })
})

/** How many requests went to c2. */
const fetchedC2 = () => (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(([u]) => String(u).includes('/microseg/c2/') || String(u).includes('connId=c2')).length

describe('history', () => {
  it('follows a restore in the strip and refreshes the policy at the end', async () => {
    window.localStorage.setItem('microseg.subTab', 'history')
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD }))
    mock.routes['GET /revisions?limit=100'] = () => reply(200, {
      revisions: [{ ...REVISION_HEAD, snapshot: { tag_prefix: 'zone-', zones: [zone('a')], flows: [] } }],
    })
    mock.routes['GET /runs?limit=100'] = () => reply(200, { runs: [], limit: 100, offset: 0 })
    mock.routes['POST /revisions/r1/restore'] = () => reply(202, { run_id: 'rs1' })
    mock.routes['GET /runs/rs1'] = () => reply(200, { ...run('done', { guests: 1, members: 1, steps: 1, drifts: 0, done: [{ index: 0, kind: 'guest.tags', object: 'g', summary: 's' }] }), id: 'rs1' })
    renderConfigured()

    const line = await screen.findByRole('row', { name: 'Version 2' })
    fireEvent.click(within(line).getByRole('button', { name: 'Restore' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore version 2?' })
    const policyReads = calls('GET /policy').length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))

    const runsReads = calls('GET /runs?limit=100').length
    expect(await screen.findByText('Restore of version 2: 1 done, 0 failed, 0 not run')).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(policyReads))
    await waitFor(() => expect(calls('GET /runs?limit=100').length).toBeGreaterThan(runsReads))
  })
})

describe('revisions after a run', () => {
  it('lists the revision a restore recorded, with the Latest chip, once the run has ended', async () => {
    window.localStorage.setItem('microseg.subTab', 'history')
    const head = { ...REVISION_HEAD, id: 'r2', version: 3 }
    let restored = false
    const older = { ...REVISION_HEAD, snapshot: { tag_prefix: 'zone-', zones: [zone('a')], flows: [] } }
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: restored ? head : REVISION_HEAD }))
    mock.routes['GET /revisions?limit=100'] = () => reply(200, { revisions: restored ? [{ ...head, snapshot: older.snapshot }, older] : [older] })
    mock.routes['GET /runs?limit=100'] = () => reply(200, { runs: [], limit: 100, offset: 0 })
    mock.routes['POST /revisions/r1/restore'] = () => { restored = true; return reply(202, { run_id: 'rs1' }) }
    mock.routes['GET /runs/rs1'] = () => reply(200, { ...run('done', { guests: 1, members: 1, steps: 0, drifts: 0 }), id: 'rs1' })
    renderConfigured()

    const line = await screen.findByRole('row', { name: 'Version 2' })
    expect(within(line).getByText('Latest')).toBeTruthy()
    fireEvent.click(within(line).getByRole('button', { name: 'Restore' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Restore version 2?' })).getByRole('button', { name: 'Restore' }))

    const added = await screen.findByRole('row', { name: 'Version 3' })
    expect(within(added).getByText('Latest')).toBeTruthy()
    expect(within(screen.getByRole('row', { name: 'Version 2' })).queryByText('Latest')).toBeNull()
  })
})

describe('sub-tab', () => {
  it('shows the History panel instead of the placeholder', async () => {
    window.localStorage.setItem('microseg.subTab', 'history')
    mock.routes['GET /revisions?limit=100'] = () => reply(200, { revisions: [] })
    mock.routes['GET /runs?limit=100'] = () => reply(200, { runs: [], limit: 100, offset: 0 })
    renderConfigured()
    expect(await screen.findByText('Nothing recorded yet: the first apply records a revision.')).toBeTruthy()
    expect(screen.queryByText('This section is not available yet.')).toBeNull()
  })
})
