// Next Imports
import { cookies } from 'next/headers'

// Third-party Imports
import 'server-only'

// Config Imports
import themeConfig from '@configs/themeConfig'

// Appearance Imports
import { getStoredAppearance } from '@/lib/appearance/server'

export const getSettingsFromCookie = async () => {
  const cookieStore = await cookies()
  const cookieName = themeConfig.settingsCookieName

  try {
    return JSON.parse(cookieStore.get(cookieName)?.value || '{}')
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
export const getEffectiveSettings = async () => {
  const settingsCookie = await getSettingsFromCookie()
  const stored = await getStoredAppearance()

  return stored ? { ...settingsCookie, ...stored } : settingsCookie
}

export const getMode = async () => {
  const settings = await getEffectiveSettings()

  // Get mode from stored settings or fallback to theme config
  const _mode = settings.mode || themeConfig.mode

  return _mode
}

export const getSystemMode = async () => {
  const cookieStore = await cookies()
  const mode = await getMode()
  const colorPrefCookie = cookieStore.get('colorPref')?.value || 'light'

  return (mode === 'system' ? colorPrefCookie : mode) || 'light'
}

export const getServerMode = async () => {
  const mode = await getMode()
  const systemMode = await getSystemMode()

  return mode === 'system' ? systemMode : mode
}

export const getSkin = async () => {
  const settings = await getEffectiveSettings()

  return settings.skin || 'default'
}
