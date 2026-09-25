// src/lib/map/basemap.ts
//
// Basemap (tile layer) resolution for the two Leaflet maps of the product:
// the geographic topology view and the vDC datacenter card.
//
// Why this file exists (issue #960): both maps used to point straight at
// CARTO's keyless basemaps. CARTO closed that door and now BAKES an
// "API KEY REQUIRED" watermark into every tile it serves without a key. The
// tile still answers HTTP 200 with a valid PNG, so nothing fails, logs stay
// clean and only the eye catches it.
//
// The shipped default is therefore OpenStreetMap, which needs no key and no
// account. OSM publishes no dark style, so dark mode inverts the tiles with a
// CSS filter instead of switching provider (see DARK_TILE_FILTER). Operators
// who own a key, or who run their own tile server on an air-gapped site, pick
// 'custom' and give their own URL templates.

export type BasemapProvider = 'osm' | 'custom'

export interface BasemapSettings {
  provider: BasemapProvider
  /** Tile URL template used in light mode (and in dark mode when darkUrl is empty). */
  lightUrl: string
  /** Optional dedicated dark tile URL template. Empty = invert the light one. */
  darkUrl: string
  /** Attribution HTML shown in the map corner. Required by most tile providers. */
  attribution: string
}

export const DEFAULT_BASEMAP_SETTINGS: BasemapSettings = {
  provider: 'osm',
  lightUrl: '',
  darkUrl: '',
  attribution: '',
}

// No {s} subdomain: OSM deprecated a/b/c and serves everything from the single
// host over HTTP/2.
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

// Applied to .leaflet-tile-pane only, so markers, popups and controls keep
// their own colours. hue-rotate puts the inverted blues back to blue; the
// brightness/contrast/saturate trim was picked against the product's dark
// background (#25293c) out of four candidates, the lighter ones reading as a
// washed-out light map rather than a dark basemap.
export const DARK_TILE_FILTER = 'invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.92) saturate(0.5)'

export interface ResolvedBasemap {
  url: string
  attribution: string
  /** True when the tiles must be inverted by CSS to read as a dark basemap. */
  darkFilter: boolean
  /**
   * True on an air-gapped instance still pointed at the public OSM tiles:
   * the map would render a grey canvas. The two map components show a
   * message instead (ui#956).
   */
  unavailable: boolean
}

export interface ResolveBasemapOptions {
  offline?: boolean
}

/** Shown by both maps when `unavailable` is set. Hard-coded English, like the neighbouring empty states. */
export const MAP_UNAVAILABLE_OFFLINE =
  'Map tiles are not reachable on an air-gapped instance. Set a custom tile server in Settings > Map.'

/** A usable raster template has the three Leaflet placeholders. */
export function isTileTemplate(url: string): boolean {
  return /\{z\}/.test(url) && /\{x\}/.test(url) && /\{y\}/.test(url)
}

/**
 * Coerce whatever the settings row (or the demo-mode safety net, which answers
 * `{"data":[]}` to routes it does not know) holds into a complete object, so
 * callers never render a map with an undefined URL.
 */
export function normalizeBasemapSettings(raw: unknown): BasemapSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_BASEMAP_SETTINGS }

  const row = raw as Record<string, unknown>
  const str = (key: string) => (typeof row[key] === 'string' ? (row[key] as string).trim() : '')

  return {
    provider: row.provider === 'custom' ? 'custom' : 'osm',
    lightUrl: str('lightUrl'),
    darkUrl: str('darkUrl'),
    attribution: str('attribution'),
  }
}

/**
 * Pick the tile URL and attribution for the current theme.
 *
 * A 'custom' provider with no usable light template falls back to OSM rather
 * than to a blank map: a half-filled form must never cost the operator the
 * whole screen.
 */
export function resolveBasemap(
  settings: BasemapSettings,
  isDark: boolean,
  options: ResolveBasemapOptions = {},
): ResolvedBasemap {
  if (settings.provider === 'custom' && isTileTemplate(settings.lightUrl)) {
    const hasDark = isTileTemplate(settings.darkUrl)

    return {
      url: isDark && hasDark ? settings.darkUrl : settings.lightUrl,
      attribution: settings.attribution,

      // A dedicated dark template is already dark; a single template is not.
      darkFilter: isDark && !hasDark,
      unavailable: false,
    }
  }

  return { url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION, darkFilter: isDark, unavailable: options.offline === true }
}
