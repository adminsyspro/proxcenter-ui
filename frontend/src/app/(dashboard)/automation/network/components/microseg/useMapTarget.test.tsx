/**
 * The target of the Overview (UA43): a `?vm=<vmid>` link targets that guest once the inventory is read, a pick or a
 * clear wins over the link, and the target follows the inventory. renderWithProviders stubs next/navigation for every
 * file that imports it, so this file mocks it itself and renders the hook alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const navigation = vi.hoisted(() => ({ search: '' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => '/automation/network',
}))

import { useMapTarget } from './useMapTarget'
import type { PolicyGuest, ZoneMember } from './zoneModel'

const guest = (vmid: number, name: string, status = 'running'): PolicyGuest => ({ vmid, name, node: 'pve1', type: 'qemu', status, tags: [], ips: [`10.0.0.${vmid % 250}`] })
const web1 = guest(100, 'web-1')
const db1 = guest(200, 'db-1')
const members = new Map<string, ZoneMember[]>([['zd', [{ ref: { node: 'pve1', type: 'qemu', vmid: 200 }, guest: db1, pending: false }]]])

const replaceState = vi.spyOn(window.history, 'replaceState')
afterEach(() => { window.location.hash = '' })

function render(search: string, guests: PolicyGuest[] = [web1, db1]) {
  navigation.search = search
  replaceState.mockClear()
  return renderHook(({ list }) => useMapTarget(list, members), { initialProps: { list: guests } })
}

describe('the target of the map', () => {
  it('targets the guest of a ?vm= link, with its zone, once the inventory knows it', () => {
    const hook = render('vm=200', [])
    expect(hook.result.current.target).toBeNull()
    hook.rerender({ list: [web1, db1] })
    expect(hook.result.current.target).toMatchObject({ name: 'db-1', vmid: 200, zoneId: 'zd' })
    expect(hook.result.current.panelOpen).toBe(true)
  })

  it('ignores a link to no running guest, and targets nothing without a link', () => {
    expect(render('vm=999').result.current.target).toBeNull()
    expect(render('vm=300', [web1, guest(300, 'old', 'stopped')]).result.current.target).toBeNull()
    expect(render('').result.current.target).toBeNull()
  })

  it('lets a pick or a clear win over the link, and closes the panel on a clear', () => {
    const hook = render('vm=200')
    act(() => hook.result.current.pick(hook.result.current.candidates.find(c => c.vmid === 100)!))
    expect(hook.result.current.target?.name).toBe('web-1')
    act(() => hook.result.current.hidePanel())
    expect(hook.result.current.panelOpen).toBe(false)
    act(() => hook.result.current.showPanel())
    expect(hook.result.current.panelOpen).toBe(true)
    act(() => hook.result.current.pick(null))
    expect(hook.result.current.target).toBeNull()
    expect(hook.result.current.panelOpen).toBe(false)
  })

  it('drops a target that stops running', () => {
    const hook = render('vm=100')
    expect(hook.result.current.target?.name).toBe('web-1')
    hook.rerender({ list: [guest(100, 'web-1', 'stopped'), db1] })
    expect(hook.result.current.target).toBeNull()
  })

  it('knows the guest name of each address', () => {
    expect(render('').result.current.peers.get('10.0.0.200')).toBe('db-1')
  })
})

describe('the ?vm= link once used', () => {
  it('leaves the address on a pick or a clear, keeping the other parameters', () => {
    const hook = render('vm=200&tab=x')
    act(() => hook.result.current.pick(null))
    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/automation/network?tab=x')
    const alone = render('vm=200')
    act(() => alone.result.current.pick(alone.result.current.candidates[0]))
    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/automation/network')
  })

  it('keeps the hash of the address', () => {
    window.location.hash = '#map'
    const hook = render('vm=200')
    act(() => hook.result.current.pick(null))
    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/automation/network#map')
  })

  it('touches no address without the parameter', () => {
    const hook = render('')
    act(() => hook.result.current.pick(hook.result.current.candidates[0]))
    expect(replaceState).not.toHaveBeenCalled()
  })
})
