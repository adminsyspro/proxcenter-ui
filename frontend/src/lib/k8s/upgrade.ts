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

function byNewest(a: string, b: string): number {
  return newerThan(parse(a)!, parse(b)!) ? -1 : 1
}

/**
 * The releases current can be upgraded to in one step, newest first: the
 * newer patches of its minor line and every release of the next one.
 */
export function upgradeCandidates(current: string, releases: string[]): string[] {
  return releases.filter(v => upgradeRefusal(current, v) === null).sort(byNewest)
}

/**
 * The steps from current to the newest release when it is more than one minor
 * version ahead: the newest release of each minor line in turn. Empty when the
 * newest release is reachable in one step (or there is none).
 */
export function upgradePath(current: string, releases: string[]): string[] {
  const cur = parse(current)
  if (!cur) return []
  const valid = releases.filter(v => parse(v)?.flavour === cur.flavour)
  const newestOfLine = (minor: number) => valid.filter(v => parse(v)!.minor === minor).sort(byNewest)[0]
  const path: string[] = []
  for (let minor = cur.minor + 1; newestOfLine(minor); minor++) path.push(newestOfLine(minor))
  return path.length > 1 ? path : []
}
