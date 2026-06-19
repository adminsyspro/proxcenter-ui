import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { vi } from 'vitest'

// next/navigation is server-coupled; stub it for client component rendering.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'spike' } }, status: 'authenticated' }),
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}))

export function renderWithProviders(ui: ReactElement) {
  // Plan 2 wraps real MUI ThemeProvider + NextIntlClientProvider + TenantContext
  // + isolated SWRConfig here. The spike keeps it minimal to first prove render.
  return render(ui)
}
