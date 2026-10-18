// The VMkernel adapters of the host a VMware VM runs on (roadmap#53), read by
// the server from the source connection. Shared by the copy-interfaces route
// (the dialog's list) and the migration preflight, which probes the address of
// the adapter the operator picked: the address always comes from vSphere,
// never from the browser, so the node is never asked to probe an arbitrary host.

import { decryptSecret } from "@/lib/crypto/secret"
import { soapLogin, soapLogout } from "@/lib/vmware/soap"
import { soapGetVmCopyInterfaces, type HostVmkernelNic } from "@/lib/vmware/vmkernel"

export interface VmCopyInterfaces {
  hostName: string
  source: "vcenter" | "esxi"
  defaultDevice?: string
  vnics: HostVmkernelNic[]
}

export class CopyInterfacesNotFound extends Error {}

type ConnectionReader = {
  connection: { findUnique: (args: any) => Promise<{ id: string; baseUrl: string; apiTokenEnc: string; insecureTLS: boolean; type: string } | null> }
}

export async function readVmCopyInterfaces(prisma: ConnectionReader, connectionId: string, vmid: string): Promise<VmCopyInterfaces> {
  const conn = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { id: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
  })
  if (!conn || conn.type !== "vmware") throw new CopyInterfacesNotFound("VMware connection not found")
  const creds = decryptSecret(conn.apiTokenEnc)
  const colonIdx = creds.indexOf(":")
  const username = colonIdx > 0 ? creds.substring(0, colonIdx) : "root"
  const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
  const session = await soapLogin(conn.baseUrl.replace(/\/$/, ""), username, password, conn.insecureTLS)
  try {
    const ifaces = await soapGetVmCopyInterfaces(session, vmid, new URL(conn.baseUrl).hostname)
    return { hostName: ifaces.hostName, source: session.isVcenter ? "vcenter" : "esxi", defaultDevice: ifaces.defaultDevice, vnics: ifaces.vnics }
  } finally {
    await soapLogout(session).catch(() => {})
  }
}
