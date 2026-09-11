// Naming of the DR replica, mirroring validateVMNameAffix in the orchestrator
// (internal/replication/service.go).
//
// PVE stores a VM name as a `dns-name`, and the replica's config is written
// straight into the target's /etc/pve over SSH, past the `qm set` schema
// check. Nothing on the target re-validates it, so a malformed affix would
// only surface later, when PVE's own parser refuses the replica's config.
// Restricting an affix to letters, digits and inner hyphens keeps
// prefix + name + suffix a valid dns-name for every name PVE accepted on the
// source, which is why the same rule is enforced on both sides.

export const MAX_VM_NAME_AFFIX = 24

const AFFIX_CHARS = /^[A-Za-z0-9-]+$/
const ALPHANUMERIC = /^[A-Za-z0-9]$/

export type VMNameAffixError = 'tooLong' | 'shape'

/** null when the affix is usable (empty included). */
export function vmNameAffixError(value: string, side: 'prefix' | 'suffix'): VMNameAffixError | null {
  if (!value) return null
  if (value.length > MAX_VM_NAME_AFFIX) return 'tooLong'
  if (!AFFIX_CHARS.test(value)) return 'shape'

  // The composed name must not start or end on a hyphen: only the outer edge
  // of each affix can do that, the source name is already a valid dns-name.
  const edge = side === 'prefix' ? value[0] : value[value.length - 1]

  return ALPHANUMERIC.test(edge) ? null : 'shape'
}

/** The name the replica will carry on the target cluster. */
export function replicaName(sourceName: string, prefix: string, suffix: string): string {
  if (!sourceName) return sourceName

  return `${prefix}${sourceName}${suffix}`
}
