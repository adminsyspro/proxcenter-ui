import { pveFetch } from "@/lib/proxmox/client"

import { reserveVmid } from "./vmid-reservation"

/**
 * A VMID on the target cluster for migration job `jobId` that no other job of
 * this server holds (roadmap#53); released by `releaseVmids` when the job ends.
 */
export function reserveTargetVmid(pveConn: any, targetConnectionId: string, jobId: string): Promise<number> {
  return reserveVmid(targetConnectionId, jobId, from =>
    pveFetch<number | string>(pveConn, from === undefined ? "/cluster/nextid" : `/cluster/nextid?vmid=${from}`).then(Number))
}
