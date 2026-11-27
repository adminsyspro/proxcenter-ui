export interface PodRef { namespace: string; name: string }

export interface DrainClassification {
  evict: PodRef[]
  skipped: PodRef[]
  refusedEmptyDir: PodRef[]
  refusedUnmanaged: PodRef[]
}

export interface DrainResult {
  cordoned: boolean
  evicted: number
  skipped: number
  remaining: PodRef[]
  blockedByPdb: PodRef[]
  /**
   * Pods whose eviction failed for a reason other than a PodDisruptionBudget or
   * "already gone" (e.g. RBAC denies pods/eviction, an admission webhook rejects
   * the eviction, or the apiserver 500s). These keep the drain from ever
   * reaching `done`; surfacing them stops the client loop from spinning with no
   * diagnostic. `evictionFailureReason` carries the first such error message.
   */
  evictionFailures: PodRef[]
  evictionFailureReason?: string
  refusedEmptyDir: PodRef[]
  refusedUnmanaged: PodRef[]
  done: boolean
}

/** "namespace/name" (or just name for cluster-scoped pods). */
export function podLabel(p: PodRef): string {
  return p.namespace ? `${p.namespace}/${p.name}` : p.name
}

/** Comma-joined pod names, capped so a big node cannot flood the UI. */
export function podListPreview(pods: PodRef[], max = 8): string {
  const names = pods.slice(0, max).map(podLabel)
  const extra = pods.length - names.length
  return extra > 0 ? `${names.join(', ')} (+${extra})` : names.join(', ')
}

function ref(p: any): PodRef {
  return { namespace: p?.metadata?.namespace ?? '', name: p?.metadata?.name ?? '' }
}
function isTerminal(p: any): boolean {
  const phase = p?.status?.phase
  return phase === 'Succeeded' || phase === 'Failed'
}
function isMirror(p: any): boolean {
  return typeof p?.metadata?.annotations?.['kubernetes.io/config.mirror'] === 'string'
}
function controllerRef(p: any): any | undefined {
  return (p?.metadata?.ownerReferences ?? []).find((o: any) => o?.controller === true)
}
function isDaemonSet(p: any): boolean {
  const c = controllerRef(p)
  return c?.kind === 'DaemonSet'
}
function hasEmptyDir(p: any): boolean {
  return (p?.spec?.volumes ?? []).some((v: any) => v?.emptyDir !== undefined && v?.emptyDir !== null)
}

// Fixed order, first match wins: terminal -> mirror -> DaemonSet -> emptyDir
// (refuse unless force) -> unmanaged (refuse unless force) -> evict.
export function classifyDrainPods(pods: any[], opts: { force: boolean }): DrainClassification {
  const out: DrainClassification = { evict: [], skipped: [], refusedEmptyDir: [], refusedUnmanaged: [] }
  for (const p of pods) {
    if (isTerminal(p) || isMirror(p) || isDaemonSet(p)) { out.skipped.push(ref(p)); continue }
    if (hasEmptyDir(p)) {
      if (opts.force) out.evict.push(ref(p)); else out.refusedEmptyDir.push(ref(p))
      continue
    }
    if (!controllerRef(p)) {
      if (opts.force) out.evict.push(ref(p)); else out.refusedUnmanaged.push(ref(p))
      continue
    }
    out.evict.push(ref(p))
  }
  return out
}

// The client keeps looping only while there are still evictable pods present
// (PDB-blocked or still terminating). Refused pods do not clear by retrying, so
// they do not keep the loop alive (the UI tells the user to re-run with force).
export function shouldContinueDrain(r: DrainResult): boolean {
  return r.remaining.length > 0
}
