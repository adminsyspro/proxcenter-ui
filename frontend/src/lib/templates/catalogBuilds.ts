// src/lib/templates/catalogBuilds.ts
//
// Exact build identity of the images the catalog points at.
//
// Most downloadUrls are rolling aliases (/current/, /latest/, .latest.), so
// the catalog document says "Debian 13" while the file behind the URL moves
// every few weeks. Two facts recover the real identity, both read from the
// mirror itself rather than maintained by hand in the catalog file:
//
//  - the Last-Modified header of the download URL: the publication date of
//    the image a deploy would pull today. Measured 2026-09-06: 15 of our 16
//    mirrors answer it, only Fedora's redirector does not.
//  - the point release, when the vendor puts it in the checksum manifest.
//    Rocky and AlmaLinux name their files
//    Rocky-9-GenericCloud-Base-9.8-20260525.0.x86_64.qcow2, so "9.8" is
//    readable. Debian and Ubuntu publish no point release for their cloud
//    images and CentOS Stream has none by design; those keep the date alone.
//
// Probing is server-side and runs once a day from the catalog refresher,
// never on a page load. Every failure is silent and leaves the field null:
// an air-gapped install never starts the refresher at all (see
// isCatalogAutoUpdateEnabled) and simply shows the cards as before.

import { APP_VERSION } from '@/config/version'
import { getSetting, setSetting } from '@/lib/db/settings'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'

import type { CloudImage } from './cloudImages'

export const CATALOG_BUILDS_SETTING_KEY = 'templates.catalog.builds'
export const BUILD_PROBE_TIMEOUT_MS = 10_000
export const BUILD_PROBE_CONCURRENCY = 4
export const MANIFEST_MAX_BYTES = 524_288

export interface ImageBuildInfo {
  /** Publication date of the file behind the URL, as YYYY-MM-DD. */
  buildDate: string | null
  /** Vendor point release read from the checksum manifest, e.g. "9.8". */
  release: string | null
}

export interface StoredCatalogBuilds {
  checkedAt: string
  /** Keyed by image slug. Slugs with nothing to show are left out. */
  builds: Record<string, ImageBuildInfo>
}

export interface BuildProbeOptions {
  fetchImpl?: typeof fetch
  now?: () => Date
  concurrency?: number
}

/** Date.parse handles the RFC 1123 dates every one of these mirrors sends. */
export function parseLastModified(value: string | null): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null

  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The major to look for in a checksum manifest, or null when there is nothing
 * to gain: "24.04" and "3.21" are already the exact version, "rolling" and
 * "9-stream" name streams that have no point releases.
 */
export function pointReleaseMajor(version: string): string | null {
  const v = (version ?? '').trim()

  return /^\d+$/.test(v) ? v : null
}

/**
 * Highest `<major>.<minor>` named in a checksum manifest. The guards on both
 * sides keep build serials out: in
 * `CentOS-Stream-GenericCloud-9-20260526.0.x86_64.qcow2` the only dotted
 * number is 20260526.0, whose major is not 9, so nothing is reported.
 */
export function parsePointRelease(manifest: string, version: string): string | null {
  const major = pointReleaseMajor(version)
  if (!major) return null

  const pattern = new RegExp(`(?<![\\d.])${major}\\.(\\d+)(?![\\d.])`, 'g')
  let best: number | null = null
  for (const match of manifest.matchAll(pattern)) {
    const minor = Number(match[1])
    if (Number.isFinite(minor) && (best === null || minor > best)) best = minor
  }

  return best === null ? null : `${major}.${best}`
}

function probeHeaders(): Record<string, string> {
  return { 'User-Agent': `ProxCenter/${APP_VERSION}` }
}

async function probeBuildDate(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(url, {
    method: 'HEAD',
    headers: probeHeaders(),
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(BUILD_PROBE_TIMEOUT_MS),
  })
  if (!res.ok) return null

  return parseLastModified(res.headers.get('last-modified'))
}

async function probeRelease(image: CloudImage, fetchImpl: typeof fetch): Promise<string | null> {
  if (!image.checksumUrl || !pointReleaseMajor(image.version)) return null

  const res = await fetchImpl(image.checksumUrl, {
    method: 'GET',
    headers: probeHeaders(),
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(BUILD_PROBE_TIMEOUT_MS),
  })
  if (!res.ok) return null

  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MANIFEST_MAX_BYTES) return null
  const text = await res.text()
  if (text.length > MANIFEST_MAX_BYTES) return null

  return parsePointRelease(text, image.version)
}

/** Never throws: an unreachable mirror is a missing field, not an error. */
export async function probeImageBuild(image: CloudImage, fetchImpl: typeof fetch = fetch): Promise<ImageBuildInfo> {
  const [buildDate, release] = await Promise.all([
    probeBuildDate(image.downloadUrl, fetchImpl).catch(() => null),
    probeRelease(image, fetchImpl).catch(() => null),
  ])

  return { buildDate, release }
}

/** Stored build info, re-validated: the settings row could have been edited. */
export async function readCatalogBuilds(): Promise<Record<string, ImageBuildInfo>> {
  const stored = await getSetting<StoredCatalogBuilds>(CATALOG_BUILDS_SETTING_KEY, DEFAULT_TENANT_ID)
  const builds = stored && typeof stored === 'object' ? stored.builds : null
  if (!builds || typeof builds !== 'object') return {}

  const clean: Record<string, ImageBuildInfo> = {}
  for (const [slug, info] of Object.entries(builds)) {
    if (!info || typeof info !== 'object') continue
    const buildDate = typeof info.buildDate === 'string' ? info.buildDate : null
    const release = typeof info.release === 'string' ? info.release : null
    if (buildDate || release) clean[slug] = { buildDate, release }
  }

  return clean
}

/**
 * Probe every image and persist the result. A mirror that fails today keeps
 * yesterday's value rather than blanking the card: being unable to reach the
 * mirror says nothing about the image having changed.
 */
export async function refreshCatalogBuilds(
  images: CloudImage[],
  opts: BuildProbeOptions = {},
): Promise<StoredCatalogBuilds> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => new Date())
  const concurrency = Math.max(1, opts.concurrency ?? BUILD_PROBE_CONCURRENCY)
  const previous = await readCatalogBuilds()

  const builds: Record<string, ImageBuildInfo> = {}
  let cursor = 0
  const worker = async () => {
    while (cursor < images.length) {
      const image = images[cursor++]
      const probed = await probeImageBuild(image, fetchImpl)
      const carried = previous[image.slug]
      const info: ImageBuildInfo = {
        buildDate: probed.buildDate ?? carried?.buildDate ?? null,
        release: probed.release ?? carried?.release ?? null,
      }
      if (info.buildDate || info.release) builds[image.slug] = info
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, worker))

  const stored: StoredCatalogBuilds = { checkedAt: now().toISOString(), builds }
  await setSetting(CATALOG_BUILDS_SETTING_KEY, DEFAULT_TENANT_ID, stored)

  return stored
}
