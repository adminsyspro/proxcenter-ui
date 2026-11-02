// src/lib/ceph/tenantGuard.ts
//
// Ceph is a whole-cluster object: OSDs, hosts, pools, mon/mgr addresses, CRUSH
// map, per-OSD IOPS. An IaaS tenant only rents a vDC slice of a provider
// cluster, yet it holds connection.view and getConnectionById() hands it the
// provider connection through its vDC binding. Every Ceph route therefore asks
// this guard, right after checkPermission() and before any PVE, database, SSH
// or orchestrator call:
//  - provider (tenant `default`): full access;
//  - msp: full access, its connections are its own clusters;
//  - iaas, or anything that cannot be resolved: 404 { error: "Not found" },
//    the feature does not exist for it and nothing is confirmed.
//
// The verdict is taken from the tenant the principal itself carries, never
// from getCurrentTenantId() (see requireProviderTenant in lib/tenant). Any
// error on the way refuses (fail closed).

import type { NextResponse } from "next/server"

import { denyIaasTenant } from "@/lib/tenant/iaasGuard"

/**
 * Null when the caller may read or act on Ceph (provider or MSP tenant), else
 * the Response to hand back: the principal rejection, 401 without a principal,
 * 404 Not found for an IaaS tenant or an unresolvable tenant. Ceph is one of
 * the whole-cluster objects lib/tenant/iaasGuard closes to an IaaS tenant;
 * cephVisibleTo (./tenantVisibility) is the same allow-list for callers that
 * already hold the scope.
 */
export async function denyIaasTenantCeph(): Promise<NextResponse | null> {
  return denyIaasTenant()
}

/**
 * The same verdict as a boolean, for a caller that does not answer an HTTP
 * request with it (the assistant's tool context, the Ceph fields of an
 * aggregated response): true only when the gate lets the caller through.
 * denyIaasTenantCeph never throws (its errors are a 404), so neither does this.
 */
export async function cephAllowedForCaller(): Promise<boolean> {
  return (await denyIaasTenantCeph()) === null
}
