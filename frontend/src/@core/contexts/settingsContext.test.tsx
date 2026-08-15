import { useContext, type PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

const { saveAppearance, updateSettingsCookie, useObjectCookie } = vi.hoisted(() => ({
  saveAppearance: vi.fn(),
  updateSettingsCookie: vi.fn(),
  useObjectCookie: vi.fn(),
}))

vi.mock('@/lib/appearance/client', () => ({ saveAppearance }))
vi.mock('@core/hooks/useObjectCookie', () => ({ useObjectCookie }))

import primaryColorConfig from '@configs/primaryColorConfig'
import themeConfig from '@configs/themeConfig'

import { SettingsContext, SettingsProvider } from './settingsContext'

type ProviderProps = {
  canPersistAppearance?: boolean
  hasStoredAppearance?: boolean
  initialSettings?: Record<string, unknown>
  mode?: string
}

let cookieValue: Record<string, unknown> | undefined

function renderSettings(props: ProviderProps = {}) {
  const wrapper = ({ children }: PropsWithChildren) => (
    <SettingsProvider {...props}>{children}</SettingsProvider>
  )

  return renderHook(() => useContext(SettingsContext), { wrapper })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  saveAppearance.mockResolvedValue(true)
  cookieValue = undefined
  useObjectCookie.mockImplementation((_key: string, fallback: Record<string, unknown>) => [
    cookieValue ?? fallback,
    updateSettingsCookie,
  ])
})

afterEach(() => {
  cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

describe('SettingsProvider defaults', () => {
  it('exposes server settings layered over shipped defaults', () => {
    const { result } = renderSettings({
      initialSettings: { mode: 'dark', fontSize: 16 },
      hasStoredAppearance: true,
    })

    expect(result.current.settings.mode).toBe('dark')
    expect(result.current.settings.fontSize).toBe(16)
    expect(result.current.settings.primaryColor).toBe(primaryColorConfig[0].main)
    expect(result.current.settings.primaryColor).toBeDefined()
  })

  it('resetSettings restores the shipped defaults', () => {
    const { result } = renderSettings({
      initialSettings: { mode: 'dark', primaryColor: '#FFD200', fontSize: 18 },
      hasStoredAppearance: true,
    })

    act(() => result.current.resetSettings())

    expect(result.current.settings).toEqual(
      expect.objectContaining({
        mode: themeConfig.mode,
        primaryColor: primaryColorConfig[0].main,
        fontSize: 14,
        uiScale: 100,
      }),
    )
  })
})

describe('appearance persistence', () => {
  it('writes the cookie and saves the changed colour after 600 ms', () => {
    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))

    expect(updateSettingsCookie).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColor: '#FFD200' }),
    )
    expect(saveAppearance).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(600))

    expect(saveAppearance).toHaveBeenCalledOnce()
    expect(saveAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColor: '#FFD200' }),
      { keepalive: false },
    )
  })

  it('collapses rapid updates into one save containing the last value', () => {
    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    act(() => {
      result.current.updateSettings({ primaryColor: '#111111' })
      result.current.updateSettings({ primaryColor: '#222222' })
      result.current.updateSettings({ primaryColor: '#333333' })
    })
    act(() => vi.advanceTimersByTime(600))

    expect(saveAppearance).toHaveBeenCalledOnce()
    expect(saveAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColor: '#333333' }),
      { keepalive: false },
    )
  })

  it('never saves for an anonymous page', () => {
    const { result } = renderSettings({ canPersistAppearance: false })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))
    act(() => vi.advanceTimersByTime(600))

    expect(saveAppearance).not.toHaveBeenCalled()
  })

  it('does not persist a page-scoped update', () => {
    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }, { updateCookie: false }))
    act(() => vi.advanceTimersByTime(600))

    expect(updateSettingsCookie).not.toHaveBeenCalled()
    expect(saveAppearance).not.toHaveBeenCalled()
  })

  it('does not fire a second save when the persisted subset is unchanged', () => {
    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))
    act(() => vi.advanceTimersByTime(600))
    expect(saveAppearance).toHaveBeenCalledOnce()

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))
    act(() => vi.advanceTimersByTime(600))

    expect(saveAppearance).toHaveBeenCalledOnce()
  })

  it('sends only the keys the update moved, never the whole settings blob', () => {
    // A second tab holding a copy from before must not be able to revert what
    // this one saved, so an untouched key is not part of the payload.
    const { result } = renderSettings({
      canPersistAppearance: true,
      hasStoredAppearance: true,
      initialSettings: { mode: 'light', fontSize: 16 },
    })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))
    act(() => vi.advanceTimersByTime(600))

    expect(saveAppearance).toHaveBeenCalledWith({ primaryColor: '#FFD200' }, { keepalive: false })
  })

  it('accumulates the keys changed across several updates in one payload', () => {
    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    act(() => {
      result.current.updateSettings({ primaryColor: '#FFD200' })
      result.current.updateSettings({ mode: 'dark' })
    })
    act(() => vi.advanceTimersByTime(600))

    expect(saveAppearance).toHaveBeenCalledOnce()
    expect(saveAppearance).toHaveBeenCalledWith(
      { primaryColor: '#FFD200', mode: 'dark' },
      { keepalive: false },
    )
  })

  it('does not send a key the settings store does not persist', () => {
    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    act(() => result.current.updateSettings({ loginBackground: { type: 'image' } }))
    act(() => vi.advanceTimersByTime(600))

    expect(saveAppearance).not.toHaveBeenCalled()
  })

  it('retries a refused save instead of letting the stale server copy win', async () => {
    saveAppearance.mockResolvedValueOnce(false)

    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(saveAppearance).toHaveBeenCalledOnce()

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(saveAppearance).toHaveBeenCalledTimes(2)
    expect(saveAppearance).toHaveBeenLastCalledWith({ primaryColor: '#FFD200' }, { keepalive: false })
  })

  it('gives up retrying rather than hammering a server that stays down', async () => {
    saveAppearance.mockResolvedValue(false)

    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
    }

    // The first send plus MAX_PERSIST_RETRIES.
    expect(saveAppearance).toHaveBeenCalledTimes(4)
  })
})

