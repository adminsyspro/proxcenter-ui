// frontend/src/lib/console/viewport.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SCALING_MODE,
  GUEST_SIZE_ALIGNMENT,
  KEY_COMBOS,
  MAX_GUEST_DIMENSION,
  SCALING_MODES,
  computeFitScale,
  computeGuestResolution,
  debounce,
  findKeyCombo,
  fullscreenElement,
  fullscreenSupported,
  isFullscreen,
  keyComboSequence,
  loadScalingMode,
  parseScalingMode,
  rfbFlagsForScalingMode,
  saveScalingMode,
  scalingStorageKey,
  toggleFullscreen,
  VM_ACTIONS,
  parseVmStatus,
  vmActionsEnabled,
} from './viewport'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))

  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('scaling mode', () => {
  it('keeps a per-console-kind storage key so a mode is never inherited across protocols', () => {
    expect(scalingStorageKey('novnc')).toBe('proxcenter.console.scaling.novnc')
    expect(scalingStorageKey('spice')).toBe('proxcenter.console.scaling.spice')
    expect(scalingStorageKey('novnc')).not.toBe(scalingStorageKey('spice'))
  })

  it('accepts the three known modes and falls back on anything else', () => {
    for (const mode of SCALING_MODES) expect(parseScalingMode(mode)).toBe(mode)

    expect(parseScalingMode('scaledown')).toBe(DEFAULT_SCALING_MODE)
    expect(parseScalingMode(null)).toBe(DEFAULT_SCALING_MODE)
    expect(parseScalingMode(undefined)).toBe(DEFAULT_SCALING_MODE)
    expect(parseScalingMode(42)).toBe(DEFAULT_SCALING_MODE)
    expect(parseScalingMode('off', 'remote')).toBe('off')
    expect(parseScalingMode('nope', 'remote')).toBe('remote')
  })

  it('defaults to local scaling, the behaviour the console had before the setting existed', () => {
    expect(DEFAULT_SCALING_MODE).toBe('scale')
    expect(loadScalingMode(fakeStorage(), 'novnc')).toBe('scale')
  })

  it('round-trips a stored mode', () => {
    const storage = fakeStorage()

    expect(saveScalingMode(storage, 'spice', 'remote')).toBe(true)
    expect(storage.map.get('proxcenter.console.scaling.spice')).toBe('remote')
    expect(loadScalingMode(storage, 'spice')).toBe('remote')
    // ... and the other console is unaffected.
    expect(loadScalingMode(storage, 'novnc')).toBe('scale')
  })

  it('never persists a bogus mode', () => {
    const storage = fakeStorage()

    saveScalingMode(storage, 'novnc', 'sideways' as never)
    expect(storage.map.get('proxcenter.console.scaling.novnc')).toBe('scale')
  })

  it('survives a storage that throws (private window, site data blocked)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }

    expect(loadScalingMode(throwing, 'novnc')).toBe(DEFAULT_SCALING_MODE)
    expect(saveScalingMode(throwing, 'novnc', 'off')).toBe(false)
  })

  it('survives a missing storage object', () => {
    expect(loadScalingMode(null, 'novnc')).toBe(DEFAULT_SCALING_MODE)
    expect(loadScalingMode(undefined, 'spice')).toBe(DEFAULT_SCALING_MODE)
    expect(saveScalingMode(null, 'novnc', 'off')).toBe(false)
  })

  it('maps each mode to the matching noVNC RFB flags', () => {
    expect(rfbFlagsForScalingMode('scale')).toEqual({ scaleViewport: true, resizeSession: false, clipViewport: false })
    expect(rfbFlagsForScalingMode('remote')).toEqual({ scaleViewport: false, resizeSession: true, clipViewport: true })
    expect(rfbFlagsForScalingMode('off')).toEqual({ scaleViewport: false, resizeSession: false, clipViewport: true })
  })

  it('never sets scaleViewport and resizeSession together', () => {
    for (const mode of SCALING_MODES) {
      const flags = rfbFlagsForScalingMode(mode)

      expect(flags.scaleViewport && flags.resizeSession).toBe(false)
    }
  })
})

