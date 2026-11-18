// Next Imports
import { cookies } from 'next/headers'

// Third-party Imports
import 'server-only'

// Config Imports
import themeConfig from '@configs/themeConfig'
import type { ThemeMode } from '@configs/themeConfig'

// Type Imports
import type { SystemMode } from '@core/theme/types'

// Appearance Imports
import { getStoredAppearance } from '@/lib/appearance/server'

/** Appearance settings as stored: validated later by sanitizeAppearance, so any key may hold anything. */
export type StoredSettings = Record<string, unknown>

const isSettingsObject = (value: unknown): value is StoredSettings => typeof value === 'object' && value !== null

export const getSettingsFromCookie = async (): Promise<StoredSettings> => {
  const cookieStore = await cookies()
  const cookieName = themeConfig.settingsCookieName

  try {
    const parsed: unknown = JSON.parse(cookieStore.get(cookieName)?.value || '{}')

    return isSettingsObject(parsed) ? parsed : {}
  } catch {
    // A cookie truncated or mangled on its way back would otherwise throw here,
    // during the render of every single page, leaving the user with a 500 and
    // no way out of it from the UI. Falling back to the defaults costs them
    // their local cache at worst, and what they saved is on the server anyway.
    return {}
  }
}

/**
 * The settings this render should use: what the user saved on the server wins
 * over the cookie, which stays as a local cache and as the only source for
 * anonymous pages (issue #696). Read this rather than the cookie whenever the
 * answer drives what gets painted, so a restored theme is right on the first
 * frame instead of swapping in after hydration.
 */
export const getEffectiveSettings = async (): Promise<StoredSettings> => {
  const settingsCookie = await getSettingsFromCookie()
  const stored = await getStoredAppearance()

  return stored ? { ...settingsCookie, ...stored } : settingsCookie
}

const isThemeMode = (value: unknown): value is ThemeMode => value === 'system' || value === 'light' || value === 'dark'

export const getMode = async (): Promise<ThemeMode> => {
  const settings = await getEffectiveSettings()

  // Get mode from stored settings or fallback to theme config
  return isThemeMode(settings.mode) ? settings.mode : themeConfig.mode
}

export const getSystemMode = async (): Promise<SystemMode> => {
  const cookieStore = await cookies()
  const mode = await getMode()
  const colorPref: SystemMode = cookieStore.get('colorPref')?.value === 'dark' ? 'dark' : 'light'

  return mode === 'system' ? colorPref : mode
}

export const getServerMode = async (): Promise<SystemMode> => {
  const mode = await getMode()
  const systemMode = await getSystemMode()

  return mode === 'system' ? systemMode : mode
}

export const getSkin = async (): Promise<string> => {
  const settings = await getEffectiveSettings()

  return (typeof settings.skin === 'string' && settings.skin) || 'default'
}
