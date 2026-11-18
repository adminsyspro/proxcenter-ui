/**
 * Associating a cluster: one select of the candidates, nothing written before the next application, the refusals
 * of the backend each with its own message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, reply, resetMocks } from './microsegTestKit'
import AssociateClusterDialog from './AssociateClusterDialog'
import { connectionKind } from './ConnectionGlyph'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CANDIDATES = [{ id: 'c3', name: 'LAB' }, { id: 'c2', name: 'PVE-DR' }]

function open() {
  const handlers = { onDone: vi.fn(), onCancel: vi.fn() }
  renderWithProviders(<AssociateClusterDialog connectionId='c1' candidates={CANDIDATES} {...handlers} />)
  return handlers
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
const line = (name: string) => box(name).closest('label') as HTMLElement

function pick(name: string) {
  fireEvent.click(box(name))
}

const associate = () => screen.getByRole('button', { name: 'Associate' }) as HTMLButtonElement

const nodesReply = (nodes: { status: string }[]) => ({ ok: true, status: 200, json: async () => ({ data: nodes }), text: async () => '' })

describe('connectionKind', () => {
  it.each([
    [[{ status: 'online' }], { kind: 'node', status: 'online' }],
    [[{ status: 'offline' }], { kind: 'node', status: 'offline' }],
    [[{ status: 'online' }, { status: 'online' }], { kind: 'cluster', status: 'online' }],
    [[{ status: 'online' }, { status: 'offline' }], { kind: 'cluster', status: 'maintenance' }],
    [[{ status: 'offline' }, { status: 'offline' }], { kind: 'cluster', status: 'offline' }],
    [[], { kind: 'cluster', status: 'unknown' }],
    [undefined, { kind: 'cluster', status: 'unknown' }],
  ])('reads %j as %j', (nodes, expected) => {
    expect(connectionKind(nodes)).toEqual(expected)
  })
})

describe('AssociateClusterDialog', () => {
  it('heads each line with the glyph of a cluster or of a standalone node, with its state', async () => {
    mock.routes['GET /api/v1/connections/c2/nodes'] = () => nodesReply([{ status: 'online' }, { status: 'offline' }])
    mock.routes['GET /api/v1/connections/c3/nodes'] = () => nodesReply([{ status: 'online' }])
    open()
    await waitFor(() => expect(within(line('LAB')).getByTestId('connection-glyph-node-dot').dataset.status).toBe('online'))
    expect(within(line('PVE-DR')).getByTestId('connection-glyph-cluster-dot').dataset.status).toBe('maintenance')
  })

  it('keeps a line whose connection cannot be read, with an unknown state', () => {
    open()
    expect(within(line('PVE-DR')).getByTestId('connection-glyph-cluster-dot').dataset.status).toBe('unknown')
  })

  it('associates several connections one after the other, the All box following the choice', async () => {
    mock.routes['POST /clusters'] = () => reply(201, { clusters: [], max: 8 })
    const { onDone } = open()
    const all = box('All')
    pick('LAB')
    expect(all.dataset.indeterminate).toBe('true')
    fireEvent.click(all)
    expect(box('LAB').checked).toBe(false)
    fireEvent.click(all)
    expect(box('LAB').checked && box('PVE-DR').checked && all.checked).toBe(true)
    fireEvent.click(associate())
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(calls('POST /clusters').map(([, init]) => JSON.parse(String((init as RequestInit).body)).connection_id)).toEqual(['c3', 'c2'])
  })

  it('keeps the ones linked when another is refused: the refusal is named, the group is read again, the dialog stays', async () => {
    mock.routes['POST /clusters'] = init => (JSON.parse(String(init?.body)).connection_id === 'c2'
      ? reply(502, { code: 'CLUSTER_UNREADABLE', error: 'refused' })
      : reply(201, { clusters: [], max: 8 }))
    const onChanged = vi.fn()
    const handlers = { onDone: vi.fn(), onCancel: vi.fn() }
    renderWithProviders(<AssociateClusterDialog connectionId='c1' candidates={CANDIDATES} onChanged={onChanged} {...handlers} />)
    fireEvent.click(box('All'))
    fireEvent.click(associate())
    expect(await screen.findByText(/^PVE-DR: The cluster could not be inspected/)).toBeTruthy()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(handlers.onDone).not.toHaveBeenCalled()
    // Only the refused one stays chosen, for another try.
    expect(box('PVE-DR').checked).toBe(true)
    expect(box('LAB').checked).toBe(false)
  })

  it('never lets more be chosen than the policy can still take', () => {
    renderWithProviders(<AssociateClusterDialog connectionId='c1' candidates={CANDIDATES} slots={1} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('The policy can take 1 more.')).toBeTruthy()
    pick('PVE-DR')
    expect(box('LAB').disabled).toBe(true)
    expect(box('All').checked).toBe(true)
    pick('PVE-DR')
    fireEvent.click(box('All'))
    expect([box('LAB').checked, box('PVE-DR').checked]).toEqual([true, false])
  })

  it('says nothing is written before the next application and waits for a choice', () => {
    open()
    expect(screen.getByText('Nothing is written on them until the next application.')).toBeTruthy()
    expect(associate().disabled).toBe(true)
  })

  it('associates the selected cluster', async () => {
    mock.routes['POST /clusters'] = () => reply(201, { clusters: [], max: 8 })
    const { onDone } = open()
    pick('PVE-DR')
    fireEvent.click(associate())
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const [[, init]] = calls('POST /clusters')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ connection_id: 'c2' })
  })

  it.each([
    ['CLUSTER_NOT_EMPTY', 409, /^PVE-DR still holds micro-segmentation data.*remove the micro-segmentation there, then delete its zones and rules/],
    ['TOO_MANY_CLUSTERS', 409, /already has the most clusters it can take/],
    ['CLUSTER_UNREADABLE', 502, /could not be inspected\. Try again later/],
  ])('says why the backend refused (%s)', async (code, status, message) => {
    mock.routes['POST /clusters'] = () => reply(status, { code, error: 'refused' })
    const { onDone } = open()
    pick('PVE-DR')
    fireEvent.click(associate())
    expect(await screen.findByText(message)).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })
  it('lets a refusal wrap on several lines in the body of the window, never cut on one line', async () => {
    mock.routes['POST /clusters'] = () => reply(409, { code: 'CLUSTER_NOT_EMPTY', error: 'refused' })
    open()
    pick('PVE-DR')
    fireEvent.click(associate())
    const text = await screen.findByText(/PVE-DR still holds micro-segmentation data/)
    const alert = text.closest('[role="alert"]') as HTMLElement
    expect(alert).toBeTruthy()
    expect(alert.querySelector('.MuiTypography-noWrap')).toBeNull()
    expect(text.classList.contains('MuiTypography-noWrap')).toBe(false)
    expect(alert.closest('.MuiDialogActions-root')).toBeNull()
  })
})

describe('the firewall state of a candidate', () => {
  const C2 = '/api/v1/firewall/microseg/c2'
  const C3 = '/api/v1/firewall/microseg/c3'
  const OFF_HINT = 'The cluster firewall is off on this cluster: associating is possible, applying will be refused until it is on.'

  it('reads the checks of a candidate once, when its box is checked, and marks it red when its cluster firewall is off', async () => {
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [{ id: 'cluster_firewall', status: 'fail' }] })
    open()
    expect(calls(`GET ${C2}/preflight`)).toHaveLength(0)
    expect(calls(`GET ${C3}/preflight`)).toHaveLength(0)
    pick('PVE-DR')
    const mark = await within(line('PVE-DR')).findByRole('img', { name: OFF_HINT })
    expect(mark.className).toContain('ri-close-circle-fill')
    // Unchecked and checked again: the answer is kept for the life of the dialog.
    pick('PVE-DR')
    pick('PVE-DR')
    expect(calls(`GET ${C2}/preflight`)).toHaveLength(1)
    expect(calls(`GET ${C3}/preflight`)).toHaveLength(0)
  })

  it('marks it orange when only the firewall service is stopped, naming the nodes', async () => {
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [{ id: 'cluster_firewall', status: 'pass' }, { id: 'firewall_service', status: 'fail', detail: { nodes: ['pve1', 'pve2'] } }] })
    open()
    pick('PVE-DR')
    const mark = await within(line('PVE-DR')).findByRole('img', { name: 'The firewall service is stopped on pve1, pve2.' })
    expect(mark.className).toContain('ri-alert-fill')
  })

  it('shows nothing when the checks pass or cannot be read, and never blocks the association', async () => {
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [{ id: 'cluster_firewall', status: 'pass' }, { id: 'firewall_service', status: 'pass' }] })
    mock.routes[`GET ${C3}/preflight`] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    open()
    pick('PVE-DR')
    pick('LAB')
    await waitFor(() => expect(calls(`GET ${C3}/preflight`)).toHaveLength(1))
    await waitFor(() => expect(calls(`GET ${C2}/preflight`)).toHaveLength(1))
    expect(within(line('PVE-DR')).queryByRole('img')).toBeNull()
    expect(within(line('LAB')).queryByRole('img')).toBeNull()
    expect(associate().disabled).toBe(false)
  })

  it('still associates a candidate whose firewall is off', async () => {
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [{ id: 'cluster_firewall', status: 'fail' }] })
    mock.routes['POST /clusters'] = () => reply(201, { clusters: [], max: 8 })
    const { onDone } = open()
    pick('PVE-DR')
    await within(line('PVE-DR')).findByRole('img', { name: OFF_HINT })
    fireEvent.click(associate())
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })
})