describe('computeGuestResolution', () => {
  it('rounds both dimensions down to an 8-pixel boundary', () => {
    expect(computeGuestResolution(1917, 1075)).toEqual({ width: 1912, height: 1072 })
    expect(computeGuestResolution(1920, 1080)).toEqual({ width: 1920, height: 1080 })

    const r = computeGuestResolution(1279, 799)

    expect(r!.width % GUEST_SIZE_ALIGNMENT).toBe(0)
    expect(r!.height % GUEST_SIZE_ALIGNMENT).toBe(0)
  })

  it('never rounds up, so the guest screen always fits the window', () => {
    const r = computeGuestResolution(1000, 700)!

    expect(r.width).toBeLessThanOrEqual(1000)
    expect(r.height).toBeLessThanOrEqual(700)
  })

  it('clamps to a size a display device can allocate', () => {
    const r = computeGuestResolution(20000, 20000)!

    expect(r.width).toBe(MAX_GUEST_DIMENSION)
    expect(r.height).toBe(MAX_GUEST_DIMENSION)
  })

  it('returns null rather than a size when the container is unusable', () => {
    // A hidden or not-yet-laid-out area: sending 0x0 to the agent would black
    // out the guest screen.
    expect(computeGuestResolution(0, 0)).toBeNull()
    expect(computeGuestResolution(1024, 0)).toBeNull()
    expect(computeGuestResolution(200, 600)).toBeNull()
    expect(computeGuestResolution(600, 100)).toBeNull()
    expect(computeGuestResolution(Number.NaN, 600)).toBeNull()
    expect(computeGuestResolution(Number.POSITIVE_INFINITY, 600)).toBeNull()
  })
})

