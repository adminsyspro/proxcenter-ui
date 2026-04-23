import { NextResponse } from "next/server"

import { orchestratorFetch } from "@/lib/orchestrator"
import { getSessionPrisma } from "@/lib/tenant"
import { executeSSH } from "@/lib/ssh/exec"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// POST /api/v1/orchestrator/sflow/portmap
// Refreshes the sFlow port map by executing `ovs-ofctl show` on PVE nodes via SSH
export async function POST() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()

    const connections = await prisma.connection.findMany({
      where: { type: "pve", sshEnabled: true },
      include: { hosts: true },
    })

    let totalMapped = 0

    for (const conn of connections) {
      if (!conn.sshKeyEnc && !conn.sshPassEnc) continue

      for (const host of conn.hosts) {
        if (!host.enabled || !host.ip) continue

        try {
          // List OVS bridges
          const bridgesResult = await executeSSH(
            conn.id,
            host.ip,
            "ovs-vsctl list-br 2>/dev/null"
          )

          if (!bridgesResult.success || !bridgesResult.output) continue

          // Use ip -o link to get SNMP ifIndex (matches sFlow ifIndex)
          // ovs-ofctl ofport numbers do NOT match sFlow ifIndex
          const ipLinkResult = await executeSSH(
            conn.id,
            host.ip,
            "ip -o link 2>/dev/null"
          )

          if (!ipLinkResult.success || !ipLinkResult.output) continue

          // Send to Go backend
          try {
            const result = await orchestratorFetch("/sflow/portmap", {
              method: "POST",
              body: {
                agent_ip: host.ip,
                ip_link_output: ipLinkResult.output,
              },
            }) as any

            totalMapped += result?.vm_ports_mapped || 0
          } catch {
            // Non-critical
          }
        } catch {
          // Skip host on SSH error
          continue
        }
      }
    }

    return NextResponse.json({ success: true, vm_ports_mapped: totalMapped })
  } catch (error: any) {
    console.error("Failed to refresh sFlow port map:", String(error?.message || "").replace(/[\r\n]/g, ""))
    return NextResponse.json(
      { error: error.message || "Failed to refresh port map" },
      { status: 500 }
    )
  }
}
