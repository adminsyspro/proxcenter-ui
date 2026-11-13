// POST /api/v1/gpu/actions
//   { action: 'attach',  deviceKey, vmid, profile? }    attach a GPU, or a vGPU of a card
//                                                       in SR-IOV mode (profile nvidia-NNN)
//   { action: 'release', connId, node, vmid, hostpci }  remove a GPU from a VM
//
// GPU page actions (#672, lot C), provider tenant, gpu_management. Both act
// through resource mappings only: PVE refuses a raw-address hostpciN to any
// API token (lib/gpu/actions.ts). Attaching creates a mapping for the card
// when none covers it (node.manage on the node), then writes the next free
// hostpciN (vm.config.hardware on the VM). Releasing removes a mapped
// hostpciN; a raw one answers raw_passthrough with the root command. On a
// running VM both changes wait for the next start (PVE pending changes).
import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { VGPU_PROFILE, nextHostpciIndex, rawReleaseCommand } from '@/lib/gpu/actions'
import { readVmConfig, readVmPending, removeGpu, writeGpu } from '@/lib/gpu/attach'
import { requireGpuActions } from '@/lib/gpu/guard'
import { gpuCode } from '@/lib/gpu/metrics'
import { demandUncheckable, vdcContingentForVm } from '@/lib/gpu/vdcGuard'
import { withConnGpuLock } from '@/lib/gpu/vdcLock'
import { checkDemand, modelKeyOf, type GpuDemand } from '@/lib/gpu/vdcQuota'
import { profileName } from '@/lib/gpu/vgpu'
import { loadVisibleGpuReport } from '@/lib/gpu/visibleReport'
import { pveFetch } from '@/lib/proxmox/client'
import { PERMISSIONS, buildNodeResourceId, buildVmResourceId, checkPermission } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VMID = /^\d{1,9}$/
const HOSTPCI = /^hostpci(\d|1[0-5])$/
const NODE = /^[A-Za-z0-9.-]{1,63}$/

type Body =
  | { action: 'attach'; deviceKey: string; vmid: string; profile: string | null }
  | { action: 'release'; connId: string; node: string; vmid: string; hostpci: string }

function parse(raw: any): Body | null {
  const vmid = String(raw?.vmid ?? '')
  if (!VMID.test(vmid)) return null
  if (raw?.action === 'attach' && typeof raw.deviceKey === 'string' && raw.deviceKey.length < 200) {
    if (raw.profile !== undefined && raw.profile !== null && !(typeof raw.profile === 'string' && VGPU_PROFILE.test(raw.profile))) return null
    return { action: 'attach', deviceKey: raw.deviceKey, vmid, profile: raw.profile ?? null }
  }
  if (raw?.action === 'release' && typeof raw.connId === 'string' && NODE.test(String(raw.node ?? '')) && HOSTPCI.test(String(raw.hostpci ?? ''))) {
    return { action: 'release', connId: raw.connId, node: raw.node, vmid, hostpci: raw.hostpci }
  }
  return null
}

async function connectionFor(connId: string) {
  const row = await prisma.connection.findFirst({ where: { id: connId, type: 'pve' }, select: { id: true, tenantId: true } })
  return row ? getConnectionById(row.id, row.tenantId) : null
}

/** The resource pool of the VM, null when it is in none or the cluster cannot say. */
async function vmPool(conn: Awaited<ReturnType<typeof getConnectionById>>, vmid: string): Promise<string | null> {
  try {
    const resources = (await pveFetch<any[]>(conn, '/cluster/resources?type=vm')) || []
    return resources.find(r => String(r?.vmid) === vmid)?.pool ?? null
  } catch {
    return null
  }
}

/** vDC tenants of the connection contest the same cards: one attach at a time per connection. */
async function attach(body: Extract<Body, { action: 'attach' }>) {
  const connId = body.deviceKey.split(':')[0]
  return withConnGpuLock(connId, () => attachLocked(connId, body))
}

