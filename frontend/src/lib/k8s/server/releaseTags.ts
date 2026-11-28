// src/lib/k8s/server/releaseTags.ts
// Every release of k3s and RKE2, read from the tags of their official Git
// repositories (the git refs advertisement: no GitHub API quota). One read per
// distribution per hour at most; null when unreachable (offline
// installation), in which case the version is typed by hand.

const REPOSITORIES: Record<string, string> = {
  k3s: 'https://github.com/k3s-io/k3s.git/info/refs?service=git-upload-pack',
  rke2r: 'https://github.com/rancher/rke2.git/info/refs?service=git-upload-pack',
}

/** A release tag ("v1.37.2+k3s1"), not a release candidate nor a peeled ref. */
const RELEASE_TAG = /refs\/tags\/(v1\.\d{1,3}\.\d{1,3}\+(?:k3s|rke2r)\d{1,3})\n/g

const TTL_MS = 60 * 60 * 1000
const TIMEOUT_MS = 10_000

const cache = new Map<string, { at: number; releases: string[] }>()

/** "k3s" or "rke2r", from a running version such as v1.36.6+k3s1. */
export function flavourOf(version: string): string | null {
  const m = /\+(k3s|rke2r)\d+$/.exec(version)
  return m ? m[1] : null
}

/** The release names found in a git refs advertisement. */
export function parseReleaseTags(advertisement: string): string[] {
  return [...new Set([...advertisement.matchAll(RELEASE_TAG)].map(m => m[1]))]
}

/** Every release of the distribution, or null when its repository cannot be read. */
export async function releasesOf(flavour: string): Promise<string[] | null> {
  const url = REPOSITORIES[flavour]
  if (!url) return null
  const hit = cache.get(flavour)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.releases
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const releases = parseReleaseTags(await res.text())
    cache.set(flavour, { at: Date.now(), releases })
    return releases
  } catch {
    return null
  }
}

/** Test hook: forget the cached releases. */
export function clearReleaseCache(): void {
  cache.clear()
}
