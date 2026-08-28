import type { ReactNode } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'

const { replaceMock, useRBACMock, useSessionMock, setPageInfoMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  useRBACMock: vi.fn(),
  useSessionMock: vi.fn(),
  setPageInfoMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: replaceMock }) }))
vi.mock('next-auth/react', () => ({ useSession: useSessionMock }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: useRBACMock }))
vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: setPageInfoMock }) }))
// The viewer is a client-only chunk (Vue inside); the page's job is the gate
// and the frame around it, so the dynamic import resolves to a marker.
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid='viewer' /> }))

import ApiReferencePage from './page'

function renderPage() {
  return render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={createTheme()}>
        <ApiReferencePage />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )
}

function session(tenantId: string) {
  return { data: { user: { name: 'admin', tenantId } }, status: 'authenticated' }
}

beforeEach(() => {
  replaceMock.mockReset()
  setPageInfoMock.mockReset()
  useRBACMock.mockReturnValue({ isAdmin: true, loading: false })
  useSessionMock.mockReturnValue(session('default'))
})

afterEach(() => cleanup())

describe('ApiReferencePage', () => {
  it('renders the reference and a way back to the tokens for a super admin in the provider tenant', () => {
    renderPage()
    expect(screen.getByTestId('viewer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back to api tokens/i })).toBeInTheDocument()
    expect(setPageInfoMock).toHaveBeenCalledWith('API reference', expect.any(String), 'ri-book-2-line')
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('waits for RBAC before deciding anything', () => {
    useRBACMock.mockReturnValue({ isAdmin: false, loading: true })
    renderPage()
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('sends a non-admin back to the settings page', () => {
    useRBACMock.mockReturnValue({ isAdmin: false, loading: false })
    renderPage()
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
    expect(replaceMock).toHaveBeenCalledWith('/settings')
  })

  // The settings API tab is providerOnly: an admin working inside a customer
  // tenant does not see it, so the page it opens must not be reachable by URL.
  it('sends a super admin who is inside a customer tenant back to the settings page', () => {
    useSessionMock.mockReturnValue(session('tenant-a'))
    renderPage()
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
    expect(replaceMock).toHaveBeenCalledWith('/settings')
  })
})
