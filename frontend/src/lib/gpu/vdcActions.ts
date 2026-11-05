// Tenant side of a vDC GPU contingent (#672): the tenant takes a GPU of its
// contingent for one of its VMs, or gives one back. The server picks the card
// on the VM's node and writes with the provider's token; the answer never
// names a node, a card or a mapping, and a PVE failure reaches the tenant as
// pve_refused only.
import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import { nextHostpciIndex } from '@/lib/gpu/actions'
import { readVmConfig, readVmPending, removeGpu, writeGpu } from '@/lib/gpu/attach'
import { gpuCode } from '@/lib/gpu/metrics'
import { loadVdcConnection, loadVdcGpuContext, readPoolQemu, type PoolVm, type VdcGpuContext, type VdcRef } from '@/lib/gpu/vdcContext'
import { fullyRead, scannedNodes } from '@/lib/gpu/vdcGuard'
import { withConnGpuLock, withVdcLock } from '@/lib/gpu/vdcLock'
import { rankPlacements } from '@/lib/gpu/vdcPlacement'
import type { GpuEntryKind } from '@/lib/gpu/vdcQuota'
import { PERMISSIONS, buildVmResourceId, checkPermission } from '@/lib/rbac'

const VMID = /^\d{1,9}$/
const HOSTPCI = /^hostpci(\d|1[0-5])$/
const ENTRY_ID = /^[A-Za-z0-9_-]{1,64}$/

export type VdcGpuAction =
  | { action: 'attach'; vmid: string; entryId: string }
  | { action: 'release'; vmid: string; hostpci: string }

export function parseVdcGpuAction(raw: unknown): VdcGpuAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const vmid = typeof r.vmid === 'string' || typeof r.vmid === 'number' ? String(r.vmid) : ''
  if (!VMID.test(vmid)) return null
  if (r.action === 'attach' && typeof r.entryId === 'string' && ENTRY_ID.test(r.entryId)) {
    return { action: 'attach', vmid, entryId: r.entryId }
  }
  if (r.action === 'release' && typeof r.hostpci === 'string' && HOSTPCI.test(r.hostpci)) {
    return { action: 'release', vmid, hostpci: r.hostpci }
  }
  return null
}

const pveRefused = () => gpuCode('pve_refused', 502)

/**
 * The VM of the vDC pool (qemu, not a template) the caller may change the
 * hardware of: one pool read with the provider's token, which gives its node.
 */
async function resolveVm(vdc: VdcRef, vmid: string): Promise<PoolVm | Response> {
  let vm: PoolVm | undefined
  try {
    const { conn } = await loadVdcConnection(vdc)
    vm = (await readPoolQemu(conn, vdc.pvePoolName)).find((v) => v.vmid === vmid)
  } catch (e: any) {
    console.error('[vdc-gpu] pool unreadable:', e?.message)
    return pveRefused()
  }
  if (!vm?.node) return gpuCode('vm_not_found', 404)
  const denied = await checkPermission(PERMISSIONS.VM_CONFIG_HARDWARE, 'vm', buildVmResourceId(vdc.connectionId, vm.node, 'qemu', vmid))
  return denied ?? vm
}

/** The GPU context read again, past the shared cache. */
async function freshContext(vdc: VdcRef): Promise<VdcGpuContext | Response> {
  try {
    return await loadVdcGpuContext(vdc, { refresh: true })
  } catch (e: any) {
    console.error('[vdc-gpu] GPU snapshot unreadable:', e?.message)
    return pveRefused()
  }
}

async function auditGpu(action: 'create' | 'delete', vdc: VdcRef, vmid: string, hostpci: string, kind: GpuEntryKind, profile: string | null) {
  try {
    await audit({
      action,
      category: 'vms',
      resourceType: 'gpu',
      resourceId: vmid,
      status: 'success',
      details: { vdcId: vdc.id, vmid, hostpci, kind, profileName: profile || null },
    })
  } catch (e: any) {
    console.error('[vdc-gpu] audit row not written:', e?.message)
  }
}

async function attach(vdc: VdcRef, vmid: string, entryId: string): Promise<Response> {
  const vm = await resolveVm(vdc, vmid)
  if (vm instanceof Response) return vm
  // Other vDCs of the connection and the provider contest the same cards.
  return withConnGpuLock(vdc.connectionId, () => placeAndWrite(vdc, vm, entryId))
}

