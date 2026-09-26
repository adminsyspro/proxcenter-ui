import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BASEMAP_SETTINGS,
  MAP_UNAVAILABLE_OFFLINE,
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

    expect(light).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION, darkFilter: false, unavailable: false })
    expect(dark).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION, darkFilter: true, unavailable: false })
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
      unavailable: false,
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
      unavailable: false,
    })
  })

  it('falls back to OSM when the custom template cannot draw tiles', () => {
    const settings = normalizeBasemapSettings({ provider: 'custom', lightUrl: 'https://tiles.lan/preview.png' })

    expect(resolveBasemap(settings, false).url).toBe(OSM_TILE_URL)
  })
})

describe('resolveBasemap on an air-gapped instance', () => {
  it('flags the OSM default as unavailable', () => {
    const r = resolveBasemap(DEFAULT_BASEMAP_SETTINGS, false, { offline: true })
    expect(r.unavailable).toBe(true)
    expect(r.url).toBe(OSM_TILE_URL)
  })

  it('keeps a custom internal tile server usable', () => {
    const r = resolveBasemap(
      { provider: 'custom', lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png', darkUrl: '', attribution: 'Internal' },
      true,
      { offline: true },
    )
    expect(r.unavailable).toBe(false)
    expect(r.url).toBe('https://tiles.lan/{z}/{x}/{y}.png')
  })

  it('treats a custom provider with a broken template like OSM, hence unavailable', () => {
    const r = resolveBasemap({ provider: 'custom', lightUrl: 'nope', darkUrl: '', attribution: '' }, false, { offline: true })
    expect(r.unavailable).toBe(true)
  })

  it('points the offline message at the card that actually holds the setting', () => {
    expect(MAP_UNAVAILABLE_OFFLINE).toBe(
      'Map tiles are not reachable on an air-gapped instance. Set a custom tile server in Settings > Appearance (Map basemap).',
    )
  })

  it('is never unavailable on a connected instance', () => {
    expect(resolveBasemap(DEFAULT_BASEMAP_SETTINGS, false).unavailable).toBe(false)
    expect(resolveBasemap(DEFAULT_BASEMAP_SETTINGS, false, {}).unavailable).toBe(false)
  })
})
