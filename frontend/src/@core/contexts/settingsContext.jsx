'use client'
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Config Imports
import themeConfig from '@configs/themeConfig'
import primaryColorConfig from '@configs/primaryColorConfig'

// Hook Imports
import { useObjectCookie } from '@core/hooks/useObjectCookie'

// Appearance Imports
import { saveAppearance } from '@/lib/appearance/client'
import { sanitizeAppearance } from '@/lib/appearance/schema'

// Initial Settings Context
export const SettingsContext = createContext(null)

// Shipped defaults. Hoisted out of the provider so the identity is stable and
// `isSettingsChanged` compares against one object rather than a fresh literal.
const defaultSettings = {
  mode: themeConfig.mode,
  skin: themeConfig.skin,
  semiDark: themeConfig.semiDark,
  layout: themeConfig.layout,
  navbarContentWidth: themeConfig.navbar.contentWidth,
  contentWidth: themeConfig.contentWidth,
  footerContentWidth: themeConfig.footer.contentWidth,
  primaryColor: primaryColorConfig[0].main,
  globalTheme: 'default', // Global theme/skin ID
  lightBackground: 'neutral', // Light mode background tint: neutral, warm, cool, sepia, paper
  // Advanced appearance settings
  density: 'comfortable', // compact, comfortable, spacious
  customBorderRadius: null, // null = use theme default, or 0-24
  blurIntensity: 12, // 0-24, for glassmorphism theme
  // Typography settings
  fontSize: 14, // Base font size: 12-18
  uiScale: 100, // UI scale percentage: 80-120
  // Data refresh interval (seconds): 5, 10, 30, 60, 300, 0 (off)
  refreshInterval: 30,
  // Login page background
  loginBackground: {
    type: 'gradient', // 'gradient' | 'image' | 'particles' | 'animated'
    gradient: 'default', // gradient preset ID
    imageUrl: null, // custom image URL or uploaded path
    overlay: true, // dark overlay for readability
    overlayOpacity: 0.5, // 0-1
    blur: 0, // background blur 0-20
    particles: false // animated particles effect
  }
}

// Long enough to swallow a slider drag, short enough that a normal click is on
// the server before the user can reach for the tab close button. What they
// cannot beat, the page-hide flush below catches.
const PERSIST_DEBOUNCE_MS = 600

// A save can be refused by a dropped connection or an expired session. Bounded
// retries so a server that is down for a while is not hammered.
const PERSIST_RETRY_MS = 5000
const MAX_PERSIST_RETRIES = 3

// Marks the browser cookie with the account that wrote it. Deliberately outside
// the persisted whitelist, so it never reaches the database.
const APPEARANCE_OWNER_KEY = '_appearanceOwner'

// sanitizeAppearance always walks its validators in the same order, so two
// sanitised blobs serialise identically when they hold the same values, which
// is what makes these string comparisons safe.
const DEFAULT_APPEARANCE_JSON = JSON.stringify(sanitizeAppearance(defaultSettings))

