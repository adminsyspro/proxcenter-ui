/**
 * The Dashboard card of the Micro-segmentation: plain words only (no run kind, no API call count),
 * one click away from the Micro-segmentation tab.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { useSWRConfig } from 'swr'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import MicrosegSummaryCard from './MicrosegSummaryCard'
import {
  calls, mock, policy, renderTab, reply, resetMocks, revisionWithSnapshot, status, zone, REVISION_HEAD,
} from './microsegTestKit'

beforeEach(resetMocks)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderCard = (onOpen = vi.fn()) => {
  renderTab(<MicrosegSummaryCard connectionId='c1' onOpen={onOpen} />)
  return onOpen
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const engine = (over: Partial<ReturnType<typeof status>['engine']> = {}) => ({ paused_until: null, held: false, last_runs: {}, last_log: null, ...over })

describe('deployment', () => {
  it('counts the zones of the last revision, not those of the draft', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({
      zones: [zone('a'), zone('b'), zone('c'), zone('d')], last_revision: REVISION_HEAD,
    }))
    mock.routes['GET /revisions?limit=1'] = () => reply(200, {
      revisions: [revisionWithSnapshot([zone('a', { state: 'enforce' }), zone('b', { state: 'observe' }), zone('c', { state: 'observe' })], [])],
    })
    renderCard()
    expect(await screen.findByText('Deployed: 1 zone enforced, 2 observing')).toBeTruthy()
  })

  it('says only "Deployed" while the snapshot of the last revision is not there', async () => {
    mock.routes['GET /revisions?limit=1'] = () => reply(500, { code: 'INTERNAL', error: 'boom' })
    renderCard()
    expect(await screen.findByText('Deployed')).toBeTruthy()
  })

  it('says "Not deployed" when no revision was ever applied, without reading the revisions', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: null }))
    renderCard()
    expect(await screen.findByText('Not deployed')).toBeTruthy()
    expect(calls('GET /revisions?limit=1')).toHaveLength(0)
  })

  it('says it in red while the emergency stop is on', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true }))
    renderCard()
    const text = await screen.findByText('Emergency stop active')
    expect(text.closest('.MuiChip-colorError')).toBeTruthy()
    expect(screen.queryByText(/^Deployed/)).toBeNull()
  })

  it('says that the cluster firewall is disabled when the stop turned it off', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine({ cluster_firewall: 'disabled' }) }))
    renderCard()
    const text = await screen.findByText('Emergency stop active: cluster firewall disabled')
    expect(text.closest('.MuiChip-colorError')).toBeTruthy()
  })

  it.each(['enabled', 'unknown'] as const)('keeps the short wording while the cluster firewall is %s', async state => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine({ cluster_firewall: state }) }))
    renderCard()
    expect(await screen.findByText('Emergency stop active')).toBeTruthy()
    expect(screen.queryByText(/cluster firewall disabled/)).toBeNull()
  })

  it('says "Not available" when the policy cannot be read', async () => {
    mock.routes['GET /policy'] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    renderCard()
    await waitFor(() => expect(screen.getAllByText('Not available').length).toBeGreaterThan(0))
    expect(screen.queryByText('Not deployed')).toBeNull()
  })
})

describe('protection', () => {
  it('tells how many guests are protected and how many running guests sit in no zone', async () => {
    renderCard()
    expect(await screen.findByText('2 of 3 guests protected')).toBeTruthy()
    expect(screen.getByText('2 running guests in no zone')).toBeTruthy()
  })

  it('says every running guest is in a zone when none is left out', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ coverage: { running: 4, zoned: 4, members: 4, protected: 4 } }))
    renderCard()
    expect(await screen.findByText('Every running guest is in a zone')).toBeTruthy()
    expect(screen.getByText('4 of 4 guests protected')).toBeTruthy()
  })

  it('uses the singular for one guest', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ coverage: { running: 4, zoned: 3, members: 3, protected: 3 } }))
    renderCard()
    expect(await screen.findByText('1 running guest in no zone')).toBeTruthy()
  })

  it('says nothing was measured before the first full check', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ coverage: { running: 0, zoned: 0, members: 0, protected: 0 } }))
    renderCard()
    expect(await screen.findByText('Not measured yet')).toBeTruthy()
  })

  it('waits for the first full check after a restart instead of reading 0 of 0', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ coverage: null }))
    renderCard()
    expect(await screen.findByText('Waiting for the first full check')).toBeTruthy()
    expect(screen.queryByText(/guests protected/)).toBeNull()
    expect(screen.queryByText(/in no zone/)).toBeNull()
  })
})

describe('engine', () => {
  it('says when the engine last checked, in relative time', async () => {
    mock.routes['GET /status'] = () => reply(200, status({
      engine: engine({
        last_runs: {
          light: { started_at: minutesAgo(30), status: 'done', api_calls: 3, writes: 0 },
          full: { started_at: minutesAgo(5), status: 'done', api_calls: 40, writes: 0 },
        },
      }),
    }))
    renderCard()
    expect(await screen.findByText('Last check 5 minutes ago')).toBeTruthy()
  })

  it('says no check happened yet', async () => {
    renderCard()
    expect(await screen.findByText('No check yet')).toBeTruthy()
  })

  it('shows the pause', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ engine: engine({ paused_until: '2099-01-01T10:00:00Z' }) }))
    renderCard()
    expect(await screen.findByText(/^Paused until /)).toBeTruthy()
  })

  it('shows both the hold and the pause when both are true', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ engine: engine({ held: true, paused_until: '2099-01-01T10:00:00Z' }) }))
    renderCard()
    expect(await screen.findByText('Waiting for your confirmation (write cap reached)')).toBeTruthy()
    expect(screen.getByText(/^Paused until /)).toBeTruthy()
    expect(screen.queryByText(/^Last check/)).toBeNull()
  })

  it('ignores a pause that is over', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ engine: engine({ paused_until: '2020-01-01T10:00:00Z' }) }))
    renderCard()
    await screen.findByText('No check yet')
    expect(screen.queryByText(/^Paused until /)).toBeNull()
  })

  it('says it waits for the admin when the write cap is reached, and confirms the writes after asking', async () => {
    let held = true
    mock.routes['GET /status'] = () => reply(200, status({ engine: engine({ held }) }))
    mock.routes['POST /confirm-writes'] = () => { held = false; return reply(200, { ok: true, was_held: true }) }
    const onOpen = renderCard()
    expect(await screen.findByText('Waiting for your confirmation (write cap reached)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm writes' }))
    const dialog = await screen.findByRole('dialog')
    expect(calls('POST /confirm-writes')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm writes' }))
    await waitFor(() => expect(calls('POST /confirm-writes')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('Waiting for your confirmation (write cap reached)')).toBeNull())
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shows why the confirmation failed', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ engine: engine({ held: true }) }))
    mock.routes['POST /confirm-writes'] = () => reply(503, { code: 'NOT_LEADER', error: 'x' })
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm writes' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm writes' }))
    expect(await screen.findByText('This orchestrator node is not the leader. Try again in a moment.')).toBeTruthy()
  })

  it('says "Not available" for the protection and the engine when /status fails, and keeps the deployment line', async () => {
    mock.routes['GET /status'] = () => reply(504, { code: 'ORCHESTRATOR_TIMEOUT', error: 't' })
    renderCard()
    // The protection and the engine both come from /status.
    await waitFor(() => expect(screen.getAllByText('Not available')).toHaveLength(2))
    expect(screen.getByText('Deployed: 0 zones enforced, 1 observing')).toBeTruthy()
  })
})

describe('plain words', () => {
  it('shows no run kind and no API call count', async () => {
    mock.routes['GET /status'] = () => reply(200, status({
      engine: engine({
        last_runs: {
          full: { started_at: minutesAgo(5), status: 'done', api_calls: 42, writes: 1 },
          ips: { started_at: minutesAgo(6), status: 'done', api_calls: 7, writes: 0 },
          light: { started_at: minutesAgo(1), status: 'done', api_calls: 3, writes: 0 },
          targeted: { started_at: minutesAgo(2), status: 'done', api_calls: 2, writes: 0 },
        },
      }),
    }))
    renderCard()
    await screen.findByText('Last check 1 minute ago')
    expect(document.body.textContent).not.toMatch(/API call|\b(full|ips|light|log|targeted)\b/i)
  })
})

describe('opening the Micro-segmentation tab', () => {
  it('opens it from the card and from its button', async () => {
    const onOpen = renderCard()
    await screen.findByText('2 of 3 guests protected')
    fireEvent.click(screen.getByText('2 of 3 guests protected'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Micro-segmentation' }))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})

/** Reads the status again, as its 15 s poll would. */
function PollStatus() {
  const { mutate } = useSWRConfig()
  return <button onClick={() => { void mutate('/api/v1/firewall/microseg/c1/status') }}>poll status</button>
}

