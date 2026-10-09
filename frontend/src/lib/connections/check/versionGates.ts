// src/lib/connections/check/versionGates.ts
//
// Proxmox VE minimums that ProxCenter features already enforce elsewhere in
// the code base, gathered so the version probe can tell an operator which
// features a node is too old for. `source` points at the gate the number was
// taken from: change it there first, then here.

import type { FeatureId } from './privilegeMap'

export interface VersionGate {
  feature: FeatureId
  /** Inclusive `[major, minor]` minimum. */
  min: [number, number]
  source: string
}

export const PVE_VERSION_GATES: VersionGate[] = [
  // nbdkit-plugin-vddk is only packaged from Debian 13 (PVE 9) on.
  { feature: 'warmMigration', min: [9, 0], source: 'src/lib/migration/warm/vddk-preflight.ts' },
  // /cluster/ha/rules (affinity rules) exists from PVE 9.
  { feature: 'haAffinityRules', min: [9, 0], source: 'src/lib/proxmox/haAffinity.ts' },
  // /cluster/sdn/fabrics exists from PVE 9.
  { feature: 'sdnFabrics', min: [9, 0], source: 'src/app/api/v1/connections/[id]/sdn/fabrics/route.ts' },
  // /cluster/sdn/vnets/{vnet}/firewall/options exists from PVE 8.3.
  { feature: 'vnetFirewall', min: [8, 3], source: 'src/lib/vdc/sdn.ts' },
  // Nested pools and /pools updates with poolid as a parameter: PVE 8.1.
  { feature: 'nestedPools', min: [8, 1], source: 'src/app/api/v1/connections/[id]/pools/route.ts' },
  // /cluster/mapping/{pci|usb|dir}: PVE 8.0.
  { feature: 'hardwareMappings', min: [8, 0], source: 'src/app/api/v1/connections/[id]/cluster/mapping/[kind]/route.ts' },
]

/** Below this major the diagnostics already warn; the version probe does the same. */
export const MIN_SUPPORTED_PVE_MAJOR = 7

export interface ParsedPveVersion {
  major: number
  minor: number
}

/** `9.2.11` or `pve-manager/9.2.11/abcdef` to `{ major: 9, minor: 2 }`. */
export function parsePveVersion(raw: unknown): ParsedPveVersion | null {
  if (typeof raw !== 'string') return null
  const match = /(\d+)\.(\d+)/.exec(raw)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]) }
}

export function isAtLeast(version: ParsedPveVersion, min: [number, number]): boolean {
  if (version.major !== min[0]) return version.major > min[0]
  return version.minor >= min[1]
}

/** Gates a node of `version` does not meet, highest requirement first. */
export function unmetGates(version: ParsedPveVersion, gates: VersionGate[] = PVE_VERSION_GATES): VersionGate[] {
  return gates
    .filter(gate => !isAtLeast(version, gate.min))
    .sort((a, b) => (b.min[0] - a.min[0]) || (b.min[1] - a.min[1]))
}
