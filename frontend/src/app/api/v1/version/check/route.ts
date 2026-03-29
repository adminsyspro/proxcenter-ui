import { NextResponse } from 'next/server'

import { APP_VERSION, GIT_SHA, GITHUB_REPO } from '@/config/version'

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

function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
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

  // Dev build — no version to compare, skip check
  if (APP_VERSION === 'dev') {
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
    if (latestTag && semverCompare(latestTag, APP_VERSION) > 0) {
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
