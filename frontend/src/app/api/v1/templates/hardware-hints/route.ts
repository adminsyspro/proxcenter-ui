// src/app/api/v1/templates/hardware-hints/route.ts
//
// GET /api/v1/templates/hardware-hints?imageSlug=<slug>&connectionId=<id>
//
// Firmware, machine, TPM, disk bus and display of the VM template a volume
// image was taken from (#181), so the deploy wizard starts from the settings
// the image actually boots with. Only these hardware fields leave the route:
// a tenant deploying a provider image never sees the template's name, node or
// disks. `data` is null when the image is not a volume taken from a guest.

import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { safeLog } from "@/lib/log/sanitize"
import { pveFetch } from "@/lib/proxmox/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { findCustomImageForTenant } from "@/lib/templates/customImageScope"
import { hintsFromGuestConfig, vmidFromVolumeId } from "@/lib/templates/deployHardware"
import { imageSourceForConnection } from "@/lib/templates/sourceVolume"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const imageSlug = searchParams.get("imageSlug")
    const connectionId = searchParams.get("connectionId")
    if (!imageSlug || !connectionId) {
      return NextResponse.json({ error: "imageSlug and connectionId are required" }, { status: 400 })
    }

    const tenantId = await getCurrentTenantId()
    const row = await findCustomImageForTenant(tenantId, imageSlug)
    if (!row || row.sourceType !== "volume") return NextResponse.json({ data: null })

    // The copy held by the target cluster, as the deploy route picks it.
    const source = imageSourceForConnection(row, connectionId)
    const volumeId = source?.volumeId
    const vmid = vmidFromVolumeId(volumeId)
    if (!source?.sourceConnectionId || !volumeId || vmid === null) return NextResponse.json({ data: null })

    const conn = await getConnectionById(source.sourceConnectionId)
    const resources = await pveFetch<any[]>(conn, "/cluster/resources?type=vm")
    const owner = (resources || []).find(r => Number(r?.vmid) === vmid && r?.type === "qemu")
    if (!owner?.node) return NextResponse.json({ data: null })

    const config = await pveFetch<Record<string, unknown>>(
      conn,
      `/nodes/${encodeURIComponent(owner.node)}/qemu/${vmid}/config`,
    )
    return NextResponse.json({ data: hintsFromGuestConfig(config, volumeId) })
  } catch (e: any) {
    // Hints are a convenience: the wizard keeps its defaults on any failure.
    // The PVE message can name provider nodes, so it stays in the server log.
    console.error(`[hardware-hints] ${safeLog(e?.message ?? e)}`)
    return NextResponse.json({ data: null })
  }
}
