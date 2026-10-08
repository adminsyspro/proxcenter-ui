import { describe, it, expect } from 'vitest'

import catalogJson from '@/data/cloudImages.json'
import { parseCatalogPayload } from './catalogSchema'
import { CLOUD_IMAGES, VENDORS, EMBEDDED_CATALOG, EMBEDDED_CATALOG_UPDATED_AT, customImageToCloudImage, getImageBySlug, getImagesByVendor } from './cloudImages'

// The remote refresh reads this exact file from the main branch of the public
// repo, so a malformed edit would reach every installation within a day. This
// test is the gate: the JSON must satisfy the same schema the runtime enforces.
describe('src/data/cloudImages.json', () => {
  it('is a valid catalog payload', () => {
    const res = parseCatalogPayload(catalogJson)
    expect(res.ok, res.ok ? '' : res.error).toBe(true)
  })

  it('keeps the historical built-in slugs so existing blueprints still resolve', () => {
    const slugs = CLOUD_IMAGES.map(i => i.slug)
    for (const slug of [
      'ubuntu-2604', 'ubuntu-2404', 'ubuntu-2204',
      'debian-13', 'debian-12', 'debian-11',
      'rocky-10', 'rocky-9', 'alma-10', 'alma-9',
      'centos-stream-10', 'centos-stream-9',
      'fedora-43', 'opensuse-leap-156', 'alpine-321', 'arch-rolling',
    ]) {
      expect(slugs, `missing slug ${slug}`).toContain(slug)
    }
  })

  it('declares the ten historical vendors', () => {
    expect(VENDORS.map(v => v.id)).toEqual([
      'ubuntu', 'debian', 'rocky', 'alma', 'fedora', 'opensuse', 'alpine', 'arch', 'centos', 'freebsd',
    ])
  })
})

describe('embedded catalog accessors', () => {
  it('exposes the catalog date and the parsed document', () => {
    expect(EMBEDDED_CATALOG_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(EMBEDDED_CATALOG.images).toBe(CLOUD_IMAGES)
  })

  it('getImageBySlug and getImagesByVendor read the embedded list', () => {
    expect(getImageBySlug('debian-12')?.vendor).toBe('debian')
    expect(getImageBySlug('nope')).toBeUndefined()
    expect(getImagesByVendor('ubuntu').map(i => i.slug)).toEqual(['ubuntu-2604', 'ubuntu-2404', 'ubuntu-2204'])
  })
})

describe('customImageToCloudImage clusters (#44)', () => {
  const row = {
    slug: 'custom-golden', name: 'Golden', vendor: 'custom', version: '', arch: 'amd64', format: 'qcow2',
    downloadUrl: null, checksumUrl: null, volumeId: 'local:import/g.qcow2', defaultDiskSize: '20G',
    minMemory: 512, recommendedMemory: 2048, minCores: 1, recommendedCores: 2, ostype: 'l26', tags: null,
  }

  it('lists the source cluster then every valid copy for a volume image', () => {
    const img = customImageToCloudImage({
      ...row, sourceType: 'volume', sourceConnectionId: 'c-prod',
      extraLocations: [{ connectionId: 'c-dr' }, { node: 'x' }, null, 'junk'],
    })
    expect(img.connectionIds).toEqual(['c-prod', 'c-dr'])
  })

  it('carries no list for a URL image, which deploys anywhere', () => {
    expect(customImageToCloudImage({ ...row, sourceType: 'url', sourceConnectionId: null }).connectionIds).toBeUndefined()
  })
})
