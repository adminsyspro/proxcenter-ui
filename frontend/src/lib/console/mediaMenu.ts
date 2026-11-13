/**
 * The CD/DVD menu of the console toolbars (#1309): a button in the toolbar
 * and a panel under it, one line per optical drive (slot, ISO picker, Eject).
 * Shared by the noVNC and SPICE pages so both bars behave the same.
 */
import {
  EMPTY_MEDIA,
  MediaChangeError,
  applyConsoleMedia,
  isoFileName,
  loadConsoleMedia,
  mediaOptionGroups,
  slotLabel,
  type ConsoleMediaState,
  type ConsoleOpticalDrive,
  type FetchLike,
  type GuestRef,
} from './media'

export const PHYSICAL_MEDIA = 'cdrom'

const STYLE_ID = 'pxc-media-style'

const CSS = `
.pxc-media-host { position: relative; }
.pxc-media-btn { display: inline-flex; align-items: center; gap: 5px; }
.pxc-media-btn svg { flex-shrink: 0; }
.pxc-media-panel {
  position: absolute; top: 100%; z-index: 30; margin-top: 4px;
  width: 480px; max-width: calc(100vw - 16px); padding: 10px 12px;
  background: #18181b; border: 1px solid #3f3f46; border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); color: #e4e4e7; font-size: 12px;
}
.pxc-media-panel[hidden] { display: none; }
.pxc-media-title { font-weight: 600; margin-bottom: 8px; color: #fff; }
.pxc-media-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.pxc-media-slot { width: 52px; flex-shrink: 0; color: #a1a1aa; white-space: nowrap; }
.pxc-media-row select { flex: 1; min-width: 0; max-width: none; }
.pxc-media-row button { flex-shrink: 0; }
.pxc-media-status { margin-top: 8px; color: #a1a1aa; min-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pxc-media-status.error { color: #fca5a5; }
.pxc-media-status.ok { color: #86efac; }
`

const SVG_NS = 'http://www.w3.org/2000/svg'

function discIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg')

  for (const [k, v] of [['width', '14'], ['height', '14'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['aria-hidden', 'true']]) {
    svg.setAttribute(k, v)
  }

  for (const r of ['9', '2.5']) {
    const circle = doc.createElementNS(SVG_NS, 'circle')

    circle.setAttribute('cx', '12')
    circle.setAttribute('cy', '12')
    circle.setAttribute('r', r)
    svg.appendChild(circle)
  }

  return svg
}

export type MediaMenuOptions = {
  doc: Document
  /** Element the button goes into, as its first child. */
  container: HTMLElement
  /** Positioning parent of the panel, normally the toolbar. */
  host: HTMLElement
  ref: GuestRef
  fetchFn: FetchLike
  /** Called when the panel closes, to hand the keyboard back to the guest. */
  onClose?: () => void
}

export type MediaMenu = {
  button: HTMLButtonElement
  panel: HTMLDivElement
  open: () => Promise<void>
  close: () => void
  isOpen: () => boolean
  destroy: () => void
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')

  style.id = STYLE_ID
  style.textContent = CSS
  doc.head.appendChild(style)
}

function currentValue(drive: ConsoleOpticalDrive): string {
  if (drive.kind === 'physical') return PHYSICAL_MEDIA
  if (drive.kind === 'empty') return EMPTY_MEDIA

  return drive.volid as string
}

