// src/lib/templates/catalogStore.ts
//
// Server-only view of the cloud image catalog. The embedded document
// (src/data/cloudImages.json) is the floor; a copy of the same document
// fetched from the public repo (or a mirror) is stored in the settings table
// and served instead when it validates. Listing = remote else embedded;
// slug resolution = remote then embedded, so retired slugs keep resolving.
//
// Do not import this from client components: it reaches Prisma through
// @/lib/db/settings.

import { APP_VERSION } from '@/config/version'
import { getSetting, setSetting } from '@/lib/db/settings'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'

import {
  diffCatalogs,
  findImageBySlug,
  parseCatalogPayload,
  type CatalogDiff,
  type CatalogMeta,
  type CatalogRefreshResult,
  type CloudImageCatalog,
} from './catalogSchema'
import { CLOUD_IMAGES, EMBEDDED_CATALOG, type CatalogVendor, type CloudImage } from './cloudImages'

export const CATALOG_REMOTE_SETTING_KEY = 'templates.catalog.remote'
export const CATALOG_STATUS_SETTING_KEY = 'templates.catalog.status'
export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/adminsyspro/proxcenter-ui/main/frontend/src/data/cloudImages.json'
export const CATALOG_FETCH_TIMEOUT_MS = 15_000
export const CATALOG_MAX_BYTES = 1_048_576

export interface StoredRemoteCatalog {
  url: string
  etag: string | null
  fetchedAt: string
  catalog: CloudImageCatalog
}

export interface StoredCatalogStatus {
  lastCheckedAt: string
  lastResult: CatalogRefreshResult
  lastError: string | null
}

export interface EffectiveCatalog {
  images: CloudImage[]
  vendors: CatalogVendor[]
  meta: CatalogMeta
}

export interface RefreshOutcome extends CatalogDiff {
  result: CatalogRefreshResult
  error: string | null
}

export interface RefreshOptions {
  fetchImpl?: typeof fetch
  now?: () => Date
  env?: NodeJS.ProcessEnv
}

export function resolveCatalogUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.TEMPLATE_CATALOG_URL ?? '').trim()
  return override || DEFAULT_CATALOG_URL
}

export function isCatalogAutoUpdateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.TEMPLATE_CATALOG_AUTO_UPDATE ?? '').trim().toLowerCase()
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off')
}

/**
 * Read the stored remote payload, re-validating it: the settings row could
 * have been written by an older or newer ProxCenter, or edited by hand.
 */
async function readStoredRemote(): Promise<StoredRemoteCatalog | null> {
  const stored = await getSetting<StoredRemoteCatalog>(CATALOG_REMOTE_SETTING_KEY, DEFAULT_TENANT_ID)
  if (!stored || typeof stored !== 'object') return null
  const parsed = parseCatalogPayload(stored.catalog)
  if (!parsed.ok) return null
  return {
    url: typeof stored.url === 'string' ? stored.url : DEFAULT_CATALOG_URL,
    etag: typeof stored.etag === 'string' ? stored.etag : null,
    fetchedAt: typeof stored.fetchedAt === 'string' ? stored.fetchedAt : '',
    catalog: parsed.catalog,
  }
}

async function readStatus(): Promise<StoredCatalogStatus | null> {
  const status = await getSetting<StoredCatalogStatus>(CATALOG_STATUS_SETTING_KEY, DEFAULT_TENANT_ID)
  return status && typeof status === 'object' ? status : null
}

export async function getEffectiveCatalog(): Promise<EffectiveCatalog> {
  const [remote, status] = await Promise.all([readStoredRemote(), readStatus()])
  const source: CatalogMeta['source'] = remote ? 'remote' : 'embedded'
  const catalog = remote?.catalog ?? EMBEDDED_CATALOG
  return {
    images: catalog.images,
    vendors: catalog.vendors,
    meta: {
      source,
      catalogUpdatedAt: catalog.updatedAt,
      fetchedAt: remote?.fetchedAt || null,
      lastCheckedAt: status?.lastCheckedAt ?? null,
      lastResult: status?.lastResult ?? null,
      lastError: status?.lastError ?? null,
      url: resolveCatalogUrl(),
      autoUpdate: isCatalogAutoUpdateEnabled(),
    },
  }
}