// Settings Provider
export const SettingsProvider = props => {
  const { canPersistAppearance = false, hasStoredAppearance = false, appearanceOwner = null } = props

  // Initial Settings
  const initialSettings = {
    ...defaultSettings,
    mode: props.mode || themeConfig.mode
  }

  // What the server resolved for this render: the cookie with the user's stored
  // appearance layered on top. Empty on an anonymous page, or when the provider
  // is mounted without it. The owner stamp read back from the cookie is dropped
  // here so it never shows up as a setting.
  const { [APPEARANCE_OWNER_KEY]: _incomingOwner, ...serverSettings } =
    props.initialSettings && typeof props.initialSettings === 'object' ? props.initialSettings : {}

  const hasServerSettings = Object.keys(serverSettings).length > 0

  // Cookies. The cookie is a local cache of the appearance: it survives a
  // reload without a round-trip, but it is the server copy that outlives a
  // browser set to clear its storage on exit (issue #696).
  const [settingsCookie, updateSettingsCookie] = useObjectCookie(
    themeConfig.settingsCookieName,
    hasServerSettings ? serverSettings : initialSettings
  )

  // State. Layering over the defaults matters for a cookie written by an older
  // release: a missing key would otherwise read as `undefined` all the way into
  // the theme, where an undefined primaryColor throws inside MUI's lighten().
  const [_settingsState, _updateSettingsState] = useState({
    ...initialSettings,
    ...(hasServerSettings ? serverSettings : settingsCookie)
  })

  // Pending server write: the appearance keys changed since the last successful
  // save. Held outside React state because nothing renders from it and it has to
  // stay readable from the page-hide listener.
  const pendingRef = useRef(null)
  const timerRef = useRef(null)
  const retriesRef = useRef(0)

  // sendPending reschedules itself after a refused save, so it reaches itself
  // through a ref rather than a circular useCallback dependency.
  const sendPendingRef = useRef(null)

  const armFlush = useCallback(delay => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      sendPendingRef.current?.(false)
    }, delay)
  }, [])

  const sendPending = useCallback(
    keepalive => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }

      const payload = pendingRef.current

      pendingRef.current = null

      if (!payload) return

      Promise.resolve(saveAppearance(payload, { keepalive })).then(saved => {
        if (saved) {
          retriesRef.current = 0

          return
        }

        // A save that never lands would be worse than no save at all: the stale
        // server copy wins on the next boot and quietly undoes the change. Put
        // the keys back for another attempt, letting anything the user has
        // touched since take precedence over what failed.
        pendingRef.current = { ...payload, ...(pendingRef.current || {}) }

        if (retriesRef.current >= MAX_PERSIST_RETRIES) return
        retriesRef.current += 1
        armFlush(PERSIST_RETRY_MS)
      })
    },
    [armFlush]
  )

  useEffect(() => {
    sendPendingRef.current = sendPending
  }, [sendPending])

  const persistAppearance = useCallback(
    changed => {
      if (!canPersistAppearance) return

      const payload = sanitizeAppearance(changed)

      // Nothing in the persisted subset moved: a page-scoped update, a key this
      // store does not own, or React re-running the updater in StrictMode.
      if (Object.keys(payload).length === 0) return

      pendingRef.current = { ...(pendingRef.current || {}), ...payload }
      retriesRef.current = 0
      armFlush(PERSIST_DEBOUNCE_MS)
    },
    [canPersistAppearance, armFlush]
  )

  // A debounced save would be cancelled by the navigation that closes the tab,
  // and since the server copy wins on the next boot the change would come back
  // undone. Flush it while the page is still alive.
  useEffect(() => {
    const onPageHide = () => sendPending(true)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') sendPending(true)
    }

    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [sendPending])

  // Users who picked a theme before this was stored server-side have it in
  // their cookie only. Hand that cookie to the server once, so the choice they
  // already made survives the next storage purge without them redoing it.
  // Only a cookie that actually differs from the shipped defaults is worth
  // seeding: writing the defaults for someone who never customised anything
  // would pin them to today's defaults forever.
  const seededRef = useRef(false)

  useEffect(() => {
    if (seededRef.current || !canPersistAppearance || hasStoredAppearance) return
    seededRef.current = true

    // Browsers get shared. A cookie stamped with another account must not be
    // copied into this one: unlike the cookie itself, which the next sign-in
    // overwrites, the stored row would keep that borrowed look for good. An
    // unstamped cookie predates this feature, which is exactly the case worth
    // migrating.
    const cookieOwner = settingsCookie?.[APPEARANCE_OWNER_KEY]

    if (cookieOwner && cookieOwner !== appearanceOwner) return

    const payload = sanitizeAppearance(settingsCookie)

    if (JSON.stringify(payload) === DEFAULT_APPEARANCE_JSON) return

    // Sent straight out rather than queued: a seed that fails is retried by the
    // next page load on its own, since nothing was stored in the meantime.
    saveAppearance(payload)
    // Seeding is a one-shot on mount: it reads the cookie as it was when the
    // page loaded, and every later change goes through persistAppearance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPersistAppearance, hasStoredAppearance])

  const updateSettings = (settings, options) => {
    const { updateCookie = true } = options || {}

    _updateSettingsState(prev => {
      const newSettings = { ...prev, ...settings }

      // Update cookie if needed
      if (updateCookie) {
        // The owner stamp stays out of the React state and out of the stored
        // blob; it exists only so the seeding above can tell whose cookie this
        // is on a shared browser.
        updateSettingsCookie(
          appearanceOwner ? { ...newSettings, [APPEARANCE_OWNER_KEY]: appearanceOwner } : newSettings
        )

        // Only the keys this call actually moved travel to the server. Sending
        // the whole blob would let a second tab, holding a copy from before,
        // revert a change the first one just made.
        const changed = {}

        for (const [key, value] of Object.entries(settings)) {
          if (!Object.is(prev[key], value)) changed[key] = value
        }

        persistAppearance(changed)
      }

      return newSettings
    })
  }

  /**
   * Updates the settings for page with the provided settings object.
   * Updated settings won't be saved to cookie hence will be reverted once navigating away from the page.
   *
   * @param settings - The partial settings object containing the properties to update.
   * @returns A function to reset the page settings.
   *
   * @example
   * useEffect(() => {
   *     return updatePageSettings({ theme: 'dark' });
   * }, []);
   */
  const updatePageSettings = settings => {
    updateSettings(settings, { updateCookie: false })

    // Returns a function to reset the page settings
    return () => updateSettings(settingsCookie, { updateCookie: false })
  }

  const resetSettings = () => {
    updateSettings(defaultSettings)
  }

  const isSettingsChanged = useMemo(
    () => JSON.stringify(defaultSettings) !== JSON.stringify(_settingsState),
    [_settingsState]
  )

  return (
    <SettingsContext.Provider
      value={{
        settings: _settingsState,
        updateSettings,
        isSettingsChanged,
        resetSettings,
        updatePageSettings
      }}
    >
      {props.children}
    </SettingsContext.Provider>
  )
}