describe('coherence (UA44)', () => {
  it('shows one skeleton, and no row that says nothing, until both reads are in', async () => {
    let release: (v: unknown) => void = () => {}
    mock.routes['GET /policy'] = () => new Promise(resolve => { release = resolve })
    renderCard()

    expect(await screen.findByTestId('microseg-card-loading')).toBeTruthy()
    expect(screen.queryByText('Not deployed')).toBeNull()
    expect(screen.queryByText('Waiting for the first full check')).toBeNull()
    expect(screen.queryByText('No check yet')).toBeNull()

    release(reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD })))
    expect(await screen.findByText(/^Deployed/)).toBeTruthy()
    expect(screen.queryByTestId('microseg-card-loading')).toBeNull()
  })

  it('says the connection has no micro-segmentation yet instead of three empty rows', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ version: 0, zones: [], last_revision: null }))
    mock.routes['GET /status'] = () => reply(200, status({ coverage: null }))
    renderCard()

    expect(await screen.findByText('Not set up on this connection yet: open the tab to define zones')).toBeTruthy()
    expect(screen.queryByText('Not deployed')).toBeNull()
    expect(screen.queryByText('Waiting for the first full check')).toBeNull()
  })

  it('names the connection it is about', async () => {
    renderTab(<MicrosegSummaryCard connectionId='c1' connectionName='PVE-DR' onOpen={vi.fn()} />)

    expect((await screen.findByTestId('microseg-card-connection')).textContent).toBe('PVE-DR')
  })

  it('reads the deployed state again when the status shows a new deployment made elsewhere', async () => {
    let deployed = false
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: deployed ? REVISION_HEAD : null }))
    mock.routes['GET /status'] = () => reply(200, status({
      engine: engine(deployed ? { last_runs: { apply: { started_at: minutesAgo(1), status: 'done', api_calls: 3, writes: 2 } } } : {}),
    }))
    renderTab(<><MicrosegSummaryCard connectionId='c1' onOpen={vi.fn()} /><PollStatus /></>)
    expect(await screen.findByText('Not deployed')).toBeTruthy()
    expect(calls('GET /policy')).toHaveLength(1)

    deployed = true
    fireEvent.click(screen.getByText('poll status'))

    expect(await screen.findByText(/^Deployed/)).toBeTruthy()
    expect(calls('GET /policy')).toHaveLength(2)
  })

  it('does not read the policy again on a poll that changed nothing', async () => {
    renderTab(<><MicrosegSummaryCard connectionId='c1' onOpen={vi.fn()} /><PollStatus /></>)
    await screen.findByText(/^Deployed/)

    fireEvent.click(screen.getByText('poll status'))
    await waitFor(() => expect(calls('GET /status')).toHaveLength(2))

    expect(calls('GET /policy')).toHaveLength(1)
  })
})
