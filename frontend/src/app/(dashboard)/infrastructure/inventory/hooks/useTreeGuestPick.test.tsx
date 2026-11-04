/**
 * roadmap#197: Ctrl/Cmd+click picks guests of the inventory tree for a power
 * action; a plain click drops the pick; a right click on a picked guest opens
 * the power menu at the pointer instead of the guest's own menu.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { guestKeyFromTarget, pickedRowsSx, togglePick } from '@/lib/inventory/treeGuestPick'
import { useTreeGuestPick } from './useTreeGuestPick'

function treeRow(itemId: string) {
  const li = document.createElement('li')
  li.setAttribute('role', 'treeitem')
  li.id = `_r_q_-${itemId}`
  const content = document.createElement('div')
  li.appendChild(content)
  document.body.appendChild(li)
  return content
}

function flatRow(key: string) {
  const row = document.createElement('div')
  row.dataset.vmkey = key
  const label = document.createElement('span')
  row.appendChild(label)
  document.body.appendChild(row)
  return label
}

const VMS = [
  { connId: 'c1', node: 'pve1', type: 'qemu', vmid: '101', name: 'web', status: 'running' },
  { connId: 'c1', node: 'pve1', type: 'lxc', vmid: '102', name: 'db', status: 'stopped' },
  { connId: 'c1', node: 'pve1', type: 'qemu', vmid: '900', name: 'tpl', status: 'stopped', template: true },
]

const click = (target: Element, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) => ({
  target, ctrlKey: !!mods.ctrlKey, metaKey: !!mods.metaKey, clientX: 40, clientY: 60,
  preventDefault: vi.fn(), stopPropagation: vi.fn(),
}) as any

describe('guestKeyFromTarget', () => {
  it('reads a flat row and a tree item, and nothing else', () => {
    expect(guestKeyFromTarget(flatRow('c1:pve1:qemu:101'))).toBe('c1:pve1:qemu:101')
    expect(guestKeyFromTarget(treeRow('vm:c1:pve-a:lxc:102'))).toBe('c1:pve-a:lxc:102')
    expect(guestKeyFromTarget(treeRow('node:c1:pve1'))).toBeNull()
    expect(guestKeyFromTarget(document.body)).toBeNull()
    expect(guestKeyFromTarget(null)).toBeNull()
  })
})

describe('togglePick and pickedRowsSx', () => {
  it('adds then removes a key, and tints both row shapes', () => {
    const once = togglePick(new Set(), 'k')
    expect([...once]).toEqual(['k'])
    expect([...togglePick(once, 'k')]).toEqual([])
    expect(Object.keys(pickedRowsSx(new Set(['c1:n:qemu:1'])))).toEqual([
      '& [data-vmkey="c1:n:qemu:1"], & [id$="-vm:c1:n:qemu:1"] > .MuiTreeItem-content',
    ])
    expect(Object.keys(pickedRowsSx(new Set(['a"b'])))[0]).toContain('a\\"b')
  })
})

describe('useTreeGuestPick', () => {
  it('picks with Ctrl or Cmd, skips templates, and a plain click drops the pick', () => {
    const { result } = renderHook(() => useTreeGuestPick(VMS, true))
    const ev = click(flatRow('c1:pve1:qemu:101'), { ctrlKey: true })

    act(() => result.current.onClickCapture(ev))
    expect(ev.stopPropagation).toHaveBeenCalled()
    act(() => result.current.onClickCapture(click(treeRow('vm:c1:pve1:lxc:102'), { metaKey: true })))
    act(() => result.current.onClickCapture(click(flatRow('c1:pve1:qemu:900'), { ctrlKey: true })))
    expect(result.current.pickedVms.map(v => [v.vmid, v.type, v.status])).toEqual([['101', 'qemu', 'running'], ['102', 'lxc', 'stopped']])
    expect(Object.keys(result.current.rowsSx)).toHaveLength(3)

    const plain = click(flatRow('c1:pve1:qemu:101'))
    act(() => result.current.onClickCapture(plain))
    expect(plain.stopPropagation).not.toHaveBeenCalled()
    expect(result.current.pickedVms).toEqual([])
  })

  it('keeps the guest open in the tree in the pick on the first Ctrl+click', () => {
    const { result } = renderHook(() => useTreeGuestPick(VMS, true, 'c1:pve1:qemu:101'))
    act(() => result.current.onClickCapture(click(treeRow('vm:c1:pve1:lxc:102'), { ctrlKey: true })))
    expect(result.current.pickedVms.map(v => v.vmid)).toEqual(['101', '102'])

    act(() => result.current.onClickCapture(click(treeRow('vm:c1:pve1:lxc:102'), { ctrlKey: true })))
    expect(result.current.pickedVms.map(v => v.vmid)).toEqual(['101'])

    const self = renderHook(() => useTreeGuestPick(VMS, true, 'c1:pve1:qemu:101'))
    act(() => self.result.current.onClickCapture(click(flatRow('c1:pve1:qemu:101'), { ctrlKey: true })))
    expect(self.result.current.pickedVms.map(v => v.vmid)).toEqual(['101'])
  })

  it('opens the power menu on a picked guest only', () => {
    const { result } = renderHook(() => useTreeGuestPick(VMS, true))
    act(() => result.current.onClickCapture(click(flatRow('c1:pve1:qemu:101'), { ctrlKey: true })))

    const other = click(flatRow('c1:pve1:lxc:102'))
    act(() => result.current.onContextMenuCapture(other))
    expect(other.preventDefault).not.toHaveBeenCalled()
    expect(result.current.menuAt).toBeNull()

    act(() => result.current.onContextMenuCapture(click(flatRow('c1:pve1:qemu:101'))))
    expect(result.current.menuAt).toEqual({ top: 60, left: 40 })
    act(() => result.current.closeMenu())
    expect(result.current.menuAt).toBeNull()

    act(() => result.current.clear())
    expect(result.current.pickedVms).toEqual([])
  })

  it('ignores clicks outside a guest row, and everything without a power right', () => {
    const { result } = renderHook(() => useTreeGuestPick(VMS, true))
    act(() => result.current.onClickCapture(click(document.body, { ctrlKey: true })))
    expect(result.current.pickedVms).toEqual([])

    const off = renderHook(() => useTreeGuestPick(VMS, false))
    const ev = click(flatRow('c1:pve1:qemu:101'), { ctrlKey: true })
    act(() => off.result.current.onClickCapture(ev))
    expect(ev.stopPropagation).not.toHaveBeenCalled()
    expect(off.result.current.pickedVms).toEqual([])
  })
})