describe('one-shot seeding', () => {
  it('seeds existing cookie settings once when the user has no stored appearance', () => {
    cookieValue = { mode: 'dark', primaryColor: '#FFD200', loginBackground: { type: 'image' } }

    const rendered = renderSettings({ canPersistAppearance: true, hasStoredAppearance: false })
    rendered.rerender()

    expect(saveAppearance).toHaveBeenCalledOnce()
    expect(saveAppearance).toHaveBeenCalledWith({ mode: 'dark', primaryColor: '#FFD200' })
  })

  it('does not seed when an appearance is already stored', () => {
    cookieValue = { mode: 'dark', primaryColor: '#FFD200' }

    renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })

    expect(saveAppearance).not.toHaveBeenCalled()
  })

  it('does not seed a cookie that never departed from the shipped defaults', () => {
    // Storing the defaults for someone who never customised anything would pin
    // them to today's defaults, so an untouched cookie is left alone.
    cookieValue = undefined

    renderSettings({ canPersistAppearance: true, hasStoredAppearance: false })

    expect(saveAppearance).not.toHaveBeenCalled()
  })

  it('does not seed for an anonymous page', () => {
    cookieValue = { mode: 'dark', primaryColor: '#FFD200' }

    renderSettings({ canPersistAppearance: false, hasStoredAppearance: false })

    expect(saveAppearance).not.toHaveBeenCalled()
  })

  it('refuses to copy another account cookie into this one on a shared browser', () => {
    cookieValue = { mode: 'dark', primaryColor: '#FFD200', _appearanceOwner: 'someone-else' }

    renderSettings({ canPersistAppearance: true, hasStoredAppearance: false, appearanceOwner: 'me' })

    expect(saveAppearance).not.toHaveBeenCalled()
  })

  it('still seeds a cookie this account wrote itself', () => {
    cookieValue = { mode: 'dark', primaryColor: '#FFD200', _appearanceOwner: 'me' }

    renderSettings({ canPersistAppearance: true, hasStoredAppearance: false, appearanceOwner: 'me' })

    expect(saveAppearance).toHaveBeenCalledWith({ mode: 'dark', primaryColor: '#FFD200' })
  })
})

describe('cookie ownership', () => {
  it('stamps the cookie with the account that wrote it, without storing the stamp', () => {
    const { result } = renderSettings({
      canPersistAppearance: true,
      hasStoredAppearance: true,
      appearanceOwner: 'me',
    })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))

    expect(updateSettingsCookie).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColor: '#FFD200', _appearanceOwner: 'me' }),
    )
    expect(result.current.settings._appearanceOwner).toBeUndefined()

    act(() => vi.advanceTimersByTime(600))

    expect(saveAppearance).toHaveBeenCalledWith({ primaryColor: '#FFD200' }, { keepalive: false })
  })

  it('leaves the cookie unstamped for an anonymous page', () => {
    const { result } = renderSettings({ canPersistAppearance: false })

    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))

    expect(updateSettingsCookie).toHaveBeenCalledWith(
      expect.not.objectContaining({ _appearanceOwner: expect.anything() }),
    )
  })
})

describe('page lifecycle flushes', () => {
  it('flushes a pending debounce immediately on pagehide with keepalive', () => {
    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })
    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))

    act(() => window.dispatchEvent(new Event('pagehide')))

    expect(saveAppearance).toHaveBeenCalledOnce()
    expect(saveAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColor: '#FFD200' }),
      { keepalive: true },
    )
    act(() => vi.advanceTimersByTime(600))
    expect(saveAppearance).toHaveBeenCalledOnce()
  })

  it('flushes a pending debounce when the document becomes hidden', () => {
    const { result } = renderSettings({ canPersistAppearance: true, hasStoredAppearance: true })
    act(() => result.current.updateSettings({ primaryColor: '#FFD200' }))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })

    act(() => document.dispatchEvent(new Event('visibilitychange')))

    expect(saveAppearance).toHaveBeenCalledOnce()
    expect(saveAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColor: '#FFD200' }),
      { keepalive: true },
    )
  })
})
