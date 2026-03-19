import { NextResponse } from "next/server"

import { orchestratorFetch } from "@/lib/orchestrator"
import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"

export const runtime = "nodejs"

// POST /api/v1/orchestrator/sflow/portmap
// Refreshes the sFlow port map by executing `ovs-ofctl show` on PVE nodes via SSH
// and sending the output to the Go backend.
export async function POST() {
  try {
    const prisma = await getSessionPrisma()

    // Get all PVE connections with SSH enabled
    const connections = await prisma.connection.findMany({
      where: { type: "pve", sshEnabled: true },
      include: { hosts: true },
    })

    let totalMapped = 0

    for (const conn of connections) {
      if (!conn.sshKeyEnc && !conn.sshPassEnc) continue

      const sshKey = conn.sshKeyEnc ? decryptSecret(conn.sshKeyEnc) : undefined
      const sshPass = conn.sshPassEnc ? decryptSecret(conn.sshPassEnc) : undefined

      for (const host of conn.hosts) {
        if (!host.enabled || !host.ip) continue

        try {
          // Execute ovs-vsctl list-br to get bridges
          const bridgesRes = await fetch(`${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/v1/ssh/exec`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              host: host.ip,
              port: conn.sshPort || 22,
              user: conn.sshUser || "root",
              ...(conn.sshAuthMethod === "key" ? { key: sshKey } : { password: sshPass }),
              command: "ovs-vsctl list-br 2>/dev/null",
            }),
          })

          if (!bridgesRes.ok) continue
          const bridgesJson = await bridgesRes.json()
          if (!bridgesJson.success || !bridgesJson.output) continue

          const bridges = bridgesJson.output.trim().split("\n").filter(Boolean)

          for (const bridge of bridges) {
            // Execute ovs-ofctl show for each bridge
            const ovsRes = await fetch(`${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/v1/ssh/exec`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                host: host.ip,
                port: conn.sshPort || 22,
                user: conn.sshUser || "root",
                ...(conn.sshAuthMethod === "key" ? { key: sshKey } : { password: sshPass }),
                command: `ovs-ofctl show ${bridge.trim()} 2>/dev/null`,
              }),
            })

            if (!ovsRes.ok) continue
            const ovsJson = await ovsRes.json()
            if (!ovsJson.success || !ovsJson.output) continue

            // Send to Go backend
            const result = await orchestratorFetch("/sflow/portmap", {
              method: "POST",
              body: {
                agent_ip: host.ip,
                ovs_output: ovsJson.output,
              },
            }) as any

            totalMapped += result?.vm_ports_mapped || 0
          }
        } catch (e) {
          // Skip this host on error
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
