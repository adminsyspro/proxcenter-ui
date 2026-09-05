import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-in for the settings table: key -> value (tenant ignored,
// the store only ever writes the provider tenant).
const settings = new Map<string, unknown>()
vi.mock('@/lib/db/settings', () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, _tenantId: string, value: unknown) => { settings.set(key, value) }),
}))

import {
  CATALOG_REMOTE_SETTING_KEY,
  CATALOG_STATUS_SETTING_KEY,
  DEFAULT_CATALOG_URL,
  resolveCatalogUrl,
  isCatalogAutoUpdateEnabled,
  getEffectiveCatalog,
  resolveBuiltInImage,
  refreshRemoteCatalog,
  type StoredRemoteCatalog,
} from './catalogStore'
import { CLOUD_IMAGES, EMBEDDED_CATALOG } from './cloudImages'
import type { CloudImageCatalog } from './catalogSchema'

function remoteCatalog(mutate?: (c: CloudImageCatalog) => void): CloudImageCatalog {
  const c = JSON.parse(JSON.stringify(EMBEDDED_CATALOG)) as CloudImageCatalog
  c.updatedAt = '2026-10-01'
  mutate?.(c)
  return c
}

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (init.etag) headers.set('etag', init.etag)
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200, headers })
}

const fixedNow = () => new Date('2026-09-05T10:00:00.000Z')

beforeEach(() => { settings.clear() })

describe('configuration', () => {
  it('defaults to the GitHub raw URL and honours TEMPLATE_CATALOG_URL', () => {
    expect(resolveCatalogUrl({})).toBe(DEFAULT_CATALOG_URL)
    expect(resolveCatalogUrl({ TEMPLATE_CATALOG_URL: ' https://mirror.local/catalog.json ' })).toBe('https://mirror.local/catalog.json')
    expect(resolveCatalogUrl({ TEMPLATE_CATALOG_URL: '   ' })).toBe(DEFAULT_CATALOG_URL)
  })

  it('auto update is on unless TEMPLATE_CATALOG_AUTO_UPDATE is false', () => {
    expect(isCatalogAutoUpdateEnabled({})).toBe(true)
    expect(isCatalogAutoUpdateEnabled({ TEMPLATE_CATALOG_AUTO_UPDATE: 'false' })).toBe(false)
    expect(isCatalogAutoUpdateEnabled({ TEMPLATE_CATALOG_AUTO_UPDATE: 'FALSE' })).toBe(false)
    expect(isCatalogAutoUpdateEnabled({ TEMPLATE_CATALOG_AUTO_UPDATE: '0' })).toBe(false)
    expect(isCatalogAutoUpdateEnabled({ TEMPLATE_CATALOG_AUTO_UPDATE: 'true' })).toBe(true)
  })
})

describe('getEffectiveCatalog', () => {
  it('serves the embedded catalog when nothing is stored', async () => {
    const eff = await getEffectiveCatalog()
    expect(eff.meta.source).toBe('embedded')
    expect(eff.meta.catalogUpdatedAt).toBe(EMBEDDED_CATALOG.updatedAt)
    expect(eff.meta.lastCheckedAt).toBeNull()
    expect(eff.images).toHaveLength(CLOUD_IMAGES.length)
    expect(eff.meta.url).toBe(DEFAULT_CATALOG_URL)
  })

  it('serves a stored remote catalog and reports its status', async () => {
    const stored: StoredRemoteCatalog = {
      url: DEFAULT_CATALOG_URL, etag: '"abc"', fetchedAt: '2026-09-04T00:00:00.000Z',
      catalog: remoteCatalog(c => { c.images = c.images.slice(0, 3) }),
    }
    settings.set(CATALOG_REMOTE_SETTING_KEY, stored)
    settings.set(CATALOG_STATUS_SETTING_KEY, { lastCheckedAt: '2026-09-05T00:00:00.000Z', lastResult: 'unchanged', lastError: null })
    const eff = await getEffectiveCatalog()
    expect(eff.meta.source).toBe('remote')
    expect(eff.meta.catalogUpdatedAt).toBe('2026-10-01')
    expect(eff.meta.fetchedAt).toBe('2026-09-04T00:00:00.000Z')
    expect(eff.meta.lastCheckedAt).toBe('2026-09-05T00:00:00.000Z')
    expect(eff.meta.lastResult).toBe('unchanged')
    expect(eff.images).toHaveLength(3)
  })

  it('ignores a stored payload that no longer validates and falls back to embedded', async () => {
    settings.set(CATALOG_REMOTE_SETTING_KEY, { url: DEFAULT_CATALOG_URL, etag: null, fetchedAt: 'x', catalog: { schemaVersion: 1, images: 'broken' } })
    const eff = await getEffectiveCatalog()
    expect(eff.meta.source).toBe('embedded')
    expect(eff.images).toHaveLength(CLOUD_IMAGES.length)
  })
})

