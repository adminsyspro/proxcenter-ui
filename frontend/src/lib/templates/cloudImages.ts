// src/lib/templates/cloudImages.ts
// Catalog of certified cloud images for Proxmox cloud-init deployment.
//
// The data lives in src/data/cloudImages.json: that file is the embedded
// catalog shipped with the build AND the document fetched at runtime from
// the public repo by lib/templates/catalogStore.ts. Everything exported here
// is the embedded view, safe to import from client components as the
// offline fallback. Server code that wants the up-to-date view goes through
// catalogStore (getEffectiveCatalog / resolveBuiltInImage).

import catalogJson from '@/data/cloudImages.json'

import type { CloudImageCatalog } from './catalogSchema'

export interface CloudImage {
  slug: string
  name: string
  vendor: string
  version: string
  arch: string
  format: string
  downloadUrl: string
  checksumUrl: string | null
  defaultDiskSize: string // e.g. "20G"
  minMemory: number // MB
  recommendedMemory: number // MB
  minCores: number
  recommendedCores: number
  ostype: string // PVE ostype: l26, win10, etc.
  tags: string[]
  logoIcon: string // RemixIcon class
  /** Maintainer notes carried by the catalog file, never shown in the UI. */
  notes?: string
  /**
   * Resolved from the mirror at refresh time by catalogBuilds.ts and merged in
   * by getEffectiveCatalog, never present in the catalog document: publication
   * date (YYYY-MM-DD) of the file a rolling download URL points at today, and
   * the vendor's point release when it publishes one.
   */
  buildDate?: string | null
  release?: string | null
}

export interface CatalogVendor {
  id: string
  name: string
  /**
   * RemixIcon class used by the vendor filter chips. Distros without a native
   * RemixIcon glyph (Alpine, Arch) get a generic cloud icon; VendorLogo loads
   * the real SVG from /images/vendors/ when one exists.
   */
  icon: string
}

/** The embedded catalog document, validated by cloudImages.test.ts in CI. */
export const EMBEDDED_CATALOG = catalogJson as CloudImageCatalog

export const EMBEDDED_CATALOG_UPDATED_AT: string = EMBEDDED_CATALOG.updatedAt

export const VENDORS: readonly CatalogVendor[] = EMBEDDED_CATALOG.vendors

export const CLOUD_IMAGES: CloudImage[] = EMBEDDED_CATALOG.images

export function getImageBySlug(slug: string): CloudImage | undefined {
  return CLOUD_IMAGES.find(img => img.slug === slug)
}

export function getImagesByVendor(vendor: string): CloudImage[] {
  return CLOUD_IMAGES.filter(img => img.vendor === vendor)
}

/** Convert a CustomImage DB record into a CloudImage-compatible object */
export function customImageToCloudImage(ci: {
  slug: string
  name: string
  vendor: string
  version: string
  arch: string
  format: string
  sourceType: string
  downloadUrl: string | null
  checksumUrl: string | null
  volumeId: string | null
  defaultDiskSize: string
  minMemory: number
  recommendedMemory: number
  minCores: number
  recommendedCores: number
  ostype: string
  tags: string | null
  isShared?: boolean | null
}): CloudImage & { sourceType: string; volumeId: string | null; isCustom: true; isShared?: boolean } {
  return {
    slug: ci.slug,
    name: ci.name,
    vendor: ci.vendor,
    version: ci.version,
    arch: ci.arch,
    format: ci.format,
    downloadUrl: ci.downloadUrl || '',
    checksumUrl: ci.checksumUrl || null,
    defaultDiskSize: ci.defaultDiskSize,
    minMemory: ci.minMemory,
    recommendedMemory: ci.recommendedMemory,
    minCores: ci.minCores,
    recommendedCores: ci.recommendedCores,
    ostype: ci.ostype,
    tags: ci.tags ? ci.tags.split(';').filter(Boolean) : ['custom'],
    logoIcon: VENDORS.find(v => v.id === ci.vendor)?.icon || 'ri-image-line',
    sourceType: ci.sourceType,
    volumeId: ci.volumeId,
    isCustom: true,
    isShared: !!ci.isShared,
  }
}
