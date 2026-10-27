import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getSetting: vi.fn(), setSetting: vi.fn() }))

vi.mock('@/lib/db/settings', () => ({
  getSetting: (...a: unknown[]) => m.getSetting(...a),
  setSetting: (...a: unknown[]) => m.setSetting(...a),
}))

import { getDefaultTarget, parseSettingsBody, setDefaultTarget } from './settings'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('default target', () => {
  it('reads the provider row, 99.9 when unset or out of bounds', async () => {
    m.getSetting.mockResolvedValue(99.95)
    expect(await getDefaultTarget()).toBe(99.95)
    expect(m.getSetting).toHaveBeenCalledWith('sla.default_target', 'default')
    m.getSetting.mockResolvedValue(null)
    expect(await getDefaultTarget()).toBe(99.9)
    m.getSetting.mockResolvedValue(42)
    expect(await getDefaultTarget()).toBe(99.9)
  })

  it('writes the provider row', async () => {
    await setDefaultTarget(99.5)
    expect(m.setSetting).toHaveBeenCalledWith('sla.default_target', 'default', 99.5)
  })
})

describe('parseSettingsBody', () => {
  it('accepts either field or both, within bounds', () => {
    expect(parseSettingsBody({ retentionDays: 30 })).toEqual({ ok: true, value: { retentionDays: 30 } })
    expect(parseSettingsBody({ retentionDays: 1825, defaultTarget: 99.99 })).toEqual({ ok: true, value: { retentionDays: 1825, defaultTarget: 99.99 } })
    expect(parseSettingsBody({ defaultTarget: 90 })).toEqual({ ok: true, value: { defaultTarget: 90 } })
  })

  it.each([
    [null, 'invalid_body'],
    [{}, 'invalid_body'],
    [{ retentionDays: 29 }, 'invalid_retention'],
    [{ retentionDays: 1826 }, 'invalid_retention'],
    [{ retentionDays: 400.5 }, 'invalid_retention'],
    [{ retentionDays: '400' }, 'invalid_retention'],
    [{ defaultTarget: 100 }, 'invalid_target'],
    [{ retentionDays: 400, defaultTarget: 80 }, 'invalid_target'],
  ])('refuses %j with %s', (body, error) => {
    expect(parseSettingsBody(body)).toEqual({ ok: false, error })
  })
})
