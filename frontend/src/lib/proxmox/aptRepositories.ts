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
 *  - One Ceph repository lights EVERY Ceph release handle. proxmox-apt matches a
 *    configured repository against a standard handle by URI or by signing key,
 *    and all Ceph releases share the Proxmox key, so a single `ceph-squid`
 *    repository reports both `ceph-squid-*` and `ceph-tentacle-*` as configured
 *    (measured on PVE 9, 2026-09-03). Counting handles counts the same
 *    repository twice.
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

export interface RepoIssueOptions {
  /**
   * Whether `GET /nodes/{node}/subscription` answered `status: "active"`.
   * With an active subscription the enterprise repositories ARE the supported
   * production setup and `apt update` authenticates against them, so they are
   * not a problem (issue #853: a subscribed customer was refused every update).
   * Unknown or unreadable counts as "no subscription", the side that still
   * blocks an `apt update` doomed to a 401.
   */
  subscriptionActive?: boolean
}

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

/**
 * `GET /nodes/{node}/subscription` says `status: "active"` for a valid key and
 * `notfound`, `new`, `invalid`, `expired` or `suspended` otherwise. Only the
 * first one means the enterprise repositories will serve packages.
 */
export function isSubscriptionActive(status: unknown): boolean {
  return typeof status === 'string' && status.trim().toLowerCase() === 'active'
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
export function computeRepoIssues(payload: any, options: RepoIssueOptions = {}): RepoIssue[] {
  const issues: RepoIssue[] = []

  if (!options.subscriptionActive) {
    issues.push(...enterpriseRepoIssues(readStandardRepos(payload)))
  }

  for (const e of readRepoErrors(payload)) {
    issues.push({ kind: 'parse', detail: formatRepoError(e) })
  }

  return issues
}

/**
 * The repository problems of a node as the update dialog needs them: the
 * repository payload and the subscription status are read together, the
 * latter deciding whether enterprise-only repositories count. A subscription
 * that cannot be read counts as not active, the strict side. Returns `null`
 * when the repository payload itself could not be read, so the caller keeps
 * its previous verdict instead of reporting a clean node.
 */
export async function loadNodeRepoIssues(
  connectionId: string,
  nodeName: string,
  fetchImpl: typeof fetch = fetch
): Promise<RepoIssue[] | null> {
  const nodePath = `/api/v1/connections/${connectionId}/nodes/${encodeURIComponent(nodeName)}`

  const [repositories, subscriptionActive] = await Promise.all([
    fetchImpl(`${nodePath}/apt/repositories`)
      .then(res => res.json())
      .catch(() => null),
    fetchImpl(`${nodePath}/subscription`, { cache: 'no-store' })
      .then(res => res.json())
      .then(json => isSubscriptionActive(json?.data?.status))
      .catch(() => false),
  ])

  // Guard on `data` itself, not on `standard_repos`: a node whose only
  // problem is an unparsable file returns an empty repo list with a
  // populated `errors[]`, and bailing on that would hide it.
  if (!repositories?.data) return null

  return computeRepoIssues(repositories.data, { subscriptionActive })
}

/**
 * Enterprise repositories enabled without their no-subscription counterpart,
 * which only matters on a node whose subscription is not active.
 */
function enterpriseRepoIssues(repos: StandardRepo[]): RepoIssue[] {
  const status: Record<string, number | boolean | null | undefined> = {}

  for (const repo of repos) {
    if (repo?.handle) status[repo.handle] = repo.status
  }

  const issues: RepoIssue[] = []

  if (isRepoEnabled(status['enterprise']) && !isRepoEnabled(status['no-subscription'])) {
    issues.push({ kind: 'enterprise' })
  }

  // Ceph and any future product ship their own `<product>-<release>-enterprise`
  // / `<product>-<release>-no-subscription` pair alongside the PVE one. One
  // issue per product, not per release handle: PVE marks every release of a
  // product as configured for a single repository (see the header note).
  const flagged = new Set<string>()

  for (const [handle, s] of Object.entries(status)) {
    if (!isRepoEnabled(s) || handle === 'enterprise' || !handle.endsWith('-enterprise')) continue

    const base = handle.replace(/-enterprise$/, '')

    if (isRepoEnabled(status[`${base}-no-subscription`])) continue

    const product = repoProductLabel(base)

    if (flagged.has(product)) continue
    flagged.add(product)
    issues.push({ kind: 'enterprise', component: product })
  }

  return issues
}

/** `ceph-squid` and `ceph-tentacle` are both the `Ceph` product. */
function repoProductLabel(base: string): string {
  const product = base.split('-')[0] || base

  return product.charAt(0).toUpperCase() + product.slice(1)
}
