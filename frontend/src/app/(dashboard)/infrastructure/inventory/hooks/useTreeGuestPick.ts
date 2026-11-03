import { useMemo, useState, type MouseEvent } from 'react'

import type { SelectableVm } from '@/components/GuestSelection'
import { guestKeyFromTarget, pickedRowsSx, togglePick } from '@/lib/inventory/treeGuestPick'

type TreeGuest = { connId: string; node: string; type: string; vmid: string; name?: string; status?: string; template?: boolean }

// roadmap#197: Ctrl/Cmd+click picks guests, in the tree and the flat lists,
// for a power action (strip above the list, or a right click on a picked
// guest). A plain click on a guest drops the pick and selects as before.
// As in a file manager, the first Ctrl/Cmd+click keeps the guest already open
// in the tree (`anchorKey`) in the pick, next to the one clicked.
// The handlers go on the scrolling box as capture handlers, so a pick never
// reaches the tree's own selection.
export function useTreeGuestPick(allVms: ReadonlyArray<TreeGuest>, enabled: boolean, anchorKey?: string | null) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null)

  const pickedVms = useMemo<SelectableVm[]>(() => {
    if (picked.size === 0) return []

    return allVms
      .map(vm => ({ vm, id: `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}` }))
      .filter(({ vm, id }) => picked.has(id) && !vm.template)
      .map(({ vm, id }) => ({ id, connId: vm.connId, vmid: vm.vmid, node: vm.node, type: vm.type as 'qemu' | 'lxc', status: vm.status, name: vm.name }))
  }, [allVms, picked])

  const onClickCapture = (e: MouseEvent) => {
    if (!enabled) return
    const key = guestKeyFromTarget(e.target)

    if (!key) return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      setPicked(prev => togglePick(prev.size === 0 && anchorKey && anchorKey !== key ? new Set([anchorKey]) : prev, key))
    } else if (picked.size > 0) {
      setPicked(new Set())
    }
  }

  const onContextMenuCapture = (e: MouseEvent) => {
    const key = guestKeyFromTarget(e.target)

    if (!key || !picked.has(key) || pickedVms.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setMenuAt({ top: e.clientY, left: e.clientX })
  }

  return {
    pickedVms,
    menuAt,
    closeMenu: () => setMenuAt(null),
    clear: () => setPicked(new Set()),
    onClickCapture,
    onContextMenuCapture,
    rowsSx: pickedRowsSx(picked),
  }
}
