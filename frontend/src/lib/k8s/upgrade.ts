// src/lib/k8s/upgrade.ts
// The version rules of a Kubernetes upgrade, the same as the orchestrator's
// (internal/provisioning/upgrade.go): a release of the running distribution,
// newer than the running one, at most one minor version ahead.

/** k3s "v1.37.2+k3s1" and RKE2 "v1.37.2+rke2r1": minor, patch, revision. */
const RELEASE = /^v1\.(\d{1,3})\.(\d{1,3})\+(k3s|rke2r)(\d{1,3})$/

interface Release { minor: number; patch: number; flavour: string; rev: number }

function parse(v: string): Release | null {
  const m = RELEASE.exec(v)
  return m ? { minor: Number(m[1]), patch: Number(m[2]), flavour: m[3], rev: Number(m[4]) } : null
}

function newerThan(a: Release, b: Release): boolean {
  if (a.minor !== b.minor) return a.minor > b.minor
  if (a.patch !== b.patch) return a.patch > b.patch
  return a.rev > b.rev
}

export type UpgradeRefusal = 'unknown_current' | 'format' | 'not_newer' | 'skips_minor'

/** Why target cannot follow current, or null when it can. */
export function upgradeRefusal(current: string, target: string): UpgradeRefusal | null {
  const cur = parse(current)
  if (!cur) return 'unknown_current'
  const next = parse(target)
  if (!next || next.flavour !== cur.flavour) return 'format'
  if (!newerThan(next, cur)) return 'not_newer'
  if (next.minor > cur.minor + 1) return 'skips_minor'
  return null
}

/** The next minor version's line ("v1.38"), for the dialog's hint. */
export function nextMinor(current: string): string | null {
  const cur = parse(current)
  return cur ? `v1.${cur.minor + 1}` : null
}
