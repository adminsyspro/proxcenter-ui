// frontend/src/lib/console/viewport.ts
//
// Shared viewport logic for the two graphical console pages
// (public/novnc/console.html and public/spice/console.html): scaling mode
// persistence, guest-resolution maths for an agent-driven resize, fit
// scaling, fullscreen helpers and the send-key combos.
//
// Those pages are plain static HTML served outside Next (they must load the
// noVNC / spice-html5 IIFE bundles), so they cannot import from src/. They
// consume this file through `node bundle-console.js`, which esbuilds it into
// public/console/console-ui.bundle.js and exposes it as `window.ConsoleUI`.
// Keeping the logic here rather than inline in the pages is what makes it
// unit-testable.

/**
 * The three scaling modes, deliberately named like the upstream Proxmox
 * noVNC `resize` setting (novnc-pve 1.6.0 maps `resizeSession` to
 * `getSetting('resize') === 'remote'`), so behaviour matches what an
 * operator already knows from the Proxmox console:
 *
 * - `off`    the guest framebuffer is shown 1:1 and clipped/scrolled.
 * - `scale`  the framebuffer is scaled to fit the window, guest untouched.
 * - `remote` the guest is asked to change its resolution to the window size.
 */
export type ScalingMode = 'off' | 'scale' | 'remote'

export const SCALING_MODES: readonly ScalingMode[] = ['off', 'scale', 'remote']

/** Same default as before this feature existed: scale locally, never touch the guest. */
export const DEFAULT_SCALING_MODE: ScalingMode = 'scale'

export type ConsoleKind = 'novnc' | 'spice'

/**
 * One key per console kind. `remote` needs guest support that differs per
 * protocol (a VNC server advertising ExtendedDesktopSize vs a running
 * spice-vdagent), so a mode that works in one console is not evidence it
 * works in the other and the two must not share a preference.
 */
export function scalingStorageKey(kind: ConsoleKind): string {
  return `proxcenter.console.scaling.${kind}`
}

export function parseScalingMode(raw: unknown, fallback: ScalingMode = DEFAULT_SCALING_MODE): ScalingMode {
  return SCALING_MODES.includes(raw as ScalingMode) ? (raw as ScalingMode) : fallback
}

/** The subset of the Web Storage API we need, so tests can pass a stub. */
export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Reads the persisted mode. Every access is guarded: a console opened in a
 * private window, or with site data blocked, throws on `localStorage` access
 * itself, and a console that cannot open is a worse outcome than a forgotten
 * preference.
 */
export function loadScalingMode(storage: StorageLike | null | undefined, kind: ConsoleKind): ScalingMode {
  try {
    return parseScalingMode(storage?.getItem(scalingStorageKey(kind)))
  } catch {
    return DEFAULT_SCALING_MODE
  }
}

/** Returns whether the preference was actually persisted. */
export function saveScalingMode(storage: StorageLike | null | undefined, kind: ConsoleKind, mode: ScalingMode): boolean {
  try {
    storage?.setItem(scalingStorageKey(kind), parseScalingMode(mode))

    return Boolean(storage)
  } catch {
    return false
  }
}

/** noVNC RFB flags for a mode. `clipViewport` pans instead of squeezing when unscaled. */
export function rfbFlagsForScalingMode(mode: ScalingMode): {
  scaleViewport: boolean
  resizeSession: boolean
  clipViewport: boolean
} {
  const parsed = parseScalingMode(mode)

  return {
    scaleViewport: parsed === 'scale',
    resizeSession: parsed === 'remote',
    clipViewport: parsed !== 'scale',
  }
}

// A guest display device rejects sizes it cannot allocate, and X.Org wants
// both dimensions on an 8-pixel boundary (the upstream spice-html5
// resize_helper rounds down for exactly that reason).
export const GUEST_SIZE_ALIGNMENT = 8
export const MIN_GUEST_WIDTH = 320
export const MIN_GUEST_HEIGHT = 200
export const MAX_GUEST_DIMENSION = 8192

/**
 * Turns a container size in CSS pixels into a resolution to request from the
 * guest agent. Returns null when the container is too small or not measurable
 * yet (a hidden or zero-height area during layout), which the caller must
 * treat as "do not send a resize" rather than as a size.
 */
export function computeGuestResolution(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null

  const align = (value: number) => Math.floor(value / GUEST_SIZE_ALIGNMENT) * GUEST_SIZE_ALIGNMENT

  const w = Math.min(align(width), MAX_GUEST_DIMENSION)
  const h = Math.min(align(height), MAX_GUEST_DIMENSION)

  if (w < MIN_GUEST_WIDTH || h < MIN_GUEST_HEIGHT) return null

  return { width: w, height: h }
}

export type Size = { width: number; height: number }

/**
 * Scale factor to fit `source` inside `container` while keeping the aspect
 * ratio. spice-html5 draws the guest framebuffer at its native size into a
 * canvas and has no scaler of its own, so the SPICE page applies this as a
 * CSS transform. Returns 1 when nothing is measurable, and never upscales
 * unless asked (blowing a 640x480 text console up to 4K is not readable).
 */
export function computeFitScale(source: Size, container: Size, opts: { allowUpscale?: boolean } = {}): number {
  const { width: sw, height: sh } = source
  const { width: cw, height: ch } = container

  if (![sw, sh, cw, ch].every(v => Number.isFinite(v) && v > 0)) return 1

  const scale = Math.min(cw / sw, ch / sh)

  if (!opts.allowUpscale && scale > 1) return 1

  return scale
}

