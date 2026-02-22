import { NextResponse } from 'next/server'

import { VERSION, GIT_SHA, GITHUB_REPO } from '@/config/version'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const GITHUB_API = 'https://api.github.com'
const HEADERS = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'ProxCenter'
}

interface VersionCheckResponse {
  currentVersion: string
  currentSha: string | null
  latestSha: string | null
  updateAvailable: boolean
  commitsBehind: number
  latestMessage: string | null
  latestDate: string | null
  latestAuthor: string | null
  compareUrl: string | null
  error: string | null
}

export async function GET() {
  const base: VersionCheckResponse = {
    currentVersion: VERSION,
    currentSha: GIT_SHA || null,
    latestSha: null,
    updateAvailable: false,
    commitsBehind: 0,
    latestMessage: null,
    latestDate: null,
    latestAuthor: null,
    compareUrl: null,
    error: null
  }

  // Local dev — no SHA baked in, skip check
  if (!GIT_SHA) {
    return NextResponse.json(base)
  }

  try {
    // 1. Fetch latest commit on main
    const commitRes = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/commits/main`,
      { headers: HEADERS, next: { revalidate: 3600 } }
    )

    if (!commitRes.ok) {
      throw new Error(`GitHub API error: ${commitRes.status}`)
    }

    const commit = await commitRes.json()
    const latestSha: string = commit.sha

    base.latestSha = latestSha
    base.latestMessage = commit.commit?.message?.split('\n')[0] || null
    base.latestDate = commit.commit?.committer?.date || null
    base.latestAuthor = commit.commit?.author?.name || null

    // Same SHA — up to date
    if (latestSha === GIT_SHA) {
      return NextResponse.json(base)
    }

    // 2. Different SHA — fetch compare to get commits behind
    base.updateAvailable = true
    base.compareUrl = `https://github.com/${GITHUB_REPO}/compare/${GIT_SHA}...main`

    try {
      const compareRes = await fetch(
        `${GITHUB_API}/repos/${GITHUB_REPO}/compare/${GIT_SHA}...main`,
        { headers: HEADERS, next: { revalidate: 3600 } }
      )

      if (compareRes.ok) {
        const compare = await compareRes.json()
        base.commitsBehind = compare.ahead_by ?? 0
      }
      // 404 = SHA deleted (force-push) — still updateAvailable, commitsBehind stays 0
    } catch {
      // Compare failed — still flag update, just no count
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
