import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import de from '@/messages/de.json'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import ko from '@/messages/ko.json'

import LogNodeLines, { lagParts } from './LogNodeLines'

const nodes = [
  { node: 'pve1', lines_last: 1, lines_per_min_15m: 1234.4, lag_seconds: 12, full_pages_24h: 0 },
  { node: 'pve2', lines_last: 1, lines_per_min_15m: 3, lag_seconds: 300, full_pages_24h: 0 },
  { node: 'pve3', lines_last: 1, lines_per_min_15m: 3, lag_seconds: 3 * 3600, full_pages_24h: 0 },
]

const view = (locale: string, messages: unknown) => render(
  <NextIntlClientProvider locale={locale} messages={messages as Record<string, unknown>} timeZone='UTC'>
    <LogNodeLines nodes={nodes} />
  </NextIntlClientProvider>,
)

describe('LogNodeLines', () => {
  it('picks the unit by size: seconds up to 120 s, minutes up to 120 min, then hours', () => {
    expect(lagParts(0)).toEqual({ unit: 'second', count: 0 })
    expect(lagParts(120)).toEqual({ unit: 'second', count: 120 })
    expect(lagParts(121)).toEqual({ unit: 'minute', count: 2 })
    expect(lagParts(7200)).toEqual({ unit: 'minute', count: 120 })
    expect(lagParts(7260)).toEqual({ unit: 'hour', count: 2 })
  })

  it('writes the units and the rate with the number format of the locale', () => {
    view('en', en)
    expect(screen.getByText('pve1 · 1,234 lines/min · 12 sec behind')).toBeTruthy()
    expect(screen.getByText('pve2 · 3 lines/min · 5 min behind')).toBeTruthy()
    expect(screen.getByText('pve3 · 3 lines/min · 3 hr behind')).toBeTruthy()
  })

  it.each([['fr', fr, /1\s234 lignes\/min · retard 12\ss/, /retard 3\sh/], ['de', de, /1\.234 Zeilen\/Min\. · 12 Sek. Verzug/, /3 Std\. Verzug/], ['ko', ko, /분당 1,234줄 · 12초 지연/, /3시간 지연/]])(
    'is in %s',
    (_locale, messages, first, third) => {
      const { container } = view(_locale, messages)
      expect(container.textContent).toMatch(first)
      expect(container.textContent).toMatch(third)
    },
  )
})
