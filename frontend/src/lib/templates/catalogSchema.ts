// src/lib/templates/catalogSchema.ts
//
// Pure, client-safe validation and comparison helpers for the cloud image
// catalog. The catalog is one JSON document, shipped embedded in the build
// (src/data/cloudImages.json) and fetched at runtime from the public repo.
// Both go through parseCatalogPayload so the embedded file and the remote
// one obey the same contract.

import { z } from 'zod'

import type { CatalogVendor, CloudImage } from './cloudImages'

export const CATALOG_SCHEMA_VERSION = 1

const httpUrl = z.string().max(1000).refine(
  u => /^https?:\/\/\S+$/i.test(u),
  { message: 'must be an http(s) URL' },
)

export const catalogVendorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(50),
  name: z.string().min(1).max(50),
  icon: z.string().min(1).max(64),
})

export const catalogImageSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, 'slug must be lowercase [a-z0-9.-]').max(64),
  name: z.string().min(1).max(120),
  vendor: z.string().min(1).max(50),
  version: z.string().max(50),
  arch: z.string().min(1).max(20),
  format: z.enum(['qcow2', 'raw', 'vmdk', 'img', 'iso']),
  downloadUrl: httpUrl,
  checksumUrl: httpUrl.nullable(),
  defaultDiskSize: z.string().regex(/^\d+G$/, 'must be like "20G"'),
  minMemory: z.number().int().min(128).max(1048576),
  recommendedMemory: z.number().int().min(128).max(1048576),
  minCores: z.number().int().min(1).max(128),
  recommendedCores: z.number().int().min(1).max(128),
  ostype: z.string().min(1).max(20),
  tags: z.array(z.string().min(1).max(40)).max(20),
  logoIcon: z.string().min(1).max(64),
  // Maintainer notes (build suffix caveats, mirror quirks). Ignored by the UI.
  notes: z.string().max(500).optional(),
})

export const cloudImageCatalogSchema = z.object({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  vendors: z.array(catalogVendorSchema).min(1),
  images: z.array(catalogImageSchema).min(1),
}).superRefine((cat, ctx) => {
  const vendorIds = new Set<string>()
  cat.vendors.forEach((v, i) => {
    if (vendorIds.has(v.id)) {
      ctx.addIssue({ code: 'custom', message: `duplicate vendor id "${v.id}"`, path: ['vendors', i, 'id'] })
    }
    vendorIds.add(v.id)
  })
  const slugs = new Set<string>()
  cat.images.forEach((img, i) => {
    if (slugs.has(img.slug)) {
      ctx.addIssue({ code: 'custom', message: `duplicate slug "${img.slug}"`, path: ['images', i, 'slug'] })
    }
    slugs.add(img.slug)
    if (!vendorIds.has(img.vendor)) {
      ctx.addIssue({ code: 'custom', message: `unknown vendor "${img.vendor}" on image "${img.slug}"`, path: ['images', i, 'vendor'] })
    }
  })
})

export type { CatalogVendor }

/**
 * The catalog document, declared in terms of CloudImage so the schema's
 * inferred type never leaks into consumers (the zod enum for `format` would
 * otherwise clash with the plain `string` CloudImage carries).
 */
export interface CloudImageCatalog {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION
  updatedAt: string
  vendors: CatalogVendor[]
  images: CloudImage[]
}

export type CatalogRefreshResult = 'updated' | 'unchanged' | 'error'

/** Status block returned to the UI next to the catalog listing. */
export interface CatalogMeta {
  source: 'remote' | 'embedded'
  /** `updatedAt` of the catalog currently served. */
  catalogUpdatedAt: string
  /** When the served remote payload was fetched, null when embedded. */
  fetchedAt: string | null
  lastCheckedAt: string | null
  lastResult: CatalogRefreshResult | null
  lastError: string | null
  /** Mirror URL, null for a tenant: it can carry a token or internal topology. */
  url: string | null
  autoUpdate: boolean
}

export interface CatalogDiff {
  added: string[]
  updated: string[]
  removed: string[]
}

// Both arms carry every field: with strictNullChecks off, TypeScript does not
// narrow this union on `res.ok`, so callers read `res.error` on either arm.
export type CatalogParseResult =
  | { ok: true; catalog: CloudImageCatalog; error: null }
  | { ok: false; catalog: null; error: string }

export function parseCatalogPayload(input: unknown): CatalogParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, catalog: null, error: 'catalog payload is not an object' }
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion
  if (typeof version === 'number' && version > CATALOG_SCHEMA_VERSION) {
    return { ok: false, catalog: null, error: `catalog schema version ${version} requires a newer ProxCenter (supported: ${CATALOG_SCHEMA_VERSION})` }
  }
  const parsed = cloudImageCatalogSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path?.length ? ` at ${first.path.join('.')}` : ''
    return { ok: false, catalog: null, error: `invalid catalog${where}: ${first?.message ?? 'unknown error'}` }
  }
  return { ok: true, catalog: parsed.data as CloudImageCatalog, error: null }
}

/**
 * JSON.stringify with sorted object keys. Postgres JSONB does not preserve key
 * order, so a payload read back from the settings table must compare equal to
 * the freshly fetched one when nothing changed.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    // Explicit comparator, and deliberately NOT localeCompare: this ordering
    // has to be identical on every machine that serialises the payload, and a
    // locale-aware collation is not. Code-unit order is the canonical one.
    const entries = Object.keys(value as Record<string, unknown>).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function diffCatalogs(prev: CloudImageCatalog | null, next: CloudImageCatalog): CatalogDiff {
  const prevBySlug = new Map((prev?.images ?? []).map(img => [img.slug, img] as const))
  const nextBySlug = new Map(next.images.map(img => [img.slug, img] as const))
  const added: string[] = []
  const updated: string[] = []
  const removed: string[] = []
  for (const [slug, img] of nextBySlug) {
    const before = prevBySlug.get(slug)
    if (!before) added.push(slug)
    else if (stableStringify(before) !== stableStringify(img)) updated.push(slug)
  }
  for (const slug of prevBySlug.keys()) {
    if (!nextBySlug.has(slug)) removed.push(slug)
  }
  return { added, updated, removed }
}

/**
 * Slug resolution order: remote catalog first, embedded list second. A slug
 * the remote catalog retired must still resolve so an existing blueprint or
 * a deployment retry keeps working.
 */
export function findImageBySlug(
  remote: CloudImageCatalog | null,
  embedded: readonly CloudImage[],
  slug: string,
): CloudImage | undefined {
  const fromRemote = remote?.images.find(img => img.slug === slug)
  if (fromRemote) return fromRemote
  return embedded.find(img => img.slug === slug)
}
