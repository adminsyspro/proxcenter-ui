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
    links.push(created)
  }

  const stock: StockIcon[] = links.map(link => ({
    link,
    href: link.getAttribute('href'),
    type: link.getAttribute('type'),
    sizes: link.getAttribute('sizes'),
  }))

  for (const { link } of stock) {
    link.setAttribute('href', url)
    link.removeAttribute('sizes')

    if (type) link.setAttribute('type', type)
    else link.removeAttribute('type')
  }

  return () => {
    if (created) {
      created.remove()

      return
    }

    for (const entry of stock) {
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
