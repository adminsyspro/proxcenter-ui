/**
 * Readers for the Proxmox `GET /nodes/{node}/apt/repositories` payload.
 *
 * Every field of this response is easy to misread, and each mistake fails
 * silently rather than throwing. Schema: `PVE/API2/APT.pm`, measured against
 * PVE 9 on 2026-08-25.
 *
 *  - The standard-repository list is keyed `standard-repos`, with a HYPHEN.
 *    Reading `standard_repos` yields `undefined` and the caller sees an empty
 *    list, i.e. a node that looks perfectly configured.
 *  - An enabled standard repo carries `status: 1` (a number, not `true`), and a
 *    disabled one has NO `status` key at all. Comparing against `true` never
 *    matches anything.
 *  - Each `errors[]` item is `{ path, error }`. There is no `message` field, so
 *    reading one prints "undefined" and hides the offending file path.
 */

export interface StandardRepo {
  handle: string
  name?: string
  status?: number | boolean | null
}

export interface AptRepoError {
  path?: string
  error?: string
}

/**
 * A repository problem that blocks a node update. Structured rather than
 * pre-formatted so the UI translates the wording and can explain each kind
 * separately: an enterprise misconfiguration and an unreadable file need
 * different remediations.
 */
export type RepoIssue =
  | { kind: 'enterprise'; component?: string }
  | { kind: 'parse'; detail: string }

/** Accepts the raw PVE payload or our own normalized `standard_repos` shape. */
export function readStandardRepos(payload: any): StandardRepo[] {
  const list = payload?.['standard-repos'] ?? payload?.standard_repos

  return Array.isArray(list) ? list : []
}

export function readRepoErrors(payload: any): AptRepoError[] {
  const list = payload?.errors

  return Array.isArray(list) ? list : []
}

export function isRepoEnabled(status: number | boolean | null | undefined): boolean {
  return status === true || status === 1
}

/** `/etc/apt/sources.list.d/x.sources.BAK: invalid extension` */
export function formatRepoError(e: AptRepoError): string {
  const detail = [e?.path, e?.error].filter(Boolean).join(': ')

  return detail || JSON.stringify(e)
}

/**
 * Repository problems that make `apt update` fail on this node, so the update
 * wizard can refuse to start and say why.
 */
export function computeRepoIssues(payload: any): RepoIssue[] {
  const status: Record<string, number | boolean | null | undefined> = {}

  for (const repo of readStandardRepos(payload)) {
    if (repo?.handle) status[repo.handle] = repo.status
  }

  const issues: RepoIssue[] = []

  if (isRepoEnabled(status['enterprise']) && !isRepoEnabled(status['no-subscription'])) {
    issues.push({ kind: 'enterprise' })
  }

  // Ceph and any future product ship their own `<product>-enterprise` /
  // `<product>-no-subscription` pair alongside the PVE one.
  for (const [handle, s] of Object.entries(status)) {
    if (isRepoEnabled(s) && handle.endsWith('-enterprise') && handle !== 'enterprise') {
      const base = handle.replace(/-enterprise$/, '')

      if (!isRepoEnabled(status[`${base}-no-subscription`])) {
        issues.push({ kind: 'enterprise', component: base })
      }
    }
  }

  for (const e of readRepoErrors(payload)) {
    issues.push({ kind: 'parse', detail: formatRepoError(e) })
  }

  return issues
}
