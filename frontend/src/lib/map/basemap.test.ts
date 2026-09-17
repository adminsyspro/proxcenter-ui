import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BASEMAP_SETTINGS,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  isTileTemplate,
  normalizeBasemapSettings,
  resolveBasemap,
} from './basemap'

describe('basemap settings normalisation', () => {
  it('falls back to the OSM default on anything that is not an object', () => {
    for (const raw of [null, undefined, 'osm', 42, []]) {
      expect(normalizeBasemapSettings(raw)).toEqual(DEFAULT_BASEMAP_SETTINGS)
    }
  })

  it('keeps a stored custom configuration and trims the strings', () => {
    expect(
      normalizeBasemapSettings({
        provider: 'custom',
        lightUrl: '  https://tiles.lan/{z}/{x}/{y}.png  ',
        darkUrl: '',
        attribution: ' Internal tiles ',
      }),
    ).toEqual({
      provider: 'custom',
      lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
      darkUrl: '',
      attribution: 'Internal tiles',
    })
  })

  it('treats an unknown provider as OSM rather than trusting the row', () => {
    expect(normalizeBasemapSettings({ provider: 'carto' }).provider).toBe('osm')
  })
})

describe('tile template detection', () => {
  it('requires the three Leaflet placeholders', () => {
    expect(isTileTemplate('https://tiles.lan/{z}/{x}/{y}.png')).toBe(true)
    expect(isTileTemplate('https://tiles.lan/{z}/{x}.png')).toBe(false)
    expect(isTileTemplate('https://tiles.lan/preview.png')).toBe(false)
  })
})

describe('basemap resolution', () => {
  it('serves OSM in both themes by default, inverted in dark (issue #960)', () => {
    const light = resolveBasemap(DEFAULT_BASEMAP_SETTINGS, false)
    const dark = resolveBasemap(DEFAULT_BASEMAP_SETTINGS, true)

    expect(light).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION, darkFilter: false })
    expect(dark).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION, darkFilter: true })
  })

  it('never points at a keyless CARTO basemap, which is watermarked', () => {
    for (const isDark of [false, true]) {
      expect(resolveBasemap(DEFAULT_BASEMAP_SETTINGS, isDark).url).not.toContain('cartocdn')
    }
  })

  it('inverts the single custom template when no dark one is given', () => {
    const settings = normalizeBasemapSettings({
      provider: 'custom',
      lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
      attribution: 'Internal tiles',
    })

    expect(resolveBasemap(settings, true)).toEqual({
      url: 'https://tiles.lan/{z}/{x}/{y}.png',
      attribution: 'Internal tiles',
      darkFilter: true,
    })
  })

  it('uses a dedicated dark template as-is, without the CSS filter', () => {
    const settings = normalizeBasemapSettings({
      provider: 'custom',
      lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
      darkUrl: 'https://tiles.lan/dark/{z}/{x}/{y}.png',
      attribution: 'Internal tiles',
    })

    expect(resolveBasemap(settings, true)).toEqual({
      url: 'https://tiles.lan/dark/{z}/{x}/{y}.png',
      attribution: 'Internal tiles',
      darkFilter: false,
    })
  })

  it('falls back to OSM when the custom template cannot draw tiles', () => {
    const settings = normalizeBasemapSettings({ provider: 'custom', lightUrl: 'https://tiles.lan/preview.png' })

    expect(resolveBasemap(settings, false).url).toBe(OSM_TILE_URL)
  })
})
