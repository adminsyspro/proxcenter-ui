import { describe, it, expect } from 'vitest'
import { splitCatalogImages, hasMeaningfulCloudInit } from './blueprintImages'
import type { CloudImage } from './cloudImages'

// Helpers to build minimal CloudImage-compatible objects
function img(overrides: Partial<CloudImage & { isCustom?: boolean; isShared?: boolean }> = {}): CloudImage & { isCustom?: boolean; isShared?: boolean } {
  return {
    slug: overrides.slug ?? 'test-image',
    name: overrides.name ?? 'Test Image',
    vendor: overrides.vendor ?? 'test',
    version: overrides.version ?? '1.0',
    arch: overrides.arch ?? 'amd64',
    format: overrides.format ?? 'qcow2',
    downloadUrl: overrides.downloadUrl ?? 'https://example.com/image.img',
    checksumUrl: overrides.checksumUrl ?? null,
    defaultDiskSize: overrides.defaultDiskSize ?? '20G',
    minMemory: overrides.minMemory ?? 512,
    recommendedMemory: overrides.recommendedMemory ?? 2048,
    minCores: overrides.minCores ?? 1,
    recommendedCores: overrides.recommendedCores ?? 2,
    ostype: overrides.ostype ?? 'l26',
    tags: overrides.tags ?? ['cloud-init'],
    logoIcon: overrides.logoIcon ?? 'ri-cloud-line',
    isCustom: overrides.isCustom ?? false,
    isShared: overrides.isShared ?? false,
  }
}

describe('splitCatalogImages', () => {
  it('separates built-in and custom images', () => {
    const builtIn1 = img({ slug: 'ubuntu-2604', isCustom: false })
    const builtIn2 = img({ slug: 'debian-12', isCustom: false })
    const custom1 = img({ slug: 'my-custom-img', isCustom: true })

    const result = splitCatalogImages([builtIn1, builtIn2, custom1])

    expect(result.builtIn).toHaveLength(2)
    expect(result.custom).toHaveLength(1)
    expect(result.builtIn[0].slug).toBe('ubuntu-2604')
    expect(result.builtIn[1].slug).toBe('debian-12')
    expect(result.custom[0].slug).toBe('my-custom-img')
  })

  it('returns empty custom array when there are no custom images', () => {
    const images = [img({ slug: 'ubuntu-2404', isCustom: false }), img({ slug: 'debian-12', isCustom: false })]
    const result = splitCatalogImages(images)

    expect(result.builtIn).toHaveLength(2)
    expect(result.custom).toHaveLength(0)
  })

  it('returns empty builtIn array when there are no built-in images', () => {
    const images = [img({ slug: 'custom-1', isCustom: true }), img({ slug: 'custom-2', isCustom: true })]
    const result = splitCatalogImages(images)

    expect(result.builtIn).toHaveLength(0)
    expect(result.custom).toHaveLength(2)
  })

  it('returns both arrays empty for empty input', () => {
    const result = splitCatalogImages([])
    expect(result.builtIn).toHaveLength(0)
    expect(result.custom).toHaveLength(0)
  })

  it('excludes ISO-format images from both groups', () => {
    const isoBuiltIn = img({ slug: 'windows-iso', format: 'iso', isCustom: false })
    const isoCustom = img({ slug: 'custom-iso', format: 'iso', isCustom: true })
    const cloud = img({ slug: 'ubuntu-2404', format: 'qcow2', isCustom: false })
    const customCloud = img({ slug: 'my-custom', format: 'qcow2', isCustom: true })

    const result = splitCatalogImages([isoBuiltIn, isoCustom, cloud, customCloud])

    expect(result.builtIn).toHaveLength(1)
    expect(result.builtIn[0].slug).toBe('ubuntu-2404')
    expect(result.custom).toHaveLength(1)
    expect(result.custom[0].slug).toBe('my-custom')
  })

  it('is case-insensitive when checking for ISO format', () => {
    const upperIso = img({ slug: 'upper-iso', format: 'ISO', isCustom: false })
    const mixedIso = img({ slug: 'mixed-iso', format: 'Iso', isCustom: true })
    const cloud = img({ slug: 'ubuntu-2404', format: 'qcow2', isCustom: false })

    const result = splitCatalogImages([upperIso, mixedIso, cloud])

    expect(result.builtIn).toHaveLength(1)
    expect(result.custom).toHaveLength(0)
  })

  it('places images with undefined isCustom into the builtIn group', () => {
    // CloudImage (from CLOUD_IMAGES fallback) has no isCustom field; it must not
    // be silently dropped or put into the custom group.
    const plainCloud = img({ slug: 'plain-cloud' }) as CloudImage
    // Strip isCustom to simulate a bare CloudImage coming from the fallback list
    delete (plainCloud as any).isCustom

    const result = splitCatalogImages([plainCloud])

    expect(result.builtIn).toHaveLength(1)
    expect(result.builtIn[0].slug).toBe('plain-cloud')
    expect(result.custom).toHaveLength(0)
  })

  it('preserves the original order within each group', () => {
    const images = [
      img({ slug: 'z-built-in', isCustom: false }),
      img({ slug: 'a-custom', isCustom: true }),
      img({ slug: 'a-built-in', isCustom: false }),
      img({ slug: 'z-custom', isCustom: true }),
    ]

    const result = splitCatalogImages(images)

    expect(result.builtIn.map(i => i.slug)).toEqual(['z-built-in', 'a-built-in'])
    expect(result.custom.map(i => i.slug)).toEqual(['a-custom', 'z-custom'])
  })
})

