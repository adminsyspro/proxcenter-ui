/**
 * roadmap#198: the bar above the Nodes table of a cluster puts the selected
 * nodes in maintenance together, or takes them out together.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import HostGroupBar, { canGroupExit, groupEnterBlocker } from '@/components/HostGroupBar'

const drain = vi.hoisted(() => ({ props: null as any }))
const exit = vi.hoisted(() => ({ props: null as any }))
vi.mock('@/components/HostDrainDialog', () => ({ default: (p: any) => { drain.props = p; return null } }))
vi.mock('@/components/HostGroupExitDialog', () => ({ default: (p: any) => { exit.props = p; return null } }))

const node = (name: string, status: 'online' | 'offline' | 'maintenance' = 'online') => ({ id: `c1:${name}`, name, status })
const NODES = [node('pve1'), node('pve2'), node('pve3'), node('pve4', 'maintenance'), node('pve5', 'maintenance')]

afterEach(() => {
  cleanup()
  drain.props = null
  exit.props = null
})

describe('groupEnterBlocker and canGroupExit', () => {
  it('needs two online nodes and one online node left outside', () => {
    expect(groupEnterBlocker([NODES[0]], NODES)).toBe('count')
    expect(groupEnterBlocker([NODES[0], NODES[3]], NODES)).toBe('state')
    expect(groupEnterBlocker(NODES.slice(0, 3), NODES)).toBe('remaining')
    expect(groupEnterBlocker(NODES.slice(0, 2), NODES)).toBeNull()
    expect(canGroupExit([NODES[3], NODES[4]])).toBe(true)
    expect(canGroupExit([NODES[3], NODES[0]])).toBe(false)
    expect(canGroupExit([NODES[3]])).toBe(false)
  })
})

describe('HostGroupBar', () => {
  it('shows nothing without a selection', () => {
    renderWithProviders(<HostGroupBar connId="c1" nodes={NODES} selectedIds={new Set()} onClear={vi.fn()} />)
    expect(screen.queryByTestId('host-group-bar')).toBeNull()
  })

  it('opens the group maintenance for the selected nodes, the others as targets', () => {
    const onClear = vi.fn()
    renderWithProviders(<HostGroupBar connId="c1" nodes={NODES} selectedIds={new Set(['c1:pve1', 'c1:pve2'])} onClear={onClear} />)
    expect(screen.getByTestId('host-group-bar').textContent).toContain('2 host(s) selected')
    expect((screen.getByTestId('host-group-exit') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('host-group-enter'))
    expect(drain.props).toMatchObject({ mode: 'maintenance', connId: 'c1', node: '', nodes: ['pve1', 'pve2'], otherNodes: ['pve3'] })

    act(() => drain.props.onClose())
    expect(drain.props).toMatchObject({ nodes: ['pve1', 'pve2'] })
    fireEvent.click(screen.getByTestId('host-group-enter'))
    act(() => drain.props.onStarted({ id: 'g' }))
    expect(onClear).toHaveBeenCalled()

    fireEvent.click(screen.getByText('Clear'))
    expect(onClear).toHaveBeenCalledTimes(2)
  })

  it('takes nodes in maintenance out together', () => {
    renderWithProviders(<HostGroupBar connId="c1" nodes={NODES} selectedIds={new Set(['c1:pve4', 'c1:pve5'])} onClear={vi.fn()} />)
    expect((screen.getByTestId('host-group-enter') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('host-group-exit'))
    expect(exit.props).toMatchObject({ connId: 'c1', nodes: ['pve4', 'pve5'] })
    act(() => exit.props.onClose())
  })
})
