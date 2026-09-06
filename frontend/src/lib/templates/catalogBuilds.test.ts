import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-in for the settings table, same shape as catalogStore.test.
const settings = new Map<string, unknown>()
vi.mock('@/lib/db/settings', () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, _tenantId: string, value: unknown) => { settings.set(key, value) }),
}))

import {
  CATALOG_BUILDS_SETTING_KEY,
  parseLastModified,
  parsePointRelease,
  pointReleaseMajor,
  probeImageBuild,
  readCatalogBuilds,
  refreshCatalogBuilds,
  type StoredCatalogBuilds,
} from './catalogBuilds'
import type { CloudImage } from './cloudImages'

// Verbatim excerpts of the manifests the mirrors served on 2026-09-06.
const ROCKY_CHECKSUM = `SHA256 (Rocky-9-EC2-Base-9.8-20260525.0.x86_64.qcow2) = aa
SHA256 (Rocky-9-EC2-Base.latest.x86_64.qcow2) = bb
SHA256 (Rocky-9-GenericCloud-Base-9.8-20260525.0.x86_64.qcow2) = cc
SHA256 (Rocky-9-GenericCloud-Base.latest.x86_64.qcow2) = dd
SHA256 (Rocky-9-GenericCloud-LVM-9.7-20251110.0.x86_64.qcow2) = ee`

const DEBIAN_SHA512SUMS = `4d1f0e  debian-13-generic-amd64.qcow2
9c2b7a  debian-13-generic-amd64.raw
1e88ff  debian-13-generic-arm64.qcow2`

const CENTOS_CHECKSUM = `SHA256 (CentOS-Stream-GenericCloud-9-20260526.0.x86_64.qcow2) = aa
SHA256 (CentOS-Stream-GenericCloud-9-20260302.0.x86_64.qcow2) = bb`

function image(over: Partial<CloudImage> = {}): CloudImage {
  return {
    slug: 'rocky-9', name: 'Rocky Linux 9', vendor: 'rocky', version: '9', arch: 'amd64', format: 'qcow2',
    downloadUrl: 'https://dl.example/Rocky-9-GenericCloud.latest.x86_64.qcow2',
    checksumUrl: 'https://dl.example/CHECKSUM',
    defaultDiskSize: '20G', minMemory: 512, recommendedMemory: 2048, minCores: 1, recommendedCores: 2,
    ostype: 'l26', tags: [], logoIcon: 'ri-cloud-line',
    ...over,
  }
}

function headResponse(lastModified: string | null): Response {
  const headers = new Headers()
  if (lastModified) headers.set('last-modified', lastModified)

  return new Response(null, { status: 200, headers })
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200, headers: new Headers({ 'content-type': 'text/plain' }) })
}

/** Routes HEAD to the download URL and GET to the checksum URL. */
function stubFetch(handlers: { head?: () => Response; manifest?: () => Response }) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'HEAD') return handlers.head?.() ?? new Response(null, { status: 404 })

    return handlers.manifest?.() ?? new Response('', { status: 404 })
  }) as unknown as typeof fetch
}

const fixedNow = () => new Date('2026-09-06T08:00:00.000Z')

beforeEach(() => { settings.clear() })

describe('parseLastModified', () => {
  it('reduces an RFC 1123 date to its day', () => {
    expect(parseLastModified('Mon, 31 Aug 2026 12:12:16 GMT')).toBe('2026-08-31')
  })

  it('returns null on a missing or unparseable header', () => {
    expect(parseLastModified(null)).toBeNull()
    expect(parseLastModified('')).toBeNull()
    expect(parseLastModified('whenever')).toBeNull()
  })
})

describe('pointReleaseMajor', () => {
  it('only looks up a manifest when the catalog version is a bare major', () => {
    expect(pointReleaseMajor('9')).toBe('9')
    expect(pointReleaseMajor(' 10 ')).toBe('10')
    // Already exact, nothing to gain.
    expect(pointReleaseMajor('24.04')).toBeNull()
    expect(pointReleaseMajor('3.21')).toBeNull()
    // Streams have no point releases.
    expect(pointReleaseMajor('9-stream')).toBeNull()
    expect(pointReleaseMajor('rolling')).toBeNull()
  })
})

describe('parsePointRelease', () => {
  it('reads the highest point release out of a Rocky manifest', () => {
    expect(parsePointRelease(ROCKY_CHECKSUM, '9')).toBe('9.8')
  })

  it('finds nothing in a Debian manifest, which names no point release', () => {
    expect(parsePointRelease(DEBIAN_SHA512SUMS, '13')).toBeNull()
  })

  it('does not mistake a build serial for a point release', () => {
    // 20260526.0 is the only dotted number in the file and its major is not 9.
    expect(parsePointRelease(CENTOS_CHECKSUM, '9')).toBeNull()
  })

  it('returns null when the catalog version is already exact', () => {
    expect(parsePointRelease(ROCKY_CHECKSUM, '9.8')).toBeNull()
  })
})

