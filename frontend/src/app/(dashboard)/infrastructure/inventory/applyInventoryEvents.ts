// Applies one poll cycle of live inventory deltas (the `batch` message of
// /api/v1/inventory/events) to the tree state in a single pass.
//
// The SSE handler used to apply each delta on its own, and every one of them
// walked every cluster, node and guest: a cycle of U deltas cost O(U x G) and
// blocked the main thread for over a second on a few hundred nodes. Here the
// deltas are indexed per connection first, then each guest is visited once,
// O(G + U). The result keeps the structural sharing the tree relies on: the
// same `clusters` reference comes back when nothing changed, and only the
// objects along a changed path are new.

import type { InventoryEvent } from '@/lib/cache/inventoryPoller'

import type { TreeCluster } from './InventoryTree'

type TreeNode = TreeCluster['nodes'][number]
type TreeGuest = TreeNode['vms'][number]

type VmUpdate = Extract<InventoryEvent, { event: 'vm:update' }>
type NodeUpdate = Extract<InventoryEvent, { event: 'node:update' }>
type VmAdded = Extract<InventoryEvent, { event: 'vm:added' }>

/** The deltas of one connection, each kind in its arrival order. */
type ConnectionDeltas = {
  removed: Set<string>
  addedByNode: Map<string, VmAdded[]>
  vmUpdates: Map<string, VmUpdate[]>
  nodeUpdates: Map<string, NodeUpdate[]>
}

const guestKey = (type: string, vmid: string | number) => `${type}/${String(vmid)}`

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Removals are collected before additions: the poller emits a remove+add pair
 * when a guest relocates between nodes, and the pair must land in that order
 * whatever its position in the batch. Updates apply to the resulting state.
 */
function indexByConnection(events: readonly InventoryEvent[]): Map<string, ConnectionDeltas> {
  const byConn = new Map<string, ConnectionDeltas>()
  const deltasOf = (connId: string) => {
    let d = byConn.get(connId)
    if (!d) {
      d = { removed: new Set(), addedByNode: new Map(), vmUpdates: new Map(), nodeUpdates: new Map() }
      byConn.set(connId, d)
    }
    return d
  }

  for (const ev of events) {
    if (!ev || typeof ev.connId !== 'string') continue
    switch (ev.event) {
      case 'vm:removed':
        deltasOf(ev.connId).removed.add(guestKey(ev.type, ev.vmid))
        break
      case 'vm:added':
        pushTo(deltasOf(ev.connId).addedByNode, ev.node, ev)
        break
      case 'vm:update':
        pushTo(deltasOf(ev.connId).vmUpdates, guestKey(ev.type, ev.vmid), ev)
        break
      case 'node:update':
        pushTo(deltasOf(ev.connId).nodeUpdates, ev.node, ev)
        break
      default:
        break
    }
  }
  return byConn
}

/** A guest with one vm:update merged in, or the same object when nothing differs. */
function updateGuest(vm: TreeGuest, d: VmUpdate): TreeGuest {
  const newStatus = d.status
  const newCpu = d.cpu ?? vm.cpu
  const newMem = d.mem ?? vm.mem
  const newMaxmem = d.maxmem ?? vm.maxmem
  const newDisk = d.disk ?? vm.disk
  const newMaxdisk = d.maxdisk ?? vm.maxdisk
  const newName = d.name ?? vm.name
  if (vm.status === newStatus && vm.cpu === newCpu && vm.mem === newMem &&
      vm.maxmem === newMaxmem && vm.disk === newDisk && vm.maxdisk === newMaxdisk &&
      vm.name === newName) return vm
  return { ...vm, status: newStatus, cpu: newCpu, mem: newMem, maxmem: newMaxmem, disk: newDisk, maxdisk: newMaxdisk, name: newName }
}

