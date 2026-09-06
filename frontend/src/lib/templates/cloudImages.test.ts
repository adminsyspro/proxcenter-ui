import { describe, it, expect } from 'vitest'

import catalogJson from '@/data/cloudImages.json'
import { parseCatalogPayload } from './catalogSchema'
import { CLOUD_IMAGES, VENDORS, EMBEDDED_CATALOG, EMBEDDED_CATALOG_UPDATED_AT, getImageBySlug, getImagesByVendor } from './cloudImages'

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
