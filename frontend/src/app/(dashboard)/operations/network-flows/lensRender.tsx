/**
 * Render of the lens tests that need their own search params: renderWithProviders stubs next/navigation for every
 * file that imports it, so these files mock it themselves (see navigation below) and render with this instead.
 */
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'

import enMessages from '@/messages/en.json'

/** The search params the mocked useSearchParams answers; a test changes them to play a client-side navigation. */
export const navigation = { search: '' }

export function renderLens(ui: ReactElement) {
  const wrap = (node: ReactElement) => (
    <NextIntlClientProvider locale='en' messages={enMessages as Record<string, unknown>} timeZone='UTC'>
      <ThemeProvider theme={createTheme()}>
        <SWRConfig value={{ provider: () => new Map(), revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0 }}>
          {node}
        </SWRConfig>
      </ThemeProvider>
    </NextIntlClientProvider>
  )
  const result = render(wrap(ui))
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) }
}