describe('probeImageBuild', () => {
  it('reads the build date from the download URL and the release from the manifest', async () => {
    const fetchImpl = stubFetch({
      head: () => headResponse('Mon, 25 May 2026 19:59:33 GMT'),
      manifest: () => textResponse(ROCKY_CHECKSUM),
    })
    expect(await probeImageBuild(image(), fetchImpl)).toEqual({ buildDate: '2026-05-25', release: '9.8' })
  })

  it('skips the manifest for an image with no checksum URL', async () => {
    const manifest = vi.fn(() => textResponse(ROCKY_CHECKSUM))
    const fetchImpl = stubFetch({ head: () => headResponse('Mon, 25 May 2026 19:59:33 GMT'), manifest })
    const info = await probeImageBuild(image({ checksumUrl: null }), fetchImpl)
    expect(info).toEqual({ buildDate: '2026-05-25', release: null })
    expect(manifest).not.toHaveBeenCalled()
  })

  it('reports nulls rather than throwing when the mirror is unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    expect(await probeImageBuild(image(), fetchImpl)).toEqual({ buildDate: null, release: null })
  })

  it('reports nulls on an HTTP error', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    expect(await probeImageBuild(image(), fetchImpl)).toEqual({ buildDate: null, release: null })
  })
})

describe('refreshCatalogBuilds', () => {
  it('stores one entry per image that resolved, keyed by slug', async () => {
    const fetchImpl = stubFetch({
      head: () => headResponse('Mon, 25 May 2026 19:59:33 GMT'),
      manifest: () => textResponse(ROCKY_CHECKSUM),
    })
    const stored = await refreshCatalogBuilds(
      [image(), image({ slug: 'debian-13', version: '13', checksumUrl: null })],
      { fetchImpl, now: fixedNow },
    )

    expect(stored.checkedAt).toBe('2026-09-06T08:00:00.000Z')
    expect(stored.builds).toEqual({
      'rocky-9': { buildDate: '2026-05-25', release: '9.8' },
      'debian-13': { buildDate: '2026-05-25', release: null },
    })
    expect(settings.get(CATALOG_BUILDS_SETTING_KEY)).toEqual(stored)
  })

  it('leaves out an image the probe could not resolve at all', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch
    const stored = await refreshCatalogBuilds([image()], { fetchImpl, now: fixedNow })
    expect(stored.builds).toEqual({})
  })

  it('carries the previous value forward when the mirror goes dark', async () => {
    settings.set(CATALOG_BUILDS_SETTING_KEY, {
      checkedAt: '2026-09-05T08:00:00.000Z',
      builds: { 'rocky-9': { buildDate: '2026-05-25', release: '9.8' } },
    } satisfies StoredCatalogBuilds)

    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const stored = await refreshCatalogBuilds([image()], { fetchImpl, now: fixedNow })

    expect(stored.builds['rocky-9']).toEqual({ buildDate: '2026-05-25', release: '9.8' })
  })

  it('lets a successful probe overwrite the carried value', async () => {
    settings.set(CATALOG_BUILDS_SETTING_KEY, {
      checkedAt: '2026-09-05T08:00:00.000Z',
      builds: { 'rocky-9': { buildDate: '2026-05-25', release: '9.7' } },
    } satisfies StoredCatalogBuilds)

    const fetchImpl = stubFetch({
      head: () => headResponse('Tue, 01 Sep 2026 10:00:00 GMT'),
      manifest: () => textResponse(ROCKY_CHECKSUM),
    })
    const stored = await refreshCatalogBuilds([image()], { fetchImpl, now: fixedNow })

    expect(stored.builds['rocky-9']).toEqual({ buildDate: '2026-09-01', release: '9.8' })
  })

  it('probes every image even when the pool is smaller than the list', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') seen.push(String(input))

      return headResponse('Mon, 25 May 2026 19:59:33 GMT')
    }) as unknown as typeof fetch

    const images = Array.from({ length: 9 }, (_, i) =>
      image({ slug: `img-${i}`, checksumUrl: null, downloadUrl: `https://dl.example/${i}.qcow2` }))
    const stored = await refreshCatalogBuilds(images, { fetchImpl, now: fixedNow, concurrency: 4 })

    expect(seen).toHaveLength(9)
    expect(Object.keys(stored.builds)).toHaveLength(9)
  })
})

describe('readCatalogBuilds', () => {
  it('returns an empty map when nothing is stored', async () => {
    expect(await readCatalogBuilds()).toEqual({})
  })

  it('drops rows a hand edit left malformed', async () => {
    settings.set(CATALOG_BUILDS_SETTING_KEY, {
      checkedAt: '2026-09-06T08:00:00.000Z',
      builds: {
        'rocky-9': { buildDate: '2026-05-25', release: '9.8' },
        'broken-1': { buildDate: 42, release: [] },
        'broken-2': null,
        'empty-1': { buildDate: null, release: null },
      },
    })

    expect(await readCatalogBuilds()).toEqual({ 'rocky-9': { buildDate: '2026-05-25', release: '9.8' } })
  })
})
