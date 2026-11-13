import { describe, expect, it } from 'vitest'

import { sanitizeAttribution } from './attribution'
import { OSM_ATTRIBUTION } from './basemap'

describe('sanitizeAttribution', () => {
  it.each([
    ['plain text', 'Internal tiles'],
    ['an entity', '&copy; Internal tiles'],
    ['the OpenStreetMap default', OSM_ATTRIBUTION],
    [
      'several http(s) links',
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="http://tiles.lan/about">Tiles</a>',
    ],
    ['an accented label', 'Données &copy; Région'],
  ])('keeps %s as written', (_label, value) => {
    expect(sanitizeAttribution(value)).toBe(value)
  })

  it('shows any other markup as text', () => {
    expect(sanitizeAttribution('<b>Tiles</b>')).toBe('&lt;b>Tiles&lt;/b>')
    expect(sanitizeAttribution('Tiles <img src="x" onerror="steal()">')).toBe('Tiles &lt;img src="x" onerror="steal()">')
  })

  it('keeps only the href of a link, and its new-tab target', () => {
    expect(sanitizeAttribution(`<a href='https://tiles.lan' onclick="steal()" title="t">Tiles</a>`)).toBe(
      '<a href="https://tiles.lan">Tiles</a>',
    )
    expect(sanitizeAttribution(`<a target="_blank" href="https://tiles.lan" onclick="steal()">Tiles</a>`)).toBe(
      '<a href="https://tiles.lan" target="_blank" rel="noopener noreferrer">Tiles</a>',
    )
  })

  it('shows the markup inside a link as text', () => {
    expect(sanitizeAttribution('<a href="https://tiles.lan"><img src="x">Tiles</a>')).toBe(
      '<a href="https://tiles.lan">&lt;img src="x">Tiles</a>',
    )
  })

  it('shows a link that is not http(s) as text', () => {
    expect(sanitizeAttribution('<a href="javascript:steal()">Tiles</a>')).toBe(
      '&lt;a href="javascript:steal()">Tiles&lt;/a>',
    )
    expect(sanitizeAttribution('<a href="data:text/html,x">Tiles</a>')).toContain('&lt;a href=')
  })

  it('shows an unclosed link as text', () => {
    expect(sanitizeAttribution('<a href="https://tiles.lan">Tiles')).toBe('&lt;a href="https://tiles.lan">Tiles')
  })

  it('keeps ampersands, entities, quotes and > as typed', () => {
    const typed = `Tiles & data &amp; "Lab" l'été &copy &#169; &#xA9; a > b`

    expect(sanitizeAttribution(typed)).toBe(typed)
    expect(sanitizeAttribution('<a href="https://tiles.lan/?a=1&b=2">Tiles</a>')).toBe('<a href="https://tiles.lan/?a=1&b=2">Tiles</a>')
  })

  it('escapes a quote in the href it keeps', () => {
    expect(sanitizeAttribution(`<a href='https://tiles.lan/"x'>Tiles</a>`)).toBe('<a href="https://tiles.lan/&quot;x">Tiles</a>')
  })

  it('gives the same result when applied twice', () => {
    const once = sanitizeAttribution(`<b>x</b> & <a href="https://t.lan/?a=1&b=2" target="_blank">T</a> <a href='https://t.lan/"q'>Q</a> <a href="javascript:x">y</a>`)

    expect(sanitizeAttribution(once)).toBe(once)
  })
})
