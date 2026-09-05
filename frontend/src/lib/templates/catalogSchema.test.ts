import { describe, it, expect } from 'vitest'

import {
  CATALOG_SCHEMA_VERSION,
  parseCatalogPayload,
  diffCatalogs,
  findImageBySlug,
  stableStringify,
  type CloudImageCatalog,
} from './catalogSchema'
import type { CloudImage } from './cloudImages'

function image(overrides: Partial<CloudImage> = {}): CloudImage {
  return {
    slug: 'ubuntu-2404',
    name: 'Ubuntu 24.04 LTS',
    vendor: 'ubuntu',
    version: '24.04',
    arch: 'amd64',
    format: 'qcow2',
    downloadUrl: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
    checksumUrl: 'https://cloud-images.ubuntu.com/noble/current/SHA256SUMS',
    defaultDiskSize: '20G',
    minMemory: 512,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['lts', 'cloud-init'],
    logoIcon: 'ri-ubuntu-fill',
    ...overrides,
  }
}

function catalog(overrides: Partial<CloudImageCatalog> = {}): CloudImageCatalog {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    updatedAt: '2026-09-05',
    vendors: [{ id: 'ubuntu', name: 'Ubuntu', icon: 'ri-ubuntu-fill' }],
    images: [image()],
    ...overrides,
  }
}

describe('parseCatalogPayload', () => {
  it('accepts a valid catalog and returns it typed', () => {
    const res = parseCatalogPayload(catalog())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.catalog.images[0].slug).toBe('ubuntu-2404')
  })

  it('accepts an optional notes field on an image', () => {
    const res = parseCatalogPayload(catalog({ images: [image({ notes: 'build suffix may change' })] }))
    expect(res.ok).toBe(true)
  })

  it('rejects a non-object payload', () => {
    expect(parseCatalogPayload(null).ok).toBe(false)
    expect(parseCatalogPayload('nope').ok).toBe(false)
  })

  it('rejects a newer schema version with a dedicated message', () => {
    const res = parseCatalogPayload({ ...catalog(), schemaVersion: 2 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/newer ProxCenter/)
  })

  it('rejects an invalid updatedAt', () => {
    expect(parseCatalogPayload(catalog({ updatedAt: '05/09/2026' })).ok).toBe(false)
  })

  it('rejects a slug with uppercase or spaces', () => {
    expect(parseCatalogPayload(catalog({ images: [image({ slug: 'Ubuntu 24' })] })).ok).toBe(false)
  })

  it('rejects duplicate slugs', () => {
    const res = parseCatalogPayload(catalog({ images: [image(), image()] }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/duplicate slug/i)
  })

  it('rejects duplicate vendor ids', () => {
    const res = parseCatalogPayload(catalog({
      vendors: [
        { id: 'ubuntu', name: 'Ubuntu', icon: 'ri-ubuntu-fill' },
        { id: 'ubuntu', name: 'Ubuntu again', icon: 'ri-ubuntu-fill' },
      ],
    }))
    expect(res.ok).toBe(false)
  })

  it('rejects an image whose vendor is not declared', () => {
    const res = parseCatalogPayload(catalog({ images: [image({ vendor: 'debian' })] }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/unknown vendor/i)
  })

  it('rejects a non-http download URL and accepts a null checksum URL', () => {
    expect(parseCatalogPayload(catalog({ images: [image({ downloadUrl: 'ftp://x/y.qcow2' })] })).ok).toBe(false)
    expect(parseCatalogPayload(catalog({ images: [image({ checksumUrl: null })] })).ok).toBe(true)
  })

  it('rejects a bad disk size, a non-integer memory and an unknown format', () => {
    expect(parseCatalogPayload(catalog({ images: [image({ defaultDiskSize: '20' })] })).ok).toBe(false)
    expect(parseCatalogPayload(catalog({ images: [image({ minMemory: 512.5 })] })).ok).toBe(false)
    expect(parseCatalogPayload(catalog({ images: [image({ format: 'vhdx' })] })).ok).toBe(false)
  })

  it('rejects an empty image list', () => {
    expect(parseCatalogPayload(catalog({ images: [] })).ok).toBe(false)
  })
})

describe('stableStringify', () => {
  it('is independent of key order', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }))
  })
})

describe('diffCatalogs', () => {
  it('reports every image as added when there is no previous catalog', () => {
    const diff = diffCatalogs(null, catalog())
    expect(diff).toEqual({ added: ['ubuntu-2404'], updated: [], removed: [] })
  })

  it('reports added, updated and removed slugs', () => {
    const prev = catalog({
      images: [image(), image({ slug: 'debian-11', name: 'Debian 11', vendor: 'ubuntu' })],
    })
    const next = catalog({
      images: [
        image({ downloadUrl: 'https://cloud-images.ubuntu.com/noble/current/other.img' }),
        image({ slug: 'debian-13', name: 'Debian 13', vendor: 'ubuntu' }),
      ],
    })
    expect(diffCatalogs(prev, next)).toEqual({ added: ['debian-13'], updated: ['ubuntu-2404'], removed: ['debian-11'] })
  })

  it('ignores key order when deciding whether an image changed', () => {
    const prev = catalog()
    const reordered = JSON.parse(JSON.stringify(prev)) as CloudImageCatalog
    const img = reordered.images[0] as unknown as Record<string, unknown>
    const swapped = Object.fromEntries(Object.entries(img).reverse()) as unknown as CloudImage
    reordered.images = [swapped]
    expect(diffCatalogs(prev, reordered)).toEqual({ added: [], updated: [], removed: [] })
  })
})

describe('findImageBySlug', () => {
  const embedded = [image({ slug: 'debian-11', name: 'Debian 11 embedded', vendor: 'ubuntu' }), image({ name: 'Ubuntu embedded' })]

  it('prefers the remote catalog over the embedded list', () => {
    const remote = catalog({ images: [image({ name: 'Ubuntu remote' })] })
    expect(findImageBySlug(remote, embedded, 'ubuntu-2404')?.name).toBe('Ubuntu remote')
  })

  it('falls back to the embedded list for a slug the remote catalog retired', () => {
    const remote = catalog({ images: [image({ name: 'Ubuntu remote' })] })
    expect(findImageBySlug(remote, embedded, 'debian-11')?.name).toBe('Debian 11 embedded')
  })

  it('uses the embedded list when there is no remote catalog and returns undefined for unknown slugs', () => {
    expect(findImageBySlug(null, embedded, 'ubuntu-2404')?.name).toBe('Ubuntu embedded')
    expect(findImageBySlug(null, embedded, 'nope')).toBeUndefined()
  })
})
