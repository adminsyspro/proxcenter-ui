// src/lib/map/attribution.ts
//
// The basemap attribution is set by a tenant admin and drawn by Leaflet as
// HTML in the corner of every map of the tenant (roadmap#229). What tile
// providers ask for is text, entities such as &copy; and links to their
// terms, so that is what goes through: an <a> keeps its http(s) href (and a
// new-tab target when it had one), any other tag is shown as text.
//
// Only `<` can open markup in text, and only `"` can leave a double-quoted
// attribute value: those are the two characters escaped, so everything else
// the admin typed (&, entities, quotes, accents) reads back unchanged in the
// settings form.

/** Refused above this length by PUT /api/v1/settings/map: a credit line, not a page. */
export const MAX_ATTRIBUTION_LENGTH = 2000

const LINK = /<a\s([^>]*)>([\s\S]*?)<\/a\s*>/gi
const HREF = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i
const NEW_TAB = /(?:^|\s)target\s*=\s*["']?_blank\b/i

const escapeText = (s: string) => s.replaceAll('<', '&lt;')
const escapeAttribute = (s: string) => s.replaceAll('"', '&quot;')

function httpHref(attributes: string): string | null {
  const m = HREF.exec(attributes)
  const href = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim()

  if (!/^https?:\/\//i.test(href)) return null

  try {
    const url = new URL(href)

    return url.protocol === 'http:' || url.protocol === 'https:' ? href : null
  } catch {
    return null
  }
}

export function sanitizeAttribution(raw: string): string {
  let out = ''
  let last = 0

  for (const m of raw.matchAll(LINK)) {
    const href = httpHref(m[1])

    if (!href) continue
    const target = NEW_TAB.test(m[1]) ? ' target="_blank" rel="noopener noreferrer"' : ''

    out += escapeText(raw.slice(last, m.index)) + `<a href="${escapeAttribute(href)}"${target}>${escapeText(m[2])}</a>`
    last = m.index + m[0].length
  }

  return out + escapeText(raw.slice(last))
}
