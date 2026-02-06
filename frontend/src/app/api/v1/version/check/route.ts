import { NextResponse } from 'next/server'

import { VERSION, GITHUB_REPO } from '@/config/version'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  html_url: string
  published_at: string
  prerelease: boolean
  draft: boolean
}

function compareVersions(v1: string, v2: string): number {
  const normalize = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const parts1 = normalize(v1)
  const parts2 = normalize(v2)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  return 0
}

export async function GET() {
  try {
    // Fetch latest release from GitHub
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'ProxCenter'
        },
        next: { revalidate: 3600 } // Cache for 1 hour
      }
    )

    if (!response.ok) {
      // No releases found or API error
      if (response.status === 404) {
        return NextResponse.json({
          currentVersion: VERSION,
          latestVersion: VERSION,
          updateAvailable: false,
          releaseUrl: null,
          releaseNotes: null,
          publishedAt: null
        })
      }
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const release: GitHubRelease = await response.json()

    // Skip prereleases and drafts
    if (release.prerelease || release.draft) {
      return NextResponse.json({
        currentVersion: VERSION,
        latestVersion: VERSION,
        updateAvailable: false,
        releaseUrl: null,
        releaseNotes: null,
        publishedAt: null
      })
    }

    const latestVersion = release.tag_name.replace(/^v/, '')
    const updateAvailable = compareVersions(latestVersion, VERSION) > 0

    return NextResponse.json({
      currentVersion: VERSION,
      latestVersion,
      updateAvailable,
      releaseUrl: release.html_url,
      releaseNotes: release.body,
      releaseName: release.name,
      publishedAt: release.published_at
    })
  } catch (error) {
    console.error('Error checking for updates:', error)

    // Return current version info even on error
    return NextResponse.json({
      currentVersion: VERSION,
      latestVersion: null,
      updateAvailable: false,
      error: 'Failed to check for updates',
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null
    })
  }
}
