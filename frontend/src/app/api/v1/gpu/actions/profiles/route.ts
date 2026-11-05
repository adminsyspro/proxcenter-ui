// GET /api/v1/gpu/actions/profiles?deviceKey=<connId:node:slot>
//
// The vGPU profiles a card in SR-IOV mode can still hand out (#672): what PVE
// offers on the card's vGPU mapping, or on one of its virtual functions when
// no mapping exists yet. One PVE call, made when the attach dialog opens.
import { NextResponse } from 'next/server'

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { requireGpuActions } from '@/lib/gpu/guard'
import { gpuCode } from '@/lib/gpu/metrics'
import { loadVisibleGpuReport } from '@/lib/gpu/visibleReport'
import { pveFetch } from '@/lib/proxmox/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEVICE_KEY = /^([^:]+):[A-Za-z0-9.-]{1,63}:[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}$/i

export async function GET(req: Request) {
  const access = await requireGpuActions()
  if (access.denied) return access.denied
  const deviceKey = new URL(req.url).searchParams.get('deviceKey') ?? ''
  const m = DEVICE_KEY.exec(deviceKey)
  if (!m) return gpuCode('invalid_device', 400)
  const report = await loadVisibleGpuReport({ connId: m[1] })
  const device = report.devices.find(d => d.key === deviceKey && d.kind === 'gpu')
  if (!device) return gpuCode('device_not_found', 404)
  if (device.vgpu?.mode !== 'sriov') return gpuCode('not_vgpu_capable', 409)
  const row = await prisma.connection.findFirst({ where: { id: device.connId, type: 'pve' }, select: { id: true, tenantId: true } })
  if (!row) return gpuCode('device_not_found', 404)

  // PVE starts a vGPU on the first free virtual function: the last one is the
  // likeliest free when the card has no mapping yet.
  const source = device.vgpuMappings?.[0] ?? device.vgpu.virtualFunctions.at(-1)
  if (!source) return gpuCode('not_vgpu_capable', 409)
  try {
    const conn = await getConnectionById(row.id, row.tenantId)
    const types = (await pveFetch<Array<{ type?: string; name?: string; available?: number }>>(
      conn,
      `/nodes/${encodeURIComponent(device.node)}/hardware/pci/${encodeURIComponent(source)}/mdev`,
    )) ?? []
    const data = types
      .filter(t => typeof t.type === 'string' && /^nvidia-\d{1,5}$/.test(t.type))
      .map(t => ({ type: t.type as string, name: String(t.name ?? t.type).replace(/^NVIDIA /, ''), available: Number(t.available) || 0 }))
    return NextResponse.json({ data })
  } catch (e: any) {
    console.error('[gpu-actions] vGPU profiles:', e?.message)
    return gpuCode('pve_unreachable', 502)
  }
}
