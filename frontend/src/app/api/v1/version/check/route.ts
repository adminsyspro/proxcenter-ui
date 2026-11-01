import { NextResponse } from 'next/server'

import { APP_VERSION, GIT_SHA, GITHUB_REPO } from '@/config/version'
import { isOfflineMode } from '@/lib/offline'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const GITHUB_API = 'https://api.github.com'
const HEADERS = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'ProxCenter'
}

interface VersionCheckResponse {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  releaseNotes: string | null
  releaseDate: string | null
  error: string | null
}

// X.Y.Z with an optional pre-release suffix (1.4.13-staging). Anything else,
// such as "dev" or "staging", is not a release and has nothing to compare.
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/

function semverCore(version: string): number[] | null {
  const m = SEMVER.exec(version)

  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function semverCompare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1
    if (a[i] < b[i]) return -1
  }

  return 0
}

export async function GET() {
  const base: VersionCheckResponse = {
    currentVersion: APP_VERSION,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    releaseNotes: null,
    releaseDate: null,
    error: null
  }

  // Air-gapped instance: GitHub is unreachable by design, say so instead of
  // timing out on every navbar poll.
  if (isOfflineMode()) {
    return NextResponse.json({ ...base, error: 'offline' })
  }

  // A dev or staging build has no release number to compare: a plain
  // "staging" read as 0.0.0 announced the last release as an update.
  const current = semverCore(APP_VERSION)

  if (!current) {
    return NextResponse.json(base)
  }

  try {
    const releaseRes = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`,
      { headers: HEADERS, next: { revalidate: 3600 } }
    )

    if (!releaseRes.ok) {
      throw new Error(`GitHub API error: ${releaseRes.status}`)
    }

    const release = await releaseRes.json()
    const latestTag: string = (release.tag_name || '').replace(/^v/, '')

    base.latestVersion = latestTag
    base.releaseUrl = release.html_url || null
    base.releaseNotes = release.body || null
    base.releaseDate = release.published_at || null

    // Compare versions: update available if latest > current
    const latest = semverCore(latestTag)

    if (latest && semverCompare(latest, current) > 0) {
      base.updateAvailable = true
    }

    return NextResponse.json(base)
  } catch (error) {
    console.error('Error checking for updates:', error)

    return NextResponse.json({
      ...base,
      error: 'Failed to check for updates'
    })
  }
}