/** The guest a vm:added creates, with the defaults the tree expects. */
function newGuest(d: VmAdded): TreeGuest {
  return {
    type: d.type,
    vmid: String(d.vmid),
    name: d.name || `${d.type}/${d.vmid}`,
    status: d.status || 'unknown',
    cpu: d.cpu,
    mem: d.mem,
    maxmem: d.maxmem,
    pool: null,
    tags: null,
    template: false,
  }
}

const byNumericVmid = (a: TreeGuest, b: TreeGuest) => Number.parseInt(a.vmid, 10) - Number.parseInt(b.vmid, 10)

/** The node's guest list after the connection's deltas, or the same array when nothing changed. */
function applyGuestDeltas(node: TreeNode, deltas: ConnectionDeltas): TreeGuest[] {
  let vms = node.vms

  // Removals: a vm:removed takes the guest off whichever node holds it.
  if (deltas.removed.size > 0) {
    const kept = vms.filter(vm => !deltas.removed.has(guestKey(vm.type, vm.vmid)))
    if (kept.length !== vms.length) vms = kept
  }

  // Additions: appended to the named node unless already there, then kept in
  // vmid order like the rest of the list.
  const added = deltas.addedByNode.get(node.node)
  if (added) {
    const present = new Set(vms.map(vm => guestKey(vm.type, vm.vmid)))
    let appended = false
    for (const d of added) {
      const key = guestKey(d.type, d.vmid)
      if (present.has(key)) continue
      present.add(key)
      if (!appended) {
        vms = vms.slice()
        appended = true
      }
      vms.push(newGuest(d))
    }
    if (appended) vms.sort(byNumericVmid)
  }

  // Updates, on the list as it stands after removals and additions.
  if (deltas.vmUpdates.size > 0) {
    let copied = vms !== node.vms
    for (let i = 0; i < vms.length; i++) {
      const updates = deltas.vmUpdates.get(guestKey(vms[i].type, vms[i].vmid))
      if (!updates) continue
      let vm = vms[i]
      for (const d of updates) vm = updateGuest(vm, d)
      if (vm === vms[i]) continue
      if (!copied) {
        vms = vms.slice()
        copied = true
      }
      vms[i] = vm
    }
  }

  return vms
}

/** The node after the connection's deltas, or the same object when nothing changed. */
function applyNodeDeltas(node: TreeNode, deltas: ConnectionDeltas): TreeNode {
  const vms = applyGuestDeltas(node, deltas)

  let status = node.status
  let cpu = node.cpu
  let mem = node.mem
  let maxmem = node.maxmem
  const updates = deltas.nodeUpdates.get(node.node)
  if (updates) {
    for (const d of updates) {
      status = d.status ?? status
      cpu = d.cpu ?? cpu
      mem = d.mem ?? mem
      maxmem = d.maxmem ?? maxmem
    }
  }
  const fieldsChanged = status !== node.status || cpu !== node.cpu || mem !== node.mem || maxmem !== node.maxmem

  if (vms === node.vms && !fieldsChanged) return node
  if (!fieldsChanged) return { ...node, vms }
  return { ...node, status, cpu, mem, maxmem, vms }
}

/**
 * The tree state after one batch of live deltas. Returns `clusters` itself
 * when the batch changes nothing, otherwise a new array whose untouched
 * clusters, nodes and guests are the same objects as before.
 */
export function applyInventoryEvents(clusters: TreeCluster[], events: readonly InventoryEvent[]): TreeCluster[] {
  if (events.length === 0 || clusters.length === 0) return clusters

  const byConn = indexByConnection(events)
  if (byConn.size === 0) return clusters

  let anyClusterChanged = false
  const next = clusters.map(clu => {
    const deltas = byConn.get(clu.connId)
    if (!deltas) return clu
    let nodeChanged = false
    const nodes = clu.nodes.map(n => {
      const updated = applyNodeDeltas(n, deltas)
      if (updated !== n) nodeChanged = true
      return updated
    })
    if (!nodeChanged) return clu
    anyClusterChanged = true
    return { ...clu, nodes }
  })
  return anyClusterChanged ? next : clusters
}