describe('computeFitScale', () => {
  it('fits on the limiting axis and keeps the aspect ratio', () => {
    // 1920x1080 guest in a 960x1000 area: width is the constraint.
    expect(computeFitScale({ width: 1920, height: 1080 }, { width: 960, height: 1000 })).toBeCloseTo(0.5)
    // Same guest in a 1900x540 area: height is the constraint.
    expect(computeFitScale({ width: 1920, height: 1080 }, { width: 1900, height: 540 })).toBeCloseTo(0.5)
  })

  it('does not upscale by default, and does when asked', () => {
    expect(computeFitScale({ width: 640, height: 480 }, { width: 1920, height: 1080 })).toBe(1)
    expect(
      computeFitScale({ width: 640, height: 480 }, { width: 1920, height: 1080 }, { allowUpscale: true })
    ).toBeCloseTo(2.25)
  })

  it('falls back to 1 when a dimension is not measurable', () => {
    expect(computeFitScale({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(1)
    expect(computeFitScale({ width: 800, height: 600 }, { width: 0, height: 600 })).toBe(1)
    expect(computeFitScale({ width: 800, height: 600 }, { width: Number.NaN, height: 600 })).toBe(1)
  })
})

describe('fullscreen helpers', () => {
  it('reads the fullscreen element through every vendor spelling', () => {
    const el = {} as Element

    expect(fullscreenElement({ fullscreenElement: el })).toBe(el)
    expect(fullscreenElement({ webkitFullscreenElement: el })).toBe(el)
    expect(fullscreenElement({ msFullscreenElement: el })).toBe(el)
    expect(fullscreenElement({ fullscreenElement: null })).toBeNull()
    expect(fullscreenElement(null)).toBeNull()
    expect(isFullscreen({ fullscreenElement: el })).toBe(true)
    expect(isFullscreen({})).toBe(false)
  })

  it('detects support', () => {
    expect(fullscreenSupported({ requestFullscreen: () => {} })).toBe(true)
    expect(fullscreenSupported({ webkitRequestFullscreen: () => {} })).toBe(true)
    expect(fullscreenSupported({})).toBe(false)
    expect(fullscreenSupported(null)).toBe(false)
  })

  it('enters fullscreen and reports the state it asked for', () => {
    const requestFullscreen = vi.fn()
    const el = { requestFullscreen }

    expect(toggleFullscreen({}, el)).toBe(true)
    expect(requestFullscreen).toHaveBeenCalledOnce()
  })

  it('leaves fullscreen when already in it, without requesting again', () => {
    const exitFullscreen = vi.fn()
    const requestFullscreen = vi.fn()

    expect(toggleFullscreen({ fullscreenElement: {} as Element, exitFullscreen }, { requestFullscreen })).toBe(false)
    expect(exitFullscreen).toHaveBeenCalledOnce()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('uses the vendor-prefixed exit when that is all there is', () => {
    const webkitExitFullscreen = vi.fn()

    toggleFullscreen({ webkitFullscreenElement: {} as Element, webkitExitFullscreen }, {})
    expect(webkitExitFullscreen).toHaveBeenCalledOnce()
  })

  it('swallows a rejected request instead of leaving an unhandled rejection', async () => {
    const el = { requestFullscreen: () => Promise.reject(new Error('not allowed')) }

    expect(toggleFullscreen({}, el)).toBe(true)
    await Promise.resolve()
  })

  it('reports false when fullscreen is not available at all', () => {
    expect(toggleFullscreen({}, {})).toBe(false)
    expect(toggleFullscreen(null, null)).toBe(false)
  })
})

describe('key combos', () => {
  it('offers Ctrl+Alt+Del plus the twelve virtual consoles', () => {
    const ids = KEY_COMBOS.map(c => c.id)

    expect(ids).toContain('ctrl-alt-del')
    expect(ids).toContain('ctrl-alt-f1')
    expect(ids).toContain('ctrl-alt-f12')
    expect(ids.filter(id => /^ctrl-alt-f\d+$/.test(id))).toHaveLength(12)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('numbers the function keysyms contiguously from F1', () => {
    expect(findKeyCombo('ctrl-alt-f1')!.strokes.at(-1)).toEqual({ keysym: 0xffbe, code: 'F1' })
    expect(findKeyCombo('ctrl-alt-f12')!.strokes.at(-1)).toEqual({ keysym: 0xffc9, code: 'F12' })
  })

  it('presses in order then releases in reverse, so no modifier stays latched', () => {
    expect(keyComboSequence('ctrl-alt-del')).toEqual([
      { keysym: 0xffe3, code: 'ControlLeft', down: true },
      { keysym: 0xffe9, code: 'AltLeft', down: true },
      { keysym: 0xffff, code: 'Delete', down: true },
      { keysym: 0xffff, code: 'Delete', down: false },
      { keysym: 0xffe9, code: 'AltLeft', down: false },
      { keysym: 0xffe3, code: 'ControlLeft', down: false },
    ])
  })

  it('presses and releases every key of every combo', () => {
    for (const c of KEY_COMBOS) {
      const seq = keyComboSequence(c.id)

      expect(seq).toHaveLength(c.strokes.length * 2)
      expect(seq.filter(s => s.down)).toHaveLength(c.strokes.length)
    }
  })

  it('returns an empty sequence for an unknown combo instead of throwing', () => {
    expect(findKeyCombo('ctrl-alt-f99')).toBeNull()
    expect(keyComboSequence('nope')).toEqual([])
  })
})

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs once on the trailing edge with the last arguments', () => {
    const fn = vi.fn()
    const d = debounce(fn, 200)

    d(1)
    d(2)
    d(3)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(199)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('can be cancelled, so a closing console sends no resize', () => {
    const fn = vi.fn()
    const d = debounce(fn, 200)

    d()
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
    // Cancelling twice, or with nothing pending, is a no-op.
    d.cancel()
  })
})

describe('VM power actions', () => {
  it('exposes the four toolbar actions in display order', () => {
    expect(VM_ACTIONS).toEqual(['start', 'shutdown', 'stop', 'suspend'])
  })

  it('normalises the status reported by the guest API', () => {
    expect(parseVmStatus('running')).toBe('running')
    expect(parseVmStatus('stopped')).toBe('stopped')
    expect(parseVmStatus('paused')).toBe('paused')
    expect(parseVmStatus('prelaunch')).toBe('unknown')
    expect(parseVmStatus(undefined)).toBe('unknown')
    expect(parseVmStatus(null)).toBe('unknown')
    expect(parseVmStatus(42)).toBe('unknown')
  })

  it('offers shutdown and pause only while the guest runs, and start only while it does not', () => {
    expect(vmActionsEnabled('running')).toEqual({ start: false, shutdown: true, stop: true, suspend: true })
    expect(vmActionsEnabled('stopped')).toEqual({ start: true, shutdown: false, stop: false, suspend: false })
  })

  it('lets a paused guest be resumed with start or killed with stop', () => {
    expect(vmActionsEnabled('paused')).toEqual({ start: true, shutdown: false, stop: true, suspend: false })
  })

  it('keeps the recovery actions reachable when the status is unknown', () => {
    // A status fetch that failed must not lock the operator out of the
    // console: start and stop stay available, the graceful ones do not.
    expect(vmActionsEnabled('unknown')).toEqual({ start: true, shutdown: false, stop: true, suspend: false })
    expect(vmActionsEnabled('whatever' as never)).toEqual(vmActionsEnabled('unknown'))
  })
})