/** Built-in image by slug: remote catalog first, embedded list second. */
export async function resolveBuiltInImage(slug: string): Promise<CloudImage | undefined> {
  const remote = await readStoredRemote()
  return findImageBySlug(remote?.catalog ?? null, CLOUD_IMAGES, slug)
}

class RefreshError extends Error {}

async function fetchCatalogDocument(
  url: string,
  etag: string | null,
  fetchImpl: typeof fetch,
): Promise<{ status: 304 } | { status: 200; etag: string | null; catalog: CloudImageCatalog }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': `ProxCenter/${APP_VERSION}`,
  }
  if (etag) headers['If-None-Match'] = etag

  const res = await fetchImpl(url, {
    method: 'GET',
    headers,
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
  })

  if (res.status === 304) return { status: 304 }
  if (!res.ok) throw new RefreshError(`HTTP ${res.status} from ${url}`)

  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > CATALOG_MAX_BYTES) throw new RefreshError(`catalog body too large (${declared} bytes)`)
  const text = await res.text()
  if (text.length > CATALOG_MAX_BYTES) throw new RefreshError(`catalog body too large (${text.length} bytes)`)

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new RefreshError('catalog body is not valid JSON')
  }
  const parsed = parseCatalogPayload(json)
  if (!parsed.ok) throw new RefreshError(parsed.error)

  return { status: 200, etag: res.headers.get('etag'), catalog: parsed.catalog }
}

/**
 * Fetch the remote catalog and persist it when it validates. Never throws:
 * every failure path records the error in the status row and returns
 * `result: 'error'` so callers (the timer and the manual route) share one
 * contract. The previously stored payload is never touched on failure.
 */
export async function refreshRemoteCatalog(opts: RefreshOptions = {}): Promise<RefreshOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => new Date())
  const url = resolveCatalogUrl(opts.env ?? process.env)
  const checkedAt = now().toISOString()
  const empty: CatalogDiff = { added: [], updated: [], removed: [] }

  const writeStatus = async (lastResult: CatalogRefreshResult, lastError: string | null) => {
    const status: StoredCatalogStatus = { lastCheckedAt: checkedAt, lastResult, lastError }
    await setSetting(CATALOG_STATUS_SETTING_KEY, DEFAULT_TENANT_ID, status)
  }

  try {
    const previous = await readStoredRemote()
    // Only reuse the ETag when it was issued for the same URL.
    const etag = previous && previous.url === url ? previous.etag : null
    const fetched = await fetchCatalogDocument(url, etag, fetchImpl)

    if (fetched.status === 304) {
      await writeStatus('unchanged', null)
      return { result: 'unchanged', ...empty, error: null }
    }

    const diff = diffCatalogs(previous?.catalog ?? EMBEDDED_CATALOG, fetched.catalog)
    const changed = diff.added.length + diff.updated.length + diff.removed.length > 0
      || previous?.catalog.updatedAt !== fetched.catalog.updatedAt
      || !previous

    const stored: StoredRemoteCatalog = {
      url,
      etag: fetched.etag,
      fetchedAt: changed ? checkedAt : previous!.fetchedAt,
      catalog: fetched.catalog,
    }
    await setSetting(CATALOG_REMOTE_SETTING_KEY, DEFAULT_TENANT_ID, stored)
    const result: CatalogRefreshResult = changed ? 'updated' : 'unchanged'
    await writeStatus(result, null)
    return { result, ...diff, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await writeStatus('error', message)
    } catch (statusErr) {
      console.error('[catalog] failed to record refresh status:', statusErr)
    }
    return { result: 'error', ...empty, error: message }
  }
}
