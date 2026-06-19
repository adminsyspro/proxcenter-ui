import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'

import enMessages from '@/messages/en.json'

// next/navigation and next-auth/react are server-coupled; stub them so client
// components that read the router or session render under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'test' } }, status: 'authenticated' }),
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}))

// A default MUI theme is enough for render-level coverage; the app's heavy
// custom theme pulls in Settings/Branding context and is not needed to render.
const testTheme = createTheme()

function Providers({ children, locale = 'en' }: { children: ReactNode; locale?: string }) {
  return (
    <NextIntlClientProvider locale={locale} messages={enMessages as Record<string, unknown>}>
      <ThemeProvider theme={testTheme}>
        {/* Isolated SWR cache per render so fetches do not leak across tests. */}
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: false }}>
          {children}
        </SWRConfig>
      </ThemeProvider>
    </NextIntlClientProvider>
  )
}

export function renderWithProviders(ui: ReactElement, options?: { locale?: string }) {
  return render(ui, { wrapper: ({ children }) => <Providers locale={options?.locale}>{children}</Providers> })
}

// Re-export via live namespace to preserve Vitest's ESM live bindings.
export { screen, within, fireEvent, waitFor } from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