// --- Fullscreen -----------------------------------------------------------
// The pages target the browsers ProxCenter supports, but the console is also
// the one page users open in whatever is installed on a hypervisor jump host,
// so the WebKit and legacy MS spellings are honoured too.

type FullscreenDocument = {
  fullscreenElement?: Element | null
  webkitFullscreenElement?: Element | null
  msFullscreenElement?: Element | null
  exitFullscreen?: () => unknown
  webkitExitFullscreen?: () => unknown
  msExitFullscreen?: () => unknown
}

type FullscreenElement = {
  requestFullscreen?: (options?: unknown) => unknown
  webkitRequestFullscreen?: () => unknown
  msRequestFullscreen?: () => unknown
}

export function fullscreenElement(doc: FullscreenDocument | null | undefined): Element | null {
  if (!doc) return null

  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null
}

export function isFullscreen(doc: FullscreenDocument | null | undefined): boolean {
  return Boolean(fullscreenElement(doc))
}

export function fullscreenSupported(el: FullscreenElement | null | undefined): boolean {
  return Boolean(el && (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen))
}

/**
 * Enters or leaves fullscreen and returns the state we asked for (true =
 * entering). The request is fire-and-forget: a rejected promise only means
 * the gesture was not accepted, and there is nothing useful to tell the user
 * beyond the button not latching.
 */
export function toggleFullscreen(
  doc: FullscreenDocument | null | undefined,
  el: FullscreenElement | null | undefined
): boolean {
  if (isFullscreen(doc)) {
    const exit = doc?.exitFullscreen ?? doc?.webkitExitFullscreen ?? doc?.msExitFullscreen

    exit?.call(doc)

    return false
  }

  const request = el?.requestFullscreen ?? el?.webkitRequestFullscreen ?? el?.msRequestFullscreen

  if (!request) return false

  const result = request.call(el) as unknown

  if (result && typeof (result as Promise<void>).catch === 'function') {
    ;(result as Promise<void>).catch(() => {})
  }

  return true
}

// --- Send key combos ------------------------------------------------------
// X11 keysyms, the alphabet noVNC's sendKey() speaks. Ctrl+Alt+Fn is how you
// reach a Linux text console, Ctrl+Esc opens the Windows start menu, and
// neither can be typed in the browser: the host desktop swallows them.

export const KEYSYM = {
  ControlLeft: 0xffe3,
  AltLeft: 0xffe9,
  Escape: 0xff1b,
  Tab: 0xff09,
  Backspace: 0xff08,
  Delete: 0xffff,
  F1: 0xffbe,
} as const

export type KeyStroke = { keysym: number; code: string }

export type KeyCombo = { id: string; label: string; strokes: KeyStroke[] }

function combo(id: string, label: string, ...strokes: KeyStroke[]): KeyCombo {
  return { id, label, strokes }
}

const CTRL: KeyStroke = { keysym: KEYSYM.ControlLeft, code: 'ControlLeft' }
const ALT: KeyStroke = { keysym: KEYSYM.AltLeft, code: 'AltLeft' }

/**
 * F1..F12 are contiguous from F1, so the table is generated rather than
 * typed out twelve times.
 */
function functionKeyCombos(): KeyCombo[] {
  return Array.from({ length: 12 }, (_, i) => {
    const n = i + 1

    return combo(`ctrl-alt-f${n}`, `Ctrl+Alt+F${n}`, CTRL, ALT, { keysym: KEYSYM.F1 + i, code: `F${n}` })
  })
}

export const KEY_COMBOS: readonly KeyCombo[] = [
  combo('ctrl-alt-del', 'Ctrl+Alt+Del', CTRL, ALT, { keysym: KEYSYM.Delete, code: 'Delete' }),
  combo('ctrl-alt-backspace', 'Ctrl+Alt+Backspace', CTRL, ALT, { keysym: KEYSYM.Backspace, code: 'Backspace' }),
  combo('ctrl-esc', 'Ctrl+Esc', CTRL, { keysym: KEYSYM.Escape, code: 'Escape' }),
  combo('alt-tab', 'Alt+Tab', ALT, { keysym: KEYSYM.Tab, code: 'Tab' }),
  ...functionKeyCombos(),
]

export function findKeyCombo(id: string): KeyCombo | null {
  return KEY_COMBOS.find(c => c.id === id) ?? null
}

/**
 * Expands a combo into the ordered sendKey calls a VNC server expects: every
 * key pressed in order, then released in reverse, so the modifiers frame the
 * final key and nothing stays latched in the guest.
 */
export function keyComboSequence(id: string): { keysym: number; code: string; down: boolean }[] {
  const found = findKeyCombo(id)

  if (!found) return []

  const down = found.strokes.map(s => ({ ...s, down: true }))
  const up = [...found.strokes].reverse().map(s => ({ ...s, down: false }))

  return [...down, ...up]
}

// --- Misc -----------------------------------------------------------------

/**
 * Trailing-edge debounce. Resizing a window fires a continuous stream of
 * events and every one of them would otherwise be a resolution change
 * request to the guest, which is both slow and visibly ugly.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null

  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delayMs)
  }

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return wrapped
}
