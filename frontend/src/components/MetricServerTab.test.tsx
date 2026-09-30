import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import MetricServerTab from './MetricServerTab'

describe('MetricServerTab', () => {
  afterEach(cleanup)

  it('fetches the metric servers on mount and lists them', async () => {
    let calls = 0
    server.use(
      http.get('*/api/v1/connections/conn%201/cluster/metrics/server', () => {
        calls++
        return HttpResponse.json({ data: [{ id: 'graf-main', type: 'graphite', server: '10.0.0.9', port: 2003 }] })
      }),
    )
    renderWithProviders(<MetricServerTab connectionId="conn 1" />)

    expect(await screen.findByText('graf-main')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.9')).toBeInTheDocument()
    expect(calls).toBe(1)
  })

  it('surfaces the HTTP status when the fetch fails', async () => {
    server.use(
      http.get('*/api/v1/connections/c2/cluster/metrics/server', () => HttpResponse.json({}, { status: 502 })),
    )
    renderWithProviders(<MetricServerTab connectionId="c2" />)
    expect(await screen.findByText(/HTTP 502/)).toBeInTheDocument()
  })
})