/** Mounts the menu, or returns null for a guest without optical drives (LXC). */
export function mountMediaMenu(opts: MediaMenuOptions): MediaMenu | null {
  const { doc, container, host, ref, fetchFn, onClose } = opts

  if (ref.type !== 'qemu') return null

  ensureStyle(doc)
  host.classList.add('pxc-media-host')

  const button = doc.createElement('button')

  button.type = 'button'
  button.className = 'pxc-media-btn'
  button.title = 'CD/DVD drive: mount or eject an ISO image'
  button.setAttribute('aria-haspopup', 'dialog')
  button.setAttribute('aria-expanded', 'false')
  const caption = doc.createElement('span')

  caption.textContent = 'ISO'
  button.append(discIcon(doc), caption)
  container.insertBefore(button, container.firstChild)

  const panel = doc.createElement('div')

  panel.className = 'pxc-media-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'CD/DVD drives')
  panel.hidden = true
  host.appendChild(panel)

  const title = doc.createElement('div')

  title.className = 'pxc-media-title'
  title.textContent = 'CD/DVD drives'

  const rows = doc.createElement('div')
  const status = doc.createElement('div')

  status.className = 'pxc-media-status'
  status.setAttribute('role', 'status')
  panel.append(title, rows, status)

  let state: ConsoleMediaState | null = null
  let loadToken = 0
  let busy = false

  function setStatus(text: string, tone: '' | 'error' | 'ok' = ''): void {
    status.textContent = text
    status.className = tone ? `pxc-media-status ${tone}` : 'pxc-media-status'
  }

  function position(): void {
    const b = button.getBoundingClientRect()
    const h = host.getBoundingClientRect()

    panel.style.left = `${Math.max(0, b.left - h.left)}px`
    panel.style.right = ''
    // Keep the panel inside the window when the button sits near its right edge.
    const p = panel.getBoundingClientRect()
    const view = doc.defaultView?.innerWidth ?? 0

    if (view && p.right > view - 8) {
      panel.style.left = ''
      panel.style.right = '8px'
    }
  }

  function buildSelect(drive: ConsoleOpticalDrive, current: ConsoleMediaState): HTMLSelectElement {
    const select = doc.createElement('select')

    select.setAttribute('aria-label', `${slotLabel(drive.slot)} medium`)
    // The toolbar caps its own selects by id; ISO names need the panel's width.
    select.style.maxWidth = 'none'
    select.dataset.slot = drive.slot

    const empty = doc.createElement('option')

    empty.value = EMPTY_MEDIA
    empty.textContent = '(no media)'
    select.appendChild(empty)

    if (drive.kind === 'physical') {
      const phys = doc.createElement('option')

      phys.value = PHYSICAL_MEDIA
      phys.textContent = 'Host CD/DVD drive'
      select.appendChild(phys)
    }

    for (const group of mediaOptionGroups(drive, current.storages)) {
      if (group.images.length === 0) continue
      const og = doc.createElement('optgroup')

      og.label = group.storage
      for (const image of group.images) {
        const opt = doc.createElement('option')

        opt.value = image.volid
        opt.textContent = image.name
        og.appendChild(opt)
      }

      select.appendChild(og)
    }

    select.value = currentValue(drive)

    return select
  }

  function render(current: ConsoleMediaState): void {
    rows.replaceChildren()

    if (current.drives.length === 0) {
      const none = doc.createElement('div')

      none.textContent = 'This VM has no CD/DVD drive. Add one from its Hardware tab.'
      rows.appendChild(none)

      return
    }

    if (!current.storages.some(s => s.images.length > 0)) {
      setStatus('No ISO image available on this node.')
    }

    for (const drive of current.drives) {
      const row = doc.createElement('div')

      row.className = 'pxc-media-row'

      const label = doc.createElement('span')

      label.className = 'pxc-media-slot'
      label.textContent = slotLabel(drive.slot)

      const select = buildSelect(drive, current)
      const eject = doc.createElement('button')

      eject.type = 'button'
      eject.textContent = 'Eject'
      // Nothing to eject from an empty drive, whatever re-enables the row later.
      if (drive.kind === 'empty') eject.dataset.empty = '1'
      eject.disabled = drive.kind === 'empty'
      select.addEventListener('change', () => { void change(drive, select.value) })
      eject.addEventListener('click', () => { void change(drive, EMPTY_MEDIA) })
      row.append(label, select, eject)
      rows.appendChild(row)
    }
  }

  function setControlsDisabled(disabled: boolean): void {
    rows.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('select, button').forEach(el => {
      el.disabled = disabled || el.dataset.empty === '1'
    })
  }

  async function load(): Promise<void> {
    const token = ++loadToken

    try {
      const next = await loadConsoleMedia(fetchFn, ref)

      if (token !== loadToken) return
      state = next
      render(next)
    } catch (err) {
      if (token !== loadToken) return
      rows.replaceChildren()
      setStatus(`Cannot read the drives: ${(err as Error).message}`, 'error')
    }
  }

  async function change(drive: ConsoleOpticalDrive, volume: string): Promise<void> {
    if (busy || !state || volume === currentValue(drive) || volume === PHYSICAL_MEDIA) return
    busy = true
    setControlsDisabled(true)
    const what = slotLabel(drive.slot)

    setStatus(volume === EMPTY_MEDIA ? `Ejecting ${what}...` : `Mounting ${isoFileName(volume)}...`)

    try {
      await applyConsoleMedia(fetchFn, ref, state, drive, volume)
      await load()
      setStatus(volume === EMPTY_MEDIA ? `${what} ejected` : `${isoFileName(volume)} mounted in ${what}`, 'ok')
    } catch (err) {
      // Re-read so the select shows what the drive really holds.
      await load()
      setStatus(
        err instanceof MediaChangeError && err.status === 409
          ? 'The VM changed meanwhile: drives re-read, choose again.'
          : (err as Error).message,
        'error',
      )
    } finally {
      // load() rebuilt the rows with live controls; this only covers a failed re-read.
      busy = false
      setControlsDisabled(false)
    }
  }

  function isOpen(): boolean {
    return !panel.hidden
  }

  async function open(): Promise<void> {
    panel.hidden = false
    button.classList.add('active')
    button.setAttribute('aria-expanded', 'true')
    rows.replaceChildren()
    setStatus('Loading...')
    position()
    await load()
    if (status.textContent === 'Loading...') setStatus('')
    position()
  }

  function close(): void {
    if (panel.hidden) return
    loadToken++
    panel.hidden = true
    button.classList.remove('active')
    button.setAttribute('aria-expanded', 'false')
    onClose?.()
  }

  function onButton(): void {
    if (isOpen()) close()
    else void open()
  }

  function onPointerDown(e: Event): void {
    const target = e.target as Node | null

    if (!isOpen() || !target) return
    if (panel.contains(target) || button.contains(target)) return
    close()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && isOpen()) close()
  }

  button.addEventListener('click', onButton)
  doc.addEventListener('mousedown', onPointerDown, true)
  doc.addEventListener('keydown', onKey)

  return {
    button,
    panel,
    open,
    close,
    isOpen,
    destroy() {
      doc.removeEventListener('mousedown', onPointerDown, true)
      doc.removeEventListener('keydown', onKey)
      button.remove()
      panel.remove()
    },
  }
}
