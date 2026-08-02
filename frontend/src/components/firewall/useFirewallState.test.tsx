/**
 * Tests for useFirewallState load-failure surfacing (#616).
 *
 * The hook used to swallow every load failure (each fetch had its own
 * `.catch` returning empty data), so a broken backend rendered the same
 * "No data" empty state as a VM with no rules. We mock the API adapter
 * and assert the distinction: a failed rules fetch sets `error` (the
 * consumers render it as a blocking Alert), a failed options/groups
 * fetch degrades the view through the snackbar while keeping the rules,
 * and a genuine empty result stays error-free.
 *
 * next-intl is mocked to echo the key, so fallback messages assert on
 * the translation key (errors.loadingError) rather than a rendered
 * string. No automatic RTL cleanup is configured in this repo, so every
 * render is unmounted explicitly in afterEach.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useFirewallState } from './useFirewallState'
import type { FirewallAPIAdapter } from './types'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const RULE = { pos: 0, type: 'in', action: 'ACCEPT', enable: 1 }

function makeApi(overrides: Partial<FirewallAPIAdapter> = {}): FirewallAPIAdapter {
  return {
    getOptions: vi.fn().mockResolvedValue({ enable: 1 }),
    getRules: vi.fn().mockResolvedValue([RULE]),
    getGroups: vi.fn().mockResolvedValue([{ group: 'webserver' }]),
    updateOptions: vi.fn(),
    addRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    ...overrides,
  }
}

const unmounts: Array<() => void> = []

/** Render the hook and register the unmount for the afterEach cleanup. */
function renderState(api: FirewallAPIAdapter) {
  const rendered = renderHook(() => useFirewallState(api))

  unmounts.push(rendered.unmount)

  return rendered
}

afterEach(() => {
  while (unmounts.length) unmounts.pop()!()
  vi.restoreAllMocks()
})

describe('useFirewallState / loadFirewallData', () => {
  it('sets error when the rules fetch fails, instead of a fake empty state', async () => {
    const api = makeApi({ getRules: vi.fn().mockRejectedValue(new Error('backend down')) })
    const { result } = renderState(api)

    await act(async () => {
      await result.current.loadFirewallData()
    })

    // The consumers early-return on `error`, so the empty state never lies
    expect(result.current.error).toBe('backend down')
    expect(result.current.loading).toBe(false)
  })

  it('falls back to errors.loadingError when the rejection has no message', async () => {
    const api = makeApi({ getRules: vi.fn().mockRejectedValue('nope') })
    const { result } = renderState(api)

    await act(async () => {
      await result.current.loadFirewallData()
    })

    expect(result.current.error).toBe('errors.loadingError')
  })

  it('keeps the rules and reports through the snackbar when only groups fail', async () => {
    const api = makeApi({ getGroups: vi.fn().mockRejectedValue(new Error('groups unavailable')) })
    const { result } = renderState(api)

    await act(async () => {
      await result.current.loadFirewallData()
    })

    // Rules loaded fine and must stay visible: no blocking error
    expect(result.current.error).toBeNull()
    expect(result.current.rules).toEqual([RULE])
    expect(result.current.options).toEqual({ enable: 1 })

    // The degraded catalogue is surfaced non-blockingly
    expect(result.current.snackbar).toEqual({ open: true, message: 'groups unavailable', severity: 'error' })
  })

  it('keeps the rules and reports through the snackbar when only options fail', async () => {
    const api = makeApi({ getOptions: vi.fn().mockRejectedValue(new Error('options unavailable')) })
    const { result } = renderState(api)

    await act(async () => {
      await result.current.loadFirewallData()
    })

    expect(result.current.error).toBeNull()
    expect(result.current.rules).toEqual([RULE])
    expect(result.current.availableGroups).toEqual([{ group: 'webserver' }])
    expect(result.current.snackbar).toEqual({ open: true, message: 'options unavailable', severity: 'error' })
  })

  it('shows no error when PVE genuinely returns no rules', async () => {
    const api = makeApi({ getRules: vi.fn().mockResolvedValue([]), getGroups: vi.fn().mockResolvedValue([]) })
    const { result } = renderState(api)

    await act(async () => {
      await result.current.loadFirewallData()
    })

    // Legitimate empty state: no error, no snackbar
    expect(result.current.error).toBeNull()
    expect(result.current.rules).toEqual([])
    expect(result.current.snackbar.open).toBe(false)
    expect(result.current.loading).toBe(false)
  })
})

describe('useFirewallState / loadRulesOnly', () => {
  it('surfaces a refresh failure without blanking the rules already loaded', async () => {
    const getRules = vi.fn().mockResolvedValue([RULE])
    const api = makeApi({ getRules })
    const { result } = renderState(api)

    await act(async () => {
      await result.current.loadFirewallData()
    })

    expect(result.current.rules).toEqual([RULE])

    getRules.mockRejectedValue(new Error('refresh failed'))

    await act(async () => {
      await result.current.loadRulesOnly()
    })

    // The rules on screen are kept, the failure is not silent anymore
    expect(result.current.rules).toEqual([RULE])
    expect(result.current.error).toBeNull()
    expect(result.current.snackbar).toEqual({ open: true, message: 'refresh failed', severity: 'error' })
  })
})