describe('resolveBuiltInImage', () => {
  it('prefers the remote image and falls back to embedded for a retired slug', async () => {
    const stored: StoredRemoteCatalog = {
      url: DEFAULT_CATALOG_URL, etag: null, fetchedAt: 'x',
      catalog: remoteCatalog(c => {
        c.images = c.images.filter(i => i.slug !== 'debian-11')
        c.images[0] = { ...c.images[0], name: 'Remote name' }
      }),
    }
    settings.set(CATALOG_REMOTE_SETTING_KEY, stored)
    expect((await resolveBuiltInImage(stored.catalog.images[0].slug))?.name).toBe('Remote name')
    expect((await resolveBuiltInImage('debian-11'))?.slug).toBe('debian-11')
    expect(await resolveBuiltInImage('nope')).toBeUndefined()
  })
})

describe('refreshRemoteCatalog', () => {
  it('stores a valid payload with its ETag and reports the diff against the embedded catalog on first fetch', async () => {
    const remote = remoteCatalog(c => {
      c.images.push({ ...c.images[0], slug: 'ubuntu-2610', name: 'Ubuntu 26.10' })
      c.images = c.images.filter(i => i.slug !== 'debian-11')
    })
    const fetchImpl = vi.fn(async () => jsonResponse(remote, { etag: '"v2"' })) as unknown as typeof fetch
    const out = await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: {} })
    expect(out.result).toBe('updated')
    expect(out.added).toEqual(['ubuntu-2610'])
    expect(out.removed).toEqual(['debian-11'])
    expect(out.error).toBeNull()

    const stored = settings.get(CATALOG_REMOTE_SETTING_KEY) as StoredRemoteCatalog
    expect(stored.etag).toBe('"v2"')
    expect(stored.fetchedAt).toBe('2026-09-05T10:00:00.000Z')
    expect(stored.catalog.updatedAt).toBe('2026-10-01')
    expect(settings.get(CATALOG_STATUS_SETTING_KEY)).toEqual({ lastCheckedAt: '2026-09-05T10:00:00.000Z', lastResult: 'updated', lastError: null })

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(DEFAULT_CATALOG_URL)
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^ProxCenter\//)
    expect((init.headers as Record<string, string>)['If-None-Match']).toBeUndefined()
    expect(init.cache).toBe('no-store')
  })

  it('sends If-None-Match and treats 304 as unchanged without touching the stored payload', async () => {
    const stored: StoredRemoteCatalog = { url: DEFAULT_CATALOG_URL, etag: '"v2"', fetchedAt: 'before', catalog: remoteCatalog() }
    settings.set(CATALOG_REMOTE_SETTING_KEY, stored)
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch
    const out = await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: {} })
    expect(out).toEqual({ result: 'unchanged', added: [], updated: [], removed: [], error: null })
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"v2"')
    expect((settings.get(CATALOG_REMOTE_SETTING_KEY) as StoredRemoteCatalog).fetchedAt).toBe('before')
    expect(settings.get(CATALOG_STATUS_SETTING_KEY)).toEqual({ lastCheckedAt: '2026-09-05T10:00:00.000Z', lastResult: 'unchanged', lastError: null })
  })

  it('reports unchanged when a 200 body is identical to the stored catalog', async () => {
    const stored: StoredRemoteCatalog = { url: DEFAULT_CATALOG_URL, etag: null, fetchedAt: 'before', catalog: remoteCatalog() }
    settings.set(CATALOG_REMOTE_SETTING_KEY, stored)
    const fetchImpl = vi.fn(async () => jsonResponse(remoteCatalog(), { etag: '"v3"' })) as unknown as typeof fetch
    const out = await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: {} })
    expect(out.result).toBe('unchanged')
    // The ETag is refreshed so the next call can use If-None-Match.
    expect((settings.get(CATALOG_REMOTE_SETTING_KEY) as StoredRemoteCatalog).etag).toBe('"v3"')
  })

  it('keeps the previous payload on a non-2xx response and records the error', async () => {
    const stored: StoredRemoteCatalog = { url: DEFAULT_CATALOG_URL, etag: null, fetchedAt: 'before', catalog: remoteCatalog() }
    settings.set(CATALOG_REMOTE_SETTING_KEY, stored)
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    const out = await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: {} })
    expect(out.result).toBe('error')
    expect(out.error).toMatch(/HTTP 503/)
    expect((settings.get(CATALOG_REMOTE_SETTING_KEY) as StoredRemoteCatalog).fetchedAt).toBe('before')
    expect(settings.get(CATALOG_STATUS_SETTING_KEY)).toMatchObject({ lastResult: 'error', lastError: expect.stringMatching(/HTTP 503/) })
  })

  it('keeps the previous payload on invalid JSON, on a failed validation and on a newer schema version', async () => {
    for (const body of ['{not json', { schemaVersion: 1, updatedAt: 'bad' }, { ...remoteCatalog(), schemaVersion: 2 }]) {
      settings.clear()
      settings.set(CATALOG_REMOTE_SETTING_KEY, { url: DEFAULT_CATALOG_URL, etag: null, fetchedAt: 'before', catalog: remoteCatalog() })
      const fetchImpl = vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch
      const out = await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: {} })
      expect(out.result).toBe('error')
      expect((settings.get(CATALOG_REMOTE_SETTING_KEY) as StoredRemoteCatalog).fetchedAt).toBe('before')
    }
  })

  it('rejects a body over the size cap', async () => {
    const huge = JSON.stringify(remoteCatalog()).padEnd(1_048_577, ' ')
    const fetchImpl = vi.fn(async () => jsonResponse(huge)) as unknown as typeof fetch
    const out = await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: {} })
    expect(out.result).toBe('error')
    expect(out.error).toMatch(/too large/i)
  })

  it('never throws when fetch itself rejects', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const out = await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: {} })
    expect(out.result).toBe('error')
    expect(out.error).toMatch(/ECONNREFUSED/)
    expect(settings.get(CATALOG_REMOTE_SETTING_KEY)).toBeUndefined()
  })

  it('surfaces the cause code behind undici\'s bare "fetch failed"', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:8765' } })
    }) as unknown as typeof fetch
    const out = await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: {} })
    expect(out.result).toBe('error')
    expect(out.error).toBe('fetch failed (ECONNREFUSED)')
  })

  it('fetches the URL from TEMPLATE_CATALOG_URL when set', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(remoteCatalog())) as unknown as typeof fetch
    await refreshRemoteCatalog({ fetchImpl, now: fixedNow, env: { TEMPLATE_CATALOG_URL: 'https://mirror.local/c.json' } })
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://mirror.local/c.json')
    expect((settings.get(CATALOG_REMOTE_SETTING_KEY) as StoredRemoteCatalog).url).toBe('https://mirror.local/c.json')
  })
})
