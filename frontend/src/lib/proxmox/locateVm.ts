import { pveFetch, type ProxmoxClientOptions } from "@/lib/proxmox/client"

export type GuestType = "qemu" | "lxc"

export interface LocatedVm {
  node: string
  status?: string
  name?: string
}

/**
 * Find the node that currently hosts a VM/CT in a PVE cluster by querying
 * the cluster-wide resource list. Used as a fallback when callers hold a
 * stale node reference (e.g. after a successful intra-cluster migration:
 * PVE removes the source .conf so /nodes/<old-node>/qemu/<vmid>/... starts
 * returning 500 "Configuration file does not exist").
 *
 * Returns null if the VM is not found or if the cluster query fails.
 * Callers must cope with null (typically by surfacing the original error).
 */
export async function locateVmInCluster(
  conn: ProxmoxClientOptions,
  vmid: string | number,
  type: GuestType = "qemu"
): Promise<LocatedVm | null> {
  let resources: any
  try {
    resources = await pveFetch<any>(conn, "/cluster/resources?type=vm")
  } catch {
    return null
  }
  if (!Array.isArray(resources)) return null
  return findGuest(resources, vmid, type)
}

function findGuest(resources: any[], vmid: string | number, type: GuestType): LocatedVm | null {
  const target = Number(vmid)
  if (!Number.isFinite(target)) return null
  const r = resources.find(row => row?.type === type && Number(row?.vmid) === target && typeof row?.node === "string")
  return r ? { node: r.node, status: r.status, name: r.name } : null
}

/**
 * locateVmInCluster for callers that answer "not found": `missing` only when
 * the cluster listing came back and holds no such guest; a listing that
 * fails throws, so a transient error is never reported as a deleted guest
 * (an API client such as Terraform forgets a guest on 404, roadmap#265).
 */
export async function locateVmOrMissing(
  conn: ProxmoxClientOptions,
  vmid: string | number,
  type: GuestType = "qemu"
): Promise<LocatedVm | "missing"> {
  const resources = await pveFetch<any>(conn, "/cluster/resources?type=vm")
  if (!Array.isArray(resources)) throw new Error("Unexpected answer to /cluster/resources")
  return findGuest(resources, vmid, type) ?? "missing"
}

/**
 * Detects whether a PVE error message means "VM not on this node anymore"
 * (typically because a migration moved it). The message format from
 * pveFetch is `PVE 500 <path>: <body>`.
 */
export function isVmConfigNotFoundError(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message || ""
  return msg.includes("Configuration file") && msg.includes("does not exist")
}
