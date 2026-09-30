import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import NotificationsTab from './NotificationsTab'

const BASE = '*/api/v1/connections/c1/cluster/notifications'

describe('NotificationsTab', () => {
  afterEach(cleanup)

  it('loads targets and matchers on mount', async () => {
    server.use(
      http.get(`${BASE}/targets`, () => HttpResponse.json({ data: [{ name: 'mail-ops', type: 'smtp' }] })),
      http.get(`${BASE}/matchers`, () => HttpResponse.json({ data: [{ name: 'critical-only' }] })),
    )
    renderWithProviders(<NotificationsTab connectionId="c1" />)

    expect(await screen.findByText('mail-ops')).toBeInTheDocument()
    expect(screen.getByText('critical-only')).toBeInTheDocument()
  })

  it('reports which list failed', async () => {
    server.use(
      http.get(`${BASE}/targets`, () => HttpResponse.json({ data: [] })),
      http.get(`${BASE}/matchers`, () => HttpResponse.json({}, { status: 500 })),
    )
    renderWithProviders(<NotificationsTab connectionId="c1" />)
    expect(await screen.findByText(/Matchers: HTTP 500/)).toBeInTheDocument()
  })
})
