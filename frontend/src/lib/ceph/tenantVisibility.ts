import type { InfraScope } from "@/lib/tenant/infraScope"

/**
 * Whether a tenant may see the Ceph of the clusters in its scope. Ceph is a
 * whole-cluster object (OSDs, hosts, pools, mon/mgr addresses, capacity,
 * throughput): the provider sees every cluster, an MSP tenant owns whole
 * clusters, an IaaS tenant only rents a vDC slice of a provider cluster and
 * sees none of it. Allow-list, so any other kind is refused.
 *
 * Pure on purpose (no principal, no database): the aggregated responses
 * (dashboard, inventory) already hold the tenant scope they resolved.
 */
export function cephVisibleTo(infra: Pick<InfraScope, "kind"> | null | undefined): boolean {
  return infra?.kind === "provider" || infra?.kind === "msp"
}
