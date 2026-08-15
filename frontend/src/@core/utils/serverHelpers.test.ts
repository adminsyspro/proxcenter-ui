import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cookies, getStoredAppearance } = vi.hoisted(() => ({
  cookies: vi.fn(),
  getStoredAppearance: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies }))
vi.mock('@/lib/appearance/server', () => ({ getStoredAppearance }))

import themeConfig from '@configs/themeConfig'
import {
  getEffectiveSettings,
  getMode,
  getSettingsFromCookie,
  getSystemMode,
} from './serverHelpers'

const cookieValues: Record<string, string> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(cookieValues)) delete cookieValues[key]
  cookies.mockImplementation(async () => ({
    get: (name: string) => (Object.hasOwn(cookieValues, name) ? { value: cookieValues[name] } : undefined),
  }))
  getStoredAppearance.mockResolvedValue(null)
})

function setSettingsCookie(settings: Record<string, unknown>) {
  cookieValues[themeConfig.settingsCookieName] = JSON.stringify(settings)
}

describe('getEffectiveSettings', () => {
  it('returns the cookie alone when nothing is stored', async () => {
    const cookie = { mode: 'light', loginBackground: { type: 'gradient' } }
    setSettingsCookie(cookie)

    await expect(getEffectiveSettings()).resolves.toEqual(cookie)
  })

  it('lets stored keys win while preserving cookie-only keys', async () => {
    setSettingsCookie({ mode: 'light', primaryColor: '#E57000', loginBackground: { type: 'image' } })
    getStoredAppearance.mockResolvedValue({ mode: 'dark', primaryColor: '#FFD200' })

    await expect(getEffectiveSettings()).resolves.toEqual({
      mode: 'dark',
      primaryColor: '#FFD200',
      loginBackground: { type: 'image' },
    })
  })
})

describe('mode helpers', () => {
  it('prefers stored mode over cookie mode', async () => {
    setSettingsCookie({ mode: 'light' })
    getStoredAppearance.mockResolvedValue({ mode: 'dark' })

    await expect(getMode()).resolves.toBe('dark')
  })

  it('falls back to themeConfig.mode when neither source has a mode', async () => {
    setSettingsCookie({ primaryColor: '#FFD200' })

    await expect(getMode()).resolves.toBe(themeConfig.mode)
  })

  it("resolves stored system mode through the 'colorPref' cookie", async () => {
    setSettingsCookie({ mode: 'light' })
    cookieValues.colorPref = 'dark'
    getStoredAppearance.mockResolvedValue({ mode: 'system' })

    await expect(getSystemMode()).resolves.toBe('dark')
  })

  it.each(['light', 'dark'])('returns stored concrete mode %s verbatim', async mode => {
    setSettingsCookie({ mode: 'system' })
    cookieValues.colorPref = mode === 'light' ? 'dark' : 'light'
    getStoredAppearance.mockResolvedValue({ mode })

    await expect(getSystemMode()).resolves.toBe(mode)
  })
})

describe('getSettingsFromCookie', () => {
  it('falls back to an empty object rather than 500-ing every page on a mangled cookie', async () => {
    cookieValues[themeConfig.settingsCookieName] = 'not json'

    await expect(getSettingsFromCookie()).resolves.toEqual({})
  })

  it('still renders the stored appearance when the cookie is unreadable', async () => {
    cookieValues[themeConfig.settingsCookieName] = '{"mode":'
    getStoredAppearance.mockResolvedValue({ mode: 'dark', primaryColor: '#FFD200' })

    await expect(getEffectiveSettings()).resolves.toEqual({ mode: 'dark', primaryColor: '#FFD200' })
  })
})
