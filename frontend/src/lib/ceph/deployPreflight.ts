import { CEPH_RELEASES, type CephRelease, type CephRepository } from './pvecephCommands'
import { detachedExit } from './detachedLog'

/*
   What the Ceph deploy wizard reads of each node (ui#1450). The state of Ceph
   comes from `GET /nodes/{n}/ceph/status`: it answers on an initialized
   cluster, and PVE's own checks (PVE/Ceph/Tools.pm) word the two other
   cases: "binary not installed: /usr/bin/ceph-mon" without the packages,
   "pveceph configuration not initialized - missing ..." before `pveceph init`.
*/

export type CephNodeState = 'absent' | 'installed' | 'initialized' | 'unknown'
export type InstallStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN'

const NOT_INSTALLED = /binary not installed/i
const NOT_INITIALIZED = /not initialized|not enabled/i

export function cephNodeState(read: { ok: true } | { error: unknown }): CephNodeState {
  if ('ok' in read) return 'initialized'
  const err = read.error as { statusCode?: unknown; message?: unknown } | null
  const message = String(err?.message ?? '')
  if (err?.statusCode === 501 || NOT_INSTALLED.test(message)) return 'absent'
  if (NOT_INITIALIZED.test(message)) return 'installed'
  return 'unknown'
}

/** The state of a detached `pveceph install` from the account's log (null: no log). */
export function installStatus(log: string | null): InstallStatus {
  if (log === null) return 'UNKNOWN'
  const exit = detachedExit(log)
  if (exit === null) return 'RUNNING'
  return exit === 0 ? 'COMPLETED' : 'FAILED'
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** The /24 around an IPv4 node address, the wizard's proposal for the public network. */
export function publicNetworkOf(address: string | null | undefined): string {
  const m = IPV4.exec(address ?? '')
  return m ? `${m[1]}.${m[2]}.${m[3]}.0/24` : ''
}

/** The enterprise repository needs an active subscription on the node; no-subscription otherwise. */
export function defaultRepository(subscription: { status?: unknown } | null | undefined): CephRepository {
  return String(subscription?.status ?? '').toLowerCase() === 'active' ? 'enterprise' : 'no-subscription'
}

/** The releases of `/nodes/{n}/ceph/releases` that ProxCenter installs and PVE offers, newest first. */
export function readReleases(releases: unknown): CephRelease[] {
  if (!Array.isArray(releases)) return [...CEPH_RELEASES]
  const offered = new Set(releases.filter((r: any) => r?.available && !r?.unsupported).map((r: any) => r.release))
  const kept = CEPH_RELEASES.filter(r => offered.has(r))
  return kept.length > 0 ? kept : [...CEPH_RELEASES]
}
