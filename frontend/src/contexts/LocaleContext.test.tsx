import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { defaultLocale, localeFlags, localeNames, locales } from '@/i18n/config'

import { LocaleProvider, useLocale } from './LocaleContext'

const render = (initialLocale?: string) =>
  renderHook(() => useLocale(), {
    wrapper: ({ children }: { children: ReactNode }) => <LocaleProvider initialLocale={initialLocale}>{children}</LocaleProvider>
  })

beforeEach(() => {
  refresh.mockReset()
  document.cookie = 'NEXT_LOCALE=; path=/; max-age=0'
})
afterEach(() => cleanup())

describe('LocaleProvider', () => {
  it('exposes the initial locale and the locale catalog', () => {
    const { result } = render('fr')
    expect(result.current).toMatchObject({ locale: 'fr', locales, localeNames, localeFlags, isPending: false })
  })

  it('falls back to the default locale', () => {
    expect(render().result.current.locale).toBe(defaultLocale)
  })

  it('stores a valid locale in the cookie and refreshes the page', () => {
    const { result } = render('en')
    act(() => result.current.changeLocale('zh-CN'))
    expect(document.cookie).toContain('NEXT_LOCALE=zh-CN')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refuses an unknown locale', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = render('en')
    act(() => result.current.changeLocale('xx'))
    expect(error).toHaveBeenCalledWith('Invalid locale: xx')
    expect(document.cookie).not.toContain('NEXT_LOCALE=xx')
    expect(refresh).not.toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('useLocale outside a provider', () => {
  it('returns the default context', () => {
    const { result } = renderHook(() => useLocale())
    expect(result.current.locale).toBe(defaultLocale)
    expect(() => result.current.changeLocale('fr')).not.toThrow()
  })
})