describe('hasMeaningfulCloudInit', () => {
  const empty = {
    ciuser: '',
    sshKeys: '',
    ipconfig0: 'ip=dhcp',
    nameserver: '',
    searchdomain: '',
  }

  it('returns false for all-default values', () => {
    expect(hasMeaningfulCloudInit(empty)).toBe(false)
  })

  it('returns false when ipconfig0 is empty string', () => {
    expect(hasMeaningfulCloudInit({ ...empty, ipconfig0: '' })).toBe(false)
  })

  it('returns true when ciuser is set', () => {
    expect(hasMeaningfulCloudInit({ ...empty, ciuser: 'ubuntu' })).toBe(true)
  })

  it('returns true when sshKeys is set', () => {
    expect(hasMeaningfulCloudInit({ ...empty, sshKeys: 'ssh-rsa AAAA...' })).toBe(true)
  })

  it('returns true when nameserver is set', () => {
    expect(hasMeaningfulCloudInit({ ...empty, nameserver: '8.8.8.8' })).toBe(true)
  })

  it('returns true when searchdomain is set', () => {
    expect(hasMeaningfulCloudInit({ ...empty, searchdomain: 'example.com' })).toBe(true)
  })

  it('returns true when ipconfig0 is set to a static IP (not dhcp or empty)', () => {
    expect(hasMeaningfulCloudInit({ ...empty, ipconfig0: 'ip=10.0.0.4/24,gw=10.0.0.1' })).toBe(true)
  })

  it('returns false when ipconfig0 is ip=dhcp (the default)', () => {
    expect(hasMeaningfulCloudInit({ ...empty, ipconfig0: 'ip=dhcp' })).toBe(false)
  })

  it('returns true when only one field among several is set', () => {
    expect(hasMeaningfulCloudInit({
      ciuser: '',
      sshKeys: '',
      ipconfig0: 'ip=dhcp',
      nameserver: '1.1.1.1',
      searchdomain: '',
    })).toBe(true)
  })

  it('handles whitespace-only strings as empty (not meaningful)', () => {
    expect(hasMeaningfulCloudInit({ ...empty, ciuser: '   ' })).toBe(false)
    expect(hasMeaningfulCloudInit({ ...empty, sshKeys: '\n' })).toBe(false)
    expect(hasMeaningfulCloudInit({ ...empty, nameserver: '  ' })).toBe(false)
    expect(hasMeaningfulCloudInit({ ...empty, searchdomain: '\t' })).toBe(false)
  })
})