async function attachLocked(connId: string, body: Extract<Body, { action: 'attach' }>) {
  const report = await loadVisibleGpuReport({ connId, refresh: true })
  const device = report.devices.find(d => d.key === body.deviceKey && d.kind === 'gpu')
  if (!device) return gpuCode('device_not_found', 404)

  const denied = await checkPermission(PERMISSIONS.VM_CONFIG_HARDWARE, 'vm', buildVmResourceId(connId, device.node, 'qemu', body.vmid))
  if (denied) return denied
  if (report.allocations.some(a => a.deviceKey === device.key && a.vmid === body.vmid)) return gpuCode('already_attached', 409)
  // A card shared out as vGPUs is handed out by profile, never whole; a
  // profile on a card that has none is refused too.
  const sriov = device.vgpu?.mode === 'sriov'
  if (sriov && !body.profile) return gpuCode('profile_required', 400)
  if (!sriov && body.profile) return gpuCode('not_vgpu_capable', 409)

  const conn = await connectionFor(connId)
  if (!conn) return gpuCode('device_not_found', 404)
  const config = await readVmConfig(conn, device.node, body.vmid)
  if (!config) return gpuCode('vm_not_on_node', 409)
  if (config.template === 1 || config.template === '1') return gpuCode('vm_is_template', 409)
  const index = nextHostpciIndex(config)
  if (index < 0) return gpuCode('no_free_slot', 409)

  // vDC GPU contingent: the VM's pool names its vDC; the GPU draws on the
  // line of its card model, and of its profile for a vGPU. The collection
  // was read again above, inside the connection lock: no second rebuild. A
  // vGPU whose line cannot be judged (profile unknown this round) is refused.
  const contingent = await vdcContingentForVm(connId, await vmPool(conn, body.vmid), { refresh: false })
  if (contingent) {
    const demand: GpuDemand[] = [{
      kind: body.profile ? 'vgpu' : 'whole',
      modelKey: modelKeyOf(device),
      profileName: body.profile ? profileName(body.profile, device.key, contingent.catalog) : null,
    }]
    if (demandUncheckable(demand, contingent.unresolvedVgpuModels)) return gpuCode('gpu_check_unavailable', 503)
    const verdict = checkDemand(contingent.entries, contingent.usage, demand)
    if (verdict.ok === false) {
      // The line the demand drew on, or the one it asked for when none matches.
      const entry = contingent.entries.find(e => e.id === verdict.entryId)
      const line = {
        kind: entry?.kind ?? demand[0].kind,
        modelName: entry?.modelName ?? device.deviceName ?? '',
        profileName: (entry?.profileName ?? demand[0].profileName) || '',
      }
      return NextResponse.json({ error: 'quota_exceeded', used: verdict.used, count: verdict.count, line }, { status: 409 })
    }
  }

  const written = await writeGpu(conn, device, body.vmid, config, {
    profile: body.profile,
    beforeMappingCreate: () => checkPermission(PERMISSIONS.NODE_MANAGE, 'node', buildNodeResourceId(connId, device.node)),
  })
  if ('denied' in written) return written.denied
  if (written.ok === false) return gpuCode(written.code, written.status)
  const { hostpci, mappingId, mappingCreated, pending } = written
  return NextResponse.json({
    data: { hostpci, mapping: mappingId, mappingCreated, ...(body.profile ? { profile: body.profile } : {}), pending },
  })
}

async function release(body: Extract<Body, { action: 'release' }>) {
  const denied = await checkPermission(PERMISSIONS.VM_CONFIG_HARDWARE, 'vm', buildVmResourceId(body.connId, body.node, 'qemu', body.vmid))
  if (denied) return denied
  const report = await loadVisibleGpuReport({ connId: body.connId })
  if (!report.allocations.some(a => a.vmid === body.vmid && a.node === body.node && a.hostpci === body.hostpci && a.kind === 'gpu')) {
    return gpuCode('allocation_not_found', 404)
  }
  const conn = await connectionFor(body.connId)
  if (!conn) return gpuCode('allocation_not_found', 404)
  const view = await readVmPending(conn, body.node, body.vmid)
  // Its removal is already pending: the VM keeps it until it stops.
  if (view?.pendingDelete.has(body.hostpci)) return NextResponse.json({ data: { hostpci: body.hostpci, pending: true } })
  if (!view || view.config[body.hostpci] === undefined) return gpuCode('allocation_not_found', 404)
  const removed = await removeGpu(conn, body.node, body.vmid, body.hostpci, view.config)
  if (removed.ok === false) {
    if (removed.code === 'contact_provider') {
      return NextResponse.json({ error: 'raw_passthrough', command: rawReleaseCommand(body.vmid, body.hostpci) }, { status: 409 })
    }
    return gpuCode(removed.code, removed.status)
  }
  return NextResponse.json({ data: { hostpci: body.hostpci, pending: removed.pending } })
}

async function handlePost(req: Request) {
  const access = await requireGpuActions()
  if (access.denied) return access.denied
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return gpuCode('invalid_body', 400)
  }
  const body = parse(raw)
  if (!body) return gpuCode('invalid_body', 400)
  return body.action === 'attach' ? attach(body) : release(body)
}

export const POST = withAudit({ category: 'vms', resourceType: 'gpu' }, handlePost)
