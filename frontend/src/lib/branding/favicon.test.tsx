import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { applyFavicon as applyFaviconEffect, faviconMimeType } from './favicon'

const undoEffects: Array<() => void> = []
const applyFavicon = (url: string) => {
  const undo = applyFaviconEffect(url)
  undoEffects.push(undo)
  return undo
}

afterEach(() => {
  for (const undo of undoEffects.splice(0).reverse()) undo()
})

// What Next actually renders for this tree, verified against the running app:
// src/app ships both favicon.ico and icon.svg, so there are two icon links and
// the browser keeps the SVG one.
const appendIcon = (attributes: Record<string, string>) => {
  const link = document.createElement('link')

  link.rel = 'icon'
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value)
  document.head.appendChild(link)
}

const renderStockIcons = () => {
  appendIcon({ href: '/favicon.ico?favicon.00623ddsq5-0w.ico', sizes: '48x48', type: 'image/x-icon' })
  appendIcon({ href: '/icon.svg?icon.18odtp5qriroz.svg', sizes: 'any', type: 'image/svg+xml' })
}

const iconLinks = () =>
  Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']")).map(link => ({
    href: link.getAttribute('href'),
    type: link.getAttribute('type'),
    sizes: link.getAttribute('sizes'),
  }))

beforeEach(() => {
  document.head.replaceChildren()
})

describe('faviconMimeType', () => {
  it.each([
    ['/api/v1/settings/branding/uploads/favicon.png', 'image/png'],
    ['/api/v1/settings/branding/uploads/favicon.ico', 'image/x-icon'],
    ['/api/v1/settings/branding/uploads/favicon.svg', 'image/svg+xml'],
    ['/api/v1/settings/branding/uploads/favicon.webp', 'image/webp'],
    ['/api/v1/settings/branding/uploads/favicon.jpg', 'image/jpeg'],
    ['/api/v1/settings/branding/uploads/favicon.jpeg', 'image/jpeg'],
  ])('maps %s to %s', (url, expected) => {
    expect(faviconMimeType(url)).toBe(expected)
  })

  // The upload route appends a cache-buster, so the extension is never last.
  it('ignores the cache-busting query string', () => {
    expect(faviconMimeType('/api/v1/settings/branding/uploads/favicon.png?t=1789044068491')).toBe('image/png')
    expect(faviconMimeType('/api/v1/settings/branding/uploads/FAVICON.PNG?t=1')).toBe('image/png')
  })

  it('gives no type to an unknown or absent extension', () => {
    expect(faviconMimeType('/uploads/favicon.bmp')).toBe('')
    expect(faviconMimeType('/uploads/favicon')).toBe('')
  })
})

describe('applyFavicon', () => {
  it('repoints EVERY icon link, not just the first one', () => {
    renderStockIcons()

    applyFavicon('/api/v1/settings/branding/uploads/favicon.png?t=1')

    // The bug this fixes: only the .ico used to follow, and the browser reads
    // the .svg, so the stock icon stayed in the tab.
    expect(iconLinks()).toEqual([
      { href: '/api/v1/settings/branding/uploads/favicon.png?t=1', type: 'image/png', sizes: null },
      { href: '/api/v1/settings/branding/uploads/favicon.png?t=1', type: 'image/png', sizes: null },
    ])
  })

  it('drops a type it cannot infer rather than leaving the stock one', () => {
    renderStockIcons()

    applyFavicon('/uploads/favicon.bmp')

    expect(iconLinks().every(link => link.type === null)).toBe(true)
  })

  it('creates a single icon link when the document has none', () => {
    applyFavicon('/uploads/favicon.svg')

    expect(iconLinks()).toEqual([{ href: '/uploads/favicon.svg', type: 'image/svg+xml', sizes: null }])
  })

  it('restores the stock icons, attribute for attribute, when undone', () => {
    renderStockIcons()
    const stock = iconLinks()

    const undo = applyFavicon('/uploads/favicon.png')

    expect(iconLinks()).not.toEqual(stock)

    undo()

    expect(iconLinks()).toEqual(stock)
  })

  it('removes the link it created when undone', () => {
    const undo = applyFavicon('/uploads/favicon.png')

    expect(iconLinks()).toHaveLength(1)

    undo()

    expect(iconLinks()).toHaveLength(0)
  })

  it('survives a stock link that carries no type or sizes at all', () => {
    appendIcon({ href: '/favicon.ico' })

    const undo = applyFavicon('/uploads/favicon.png')

    expect(iconLinks()).toEqual([{ href: '/uploads/favicon.png', type: 'image/png', sizes: null }])

    undo()

    expect(iconLinks()).toEqual([{ href: '/favicon.ico', type: null, sizes: null }])
  })
})


describe('favicon metadata arriving after the branding effect', () => {
  it('repoints late stock links and restores them while removing only its own link', async () => {
    const undo = applyFavicon('/tenant-a.png')
    renderStockIcons()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(iconLinks()).toEqual([
      { href: '/tenant-a.png', type: 'image/png', sizes: null },
      { href: '/tenant-a.png', type: 'image/png', sizes: null },
      { href: '/tenant-a.png', type: 'image/png', sizes: null },
    ])
    undo()
    expect(iconLinks()).toEqual([
      { href: '/favicon.ico?favicon.00623ddsq5-0w.ico', type: 'image/x-icon', sizes: '48x48' },
      { href: '/icon.svg?icon.18odtp5qriroz.svg', type: 'image/svg+xml', sizes: 'any' },
    ])
  })

  it('follows replacement metadata across tenant changes and stops observing on reset', async () => {
    renderStockIcons()
    const undoA = applyFavicon('/tenant-a.png')
    document.head.replaceChildren()
    appendIcon({ href: '/replacement.svg', type: 'image/svg+xml', sizes: 'any' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(iconLinks()).toEqual([{ href: '/tenant-a.png', type: 'image/png', sizes: null }])
    undoA()
    const undoB = applyFavicon('/tenant-b.webp')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(iconLinks()).toEqual([{ href: '/tenant-b.webp', type: 'image/webp', sizes: null }])
    undoB()
    appendIcon({ href: '/late-after-reset.ico' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(iconLinks()).toEqual([
      { href: '/replacement.svg', type: 'image/svg+xml', sizes: 'any' },
      { href: '/late-after-reset.ico', type: null, sizes: null },
    ])
  })

  it('preserves a metadata update still queued when cleanup runs', () => {
    renderStockIcons()
    const undo = applyFavicon('/tenant-a.png')
    const link = document.head.querySelector('link')!
    link.setAttribute('href', '/next-stock.ico')
    undo()
    expect(link.getAttribute('href')).toBe('/next-stock.ico')
    expect(link.getAttribute('type')).toBe('image/x-icon')
    expect(link.getAttribute('sizes')).toBe('48x48')
  })

  it('reapplies branding when metadata rewrites an existing link and restores the new stock values', async () => {
    renderStockIcons()
    const undo = applyFavicon('/tenant-a.png')
    const link = document.head.querySelector('link')!
    link.setAttribute('href', '/updated-stock.ico')
    link.setAttribute('type', 'image/x-icon')
    link.setAttribute('sizes', '32x32')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(link.getAttribute('href')).toBe('/tenant-a.png')
    undo()
    expect(link.getAttribute('href')).toBe('/updated-stock.ico')
    expect(link.getAttribute('type')).toBe('image/x-icon')
    expect(link.getAttribute('sizes')).toBe('32x32')
  })
})