async function placeAndWrite(vdc: VdcRef, vm: PoolVm, entryId: string): Promise<Response> {
  const ctx = await freshContext(vdc)
  if (ctx instanceof Response) return ctx
  const vmid = vm.vmid

  const entry = ctx.entries.find((e) => e.id === entryId)
  if (!entry) return gpuCode('entry_not_found', 404)
  // A pool vGPU of that model whose profile is unknown this round counts on
  // no line: the use of every vGPU line of the model is a floor only.
  if (entry.kind === 'vgpu' && ctx.unresolvedVgpuModels.has(entry.modelKey)) return gpuCode('gpu_check_unavailable', 503)
  // Usage counts what clones and restores in flight are about to bring.
  const used = ctx.usage.get(entry.id) ?? 0
  if (used >= entry.count) return NextResponse.json({ error: 'quota_exhausted', used, count: entry.count }, { status: 409 })
  // Anything the snapshot missed may be a GPU held by the pool or a card taken.
  if (!fullyRead(ctx.snapshot) || !scannedNodes(ctx.snapshot).has(vm.node)) return gpuCode('no_room_here', 409)

  const config = await readVmConfig(ctx.conn, vm.node, vmid)
  if (!config) return pveRefused()
  if (nextHostpciIndex(config) < 0) return gpuCode('no_free_slot', 409)

  for (const { device, profile } of rankPlacements(ctx.report, ctx.catalog, entry, vm.node)) {
    const fits = entry.kind === 'vgpu' ? device.vgpu?.mode === 'sriov' && !!profile : profile === null
    if (!fits) continue
    // No permission hook: the server creates a missing mapping for the provider.
    const written = await writeGpu(ctx.conn, device, vmid, config, { profile })
    if ('denied' in written) return pveRefused()
    if (written.ok === false) {
      if (written.code === 'profile_unavailable') continue
      return written.code === 'no_free_slot' ? gpuCode('no_free_slot', 409) : pveRefused()
    }
    await auditGpu('create', vdc, vmid, written.hostpci, entry.kind, entry.profileName)
    return NextResponse.json({ data: { hostpci: written.hostpci, pendingStart: written.pending } })
  }
  return gpuCode('no_room_here', 409)
}

/**
 * A release only lowers the use: it needs the VM's node and the mappings
 * read, not the rest of the cluster.
 */
async function release(vdc: VdcRef, vmid: string, hostpci: string): Promise<Response> {
  const vm = await resolveVm(vdc, vmid)
  if (vm instanceof Response) return vm
  const ctx = await freshContext(vdc)
  if (ctx instanceof Response) return ctx
  const snap = ctx.snapshot
  if (snap.error !== null || snap.mappingsError !== null || !scannedNodes(snap).has(vm.node)) return pveRefused()

  const gpu = ctx.gpus.find((g) => g.vmid === vmid && g.node === vm.node && g.hostpci === hostpci)
  // Unread guest configs may be where that GPU is.
  if (!gpu) return snap.guestsError ? pveRefused() : gpuCode('vm_not_found', 404)
  const view = await readVmPending(ctx.conn, vm.node, vmid)
  if (!view) return pveRefused()
  // Its removal is already pending: the VM keeps it until it stops.
  if (view.pendingDelete.has(hostpci)) return NextResponse.json({ data: { hostpci, pendingStart: true } })
  if (view.config[hostpci] === undefined) return gpuCode('vm_not_found', 404)

  const removed = await removeGpu(ctx.conn, vm.node, vmid, hostpci, view.config)
  if (removed.ok === false) return removed.code === 'contact_provider' ? gpuCode('contact_provider', 409) : pveRefused()
  await auditGpu('delete', vdc, vmid, hostpci, gpu.kind, gpu.profileName)
  return NextResponse.json({ data: { hostpci, pendingStart: removed.pending } })
}

/**
 * One attach or release at a time per vDC, each on a snapshot read inside the
 * lock; an attach also holds the connection's card lock.
 */
export function runVdcGpuAction(vdc: VdcRef, body: VdcGpuAction): Promise<Response> {
  return withVdcLock(vdc.id, () => (body.action === 'attach' ? attach(vdc, body.vmid, body.entryId) : release(vdc, body.vmid, body.hostpci)))
}
