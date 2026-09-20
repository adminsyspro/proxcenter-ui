// src/app ships BOTH favicon.ico and icon.svg, so Next renders two icon links,
// in that order:
//   <link rel="icon" href="/favicon.ico?…" sizes="48x48" type="image/x-icon">
//   <link rel="icon" href="/icon.svg?…"    sizes="any"   type="image/svg+xml">
// Browsers keep the SVG (declared last, and preferred because it scales), so
// repointing the first match alone left the stock icon in the tab and the
// white-label one loaded by nobody. Every icon link has to follow, and the
// stock type/sizes have to go with them, or a PNG upload is announced as a
// 48x48 image/x-icon.

const ICON_LINK_SELECTOR = "link[rel~='icon']"

// An uploaded favicon keeps the extension it was stored under (see the branding
// uploads route), and the stock tags carry a type of their own, so the type has
// to be recomputed rather than inherited.
const FAVICON_MIME_TYPES: Record<string, string> = {
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

export function faviconMimeType(url: string): string {
  // The upload route appends a cache-buster, so the extension is never last.
  // No dot at all leaves `path` whole, which matches nothing in the table.
  const path = url.split('?')[0]
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()

  return FAVICON_MIME_TYPES[ext] ?? ''
}

interface StockIcon {
  link: HTMLLinkElement
  href: string | null
  type: string | null
  sizes: string | null
}

/**
 * Point every icon link at `url`, and return the undo. The tags are mutated
 * rather than replaced because they belong to Next's rendered metadata, and
 * removing them from under React turns a cosmetic bug into a crash on
 * navigation. The undo puts the stock icons back, so clearing the upload or
 * switching to a tenant without one does not leave the previous icon in the
 * tab until the next hard reload.
 *
 * Browser-only: the single caller is a React effect, which never runs on the
 * server, so there is no `typeof document` guard to keep honest here.
 */
export function applyFavicon(url: string): () => void {
  const type = faviconMimeType(url)
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>(ICON_LINK_SELECTOR))

  let created: HTMLLinkElement | null = null

  if (links.length === 0) {
    created = document.createElement('link')
    created.rel = 'icon'
    document.head.appendChild(created)
  }

  const stock = new Map<HTMLLinkElement, StockIcon>()
  const attributes = ['href', 'type', 'sizes'] as const
  const branded = { href: url, type: type || null, sizes: null }
  let stopped = false

  const rememberMetadataChanges = (records: MutationRecord[]) => {
    for (const record of records) {
      if (record.type !== 'attributes') continue
      const link = record.target as HTMLLinkElement
      const entry = stock.get(link)
      const name = record.attributeName as typeof attributes[number]

      // Metadata can update a link in place. Keep the latest stock value for
      // cleanup, rather than restoring the value from an earlier navigation.
      if (entry && link !== created) entry[name] = link.getAttribute(name)
    }
  }

  const applyToLinks = () => {
    // Next replaces its icon links on navigation: forget the detached ones so
    // the map does not grow for the observer's lifetime, and so cleanup never
    // writes attributes onto nodes that left the document.
    for (const link of stock.keys()) {
      if (!link.isConnected && link !== created) stock.delete(link)
    }
    for (const link of document.querySelectorAll<HTMLLinkElement>(ICON_LINK_SELECTOR)) {
      if (!stock.has(link)) {
        stock.set(link, {
          link,
          href: link.getAttribute('href'),
          type: link.getAttribute('type'),
          sizes: link.getAttribute('sizes'),
        })
      }
      for (const name of attributes) {
        if (link.getAttribute(name) !== branded[name]) restoreAttribute(link, name, branded[name])
      }
    }
  }

  const observe = () => observer.observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [...attributes],
  })
  const observer = new MutationObserver(records => {
    rememberMetadataChanges(records)
    // Our own attribute writes must not become metadata changes or schedule
    // another observer pass. Next remains free to insert or replace its links.
    observer.disconnect()
    applyToLinks()
    observe()
  })

  applyToLinks()
  observe()

  return () => {
    if (stopped) return
    stopped = true
    rememberMetadataChanges(observer.takeRecords())
    observer.disconnect()
    created?.remove()

    for (const entry of stock.values()) {
      if (entry.link === created || !entry.link.isConnected) continue
      restoreAttribute(entry.link, 'href', entry.href)
      restoreAttribute(entry.link, 'type', entry.type)
      restoreAttribute(entry.link, 'sizes', entry.sizes)
    }
  }
}

function restoreAttribute(link: HTMLLinkElement, name: string, value: string | null): void {
  if (value === null) link.removeAttribute(name)
  else link.setAttribute(name, value)
}
