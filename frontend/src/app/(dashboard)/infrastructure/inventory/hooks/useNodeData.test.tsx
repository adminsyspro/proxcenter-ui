import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

import { useNodeData } from './useNodeData'

const NODE_A = 'conn-1:pve1'
const NODE_B = 'conn-1:pve2'

type Props = { id: string; nodeTab: number; subTab?: number; cluster?: string }

function render(initial: Props) {
  return renderHook(
    ({ id, nodeTab, subTab = 0, cluster = 'lab' }: Props) =>
      useNodeData('node', id, nodeTab, subTab, 0, vi.fn(), vi.fn(), cluster),
    { initialProps: initial },
  )
}

let fetchSpy: ReturnType<typeof vi.spyOn>
let gates: Record<string, () => void>

/** Every request of node A waits for gates[<section>](); node B answers at once. */
function mockNodes(body: (node: string, section: string) => any) {
  fetchSpy.mockImplementation(async (input: any) => {
    const url = String(input)
    const node = /nodes\/(pve\d)/.exec(url)![1]
    const section = /nodes\/pve\d\/(\w+)/.exec(url)![1]

    if (node === 'pve1') await new Promise<void>(r => { gates[section] = r })

    return { ok: true, json: async () => body(node, section) } as any
  })
}

beforeEach(() => {
  gates = {}
  fetchSpy = vi.spyOn(global, 'fetch')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useNodeData selection guard', () => {
  it('never shows node A notes on node B and still loads B (A -> B while A is pending)', async () => {
    mockNodes(node => ({ data: { notes: `notes of ${node}` } }))
    const { result, rerender } = render({ id: NODE_A, nodeTab: 1 })

    await waitFor(() => expect(gates.notes).toBeDefined())
    const aSignal = (fetchSpy.mock.calls[0][1] as any).signal as AbortSignal

    rerender({ id: NODE_B, nodeTab: 1 })
    await waitFor(() => expect(result.current.nodeNotesData).toBe('notes of pve2'))
    expect(aSignal.aborted).toBe(true)

    await act(async () => { gates.notes(); await Promise.resolve() })
    expect(result.current.nodeNotesData).toBe('notes of pve2')
    expect(result.current.nodeNotesLoading).toBe(false)
    expect(result.current.nodeNotesLoaded).toBe(true)
  })

  it.each([
    ['disks', 5, 'nodeDisksData'],
    ['subscription', 11, 'nodeSubscriptionData'],
    ['replication', 9, 'nodeReplicationData'],
    ['system', 6, 'nodeSystemData'],
    ['ceph', 8, 'nodeCephData'],
  ])('keeps the %s tab of node B free of node A data', async (section, tabIndex, field) => {
    mockNodes(node => ({ data: { owner: node } }))
    const { result, rerender } = render({ id: NODE_A, nodeTab: tabIndex })

    await waitFor(() => expect(gates[section]).toBeDefined())
    rerender({ id: NODE_B, nodeTab: tabIndex })
    await waitFor(() => expect((result.current as any)[field]?.owner).toBe('pve2'))

    await act(async () => { gates[section](); await Promise.resolve() })
    expect((result.current as any)[field].owner).toBe('pve2')
  })

  it('keeps the syslog of node B free of node A lines', async () => {
    mockNodes(node => ({ data: [`line of ${node}`] }))
    const { result, rerender } = render({ id: NODE_A, nodeTab: 6, subTab: 6 })

    await waitFor(() => expect(gates.syslog).toBeDefined())
    rerender({ id: NODE_B, nodeTab: 6, subTab: 6 })
    await waitFor(() => expect(result.current.nodeSyslogData).toEqual(['line of pve2']))

    await act(async () => { gates.syslog(); await Promise.resolve() })
    expect(result.current.nodeSyslogData).toEqual(['line of pve2'])
    expect(result.current.nodeSyslogLoading).toBe(false)
  })

  it('drops the failure of a stale load instead of blanking node B', async () => {
    fetchSpy.mockImplementation((input: any) => {
      if (String(input).includes('pve1')) return new Promise((_r, rej) => { gates.fail = () => rej(new Error('boom')) }) as any

      return Promise.resolve({ ok: true, json: async () => ({ data: { owner: 'pve2' } }) } as any)
    })
    const { result, rerender } = render({ id: NODE_A, nodeTab: 5 })

    await waitFor(() => expect(gates.fail).toBeDefined())
    rerender({ id: NODE_B, nodeTab: 5 })
    await waitFor(() => expect(result.current.nodeDisksData?.owner).toBe('pve2'))

    await act(async () => { gates.fail(); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.nodeDisksData).toEqual({ owner: 'pve2' })
  })

  it('reports a load failure of the node still displayed', async () => {
    fetchSpy.mockRejectedValue(new Error('boom'))
    const { result } = render({ id: NODE_A, nodeTab: 8 })

    await waitFor(() => expect(result.current.nodeCephData).toEqual({ hasCeph: false }))
    expect(result.current.nodeCephLoading).toBe(false)
  })

  it.each([
    [1, 'nodeNotesData', ''],
    [5, 'nodeDisksData', null],
    [11, 'nodeSubscriptionData', null],
    [9, 'nodeReplicationData', null],
    [6, 'nodeSystemData', null],
  ])('a failing load on tab %s of the node displayed ends its loading and logs', async (tabIndex, field, expected) => {
    fetchSpy.mockRejectedValue(new Error('pve down'))
    const { result } = render({ id: NODE_A, nodeTab: tabIndex as number })

    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect((result.current as any)[field]).toEqual(expected)
  })

  it('a failing syslog load of the node displayed is logged', async () => {
    fetchSpy.mockRejectedValue(new Error('pve down'))
    const { result } = render({ id: NODE_A, nodeTab: 6, subTab: 6 })

    await waitFor(() => expect(result.current.nodeSyslogLoading).toBe(false))
    expect(console.error).toHaveBeenCalledWith('Failed to load syslog:', expect.any(Error))
  })
})
