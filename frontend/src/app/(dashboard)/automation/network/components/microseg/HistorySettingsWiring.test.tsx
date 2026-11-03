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
    { id: 'cluster_firewall', status: 'pass' },
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

  it('opens the deployment wizard from a failed socle check, and checks again when the wizard is done', async () => {
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
    await within(dialog).findByRole('listitem', { name: 'Management access: failed' })
    expect(within(dialog).queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
  })
})

describe('settings', () => {
  it('opens from the Settings button of the tab', async () => {
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation settings' })).toBeTruthy()
  })

  it('opens from the link of the Observation sub-tab', async () => {
    window.localStorage.setItem('microseg.subTab', 'observation')
    mock.routes['GET /suggestions?limit=26&status=pending'] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Open settings' }))
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
    mock.routes['GET /runs?limit=11'] = () => reply(200, { runs: [], limit: 11, offset: 0 })
    mock.routes['POST /remove'] = () => reply(202, { run_id: 'rm1' })
    let finish: (r: MicrosegRun) => void = () => undefined
    const pending = new Promise<MicrosegRun>(resolve => { finish = resolve })
    let reads = 0
    mock.routes['GET /runs/rm1'] = async () => (reads++ === 0 ? reply(200, removeRun('running')) : reply(200, await pending))
    renderConfigured()

    await startRemoval()
    expect(await screen.findByText('prod: removing micro-segmentation...')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Micro-segmentation settings' })).toBeNull())

    const runsReads = calls('GET /runs?limit=11').length
    await act(async () => { finish(removeRun('done')) })
    expect(await screen.findByText('prod: removal complete, the zone tags stay on the guests', undefined, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByText('the zone tags of the guests are kept')).toBeTruthy()
    await waitFor(() => expect(calls('GET /runs?limit=11').length).toBeGreaterThan(runsReads))
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

describe('history', () => {
  it('follows a restore in the strip and refreshes the policy at the end', async () => {
    window.localStorage.setItem('microseg.subTab', 'history')
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD }))
    mock.routes['GET /revisions?limit=100'] = () => reply(200, {
      revisions: [{ ...REVISION_HEAD, snapshot: { tag_prefix: 'zone-', zones: [zone('a')], flows: [] } }],
    })
    mock.routes['GET /runs?limit=11'] = () => reply(200, { runs: [], limit: 11, offset: 0 })
    mock.routes['POST /revisions/r1/restore'] = () => reply(202, { run_id: 'rs1' })
    mock.routes['GET /runs/rs1'] = () => reply(200, { ...run('done', { guests: 1, members: 1, steps: 1, drifts: 0, done: [{ index: 0, kind: 'guest.tags', object: 'g', summary: 's' }] }), id: 'rs1' })
    renderConfigured()

    const line = await screen.findByRole('listitem', { name: 'Version 2' })
    fireEvent.click(within(line).getByRole('button', { name: 'Restore' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore version 2?' })
    const policyReads = calls('GET /policy').length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))

    const runsReads = calls('GET /runs?limit=11').length
    expect(await screen.findByText('Restore of version 2: 1 done, 0 failed, 0 not run')).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(policyReads))
    await waitFor(() => expect(calls('GET /runs?limit=11').length).toBeGreaterThan(runsReads))
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
    mock.routes['GET /runs?limit=11'] = () => reply(200, { runs: [], limit: 11, offset: 0 })
    mock.routes['POST /revisions/r1/restore'] = () => { restored = true; return reply(202, { run_id: 'rs1' }) }
    mock.routes['GET /runs/rs1'] = () => reply(200, { ...run('done', { guests: 1, members: 1, steps: 0, drifts: 0 }), id: 'rs1' })
    renderConfigured()

    const line = await screen.findByRole('listitem', { name: 'Version 2' })
    expect(within(line).getByText('Latest')).toBeTruthy()
    fireEvent.click(within(line).getByRole('button', { name: 'Restore' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Restore version 2?' })).getByRole('button', { name: 'Restore' }))

    const added = await screen.findByRole('listitem', { name: 'Version 3' })
    expect(within(added).getByText('Latest')).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'Version 2' })).queryByText('Latest')).toBeNull()
  })
})

describe('sub-tab', () => {
  it('shows the History panel instead of the placeholder', async () => {
    window.localStorage.setItem('microseg.subTab', 'history')
    mock.routes['GET /revisions?limit=100'] = () => reply(200, { revisions: [] })
    mock.routes['GET /runs?limit=11'] = () => reply(200, { runs: [], limit: 11, offset: 0 })
    renderConfigured()
    expect(await screen.findByText('No revision yet: the first apply records one.')).toBeTruthy()
    expect(screen.queryByText('This section is not available yet.')).toBeNull()
  })
})
