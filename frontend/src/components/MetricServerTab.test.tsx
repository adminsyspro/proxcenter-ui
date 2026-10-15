import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, within, fireEvent, userEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

import MetricServerTab from './MetricServerTab'

describe('MetricServerTab', () => {
  afterEach(() => {
    cleanup()
    toastError.mockReset()
  })

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

  it('creates an OpenTelemetry server with the otel-* options PVE expects', async () => {
    let posted: any = null
    server.use(
      http.get('*/api/v1/connections/c3/cluster/metrics/server', () => HttpResponse.json({ data: [] })),
      http.post('*/api/v1/connections/c3/cluster/metrics/server', async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ data: { success: true } })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<MetricServerTab connectionId="c3" />)
    await user.click(await screen.findByRole('button', { name: /add/i }))
    await user.click(screen.getByRole('menuitem', { name: /opentelemetry/i }))
    const dialog = screen.getByRole('dialog')
    const textboxes = within(dialog).getAllByRole('textbox')
    fireEvent.change(textboxes[0], { target: { value: 'otel' } })
    fireEvent.change(textboxes[1], { target: { value: '10.0.0.5' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /HTTP Headers/ }), { target: { value: '{"Authorization": "Bearer é"}' } })
    await user.click(within(dialog).getByRole('button', { name: /create/i }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({
      serverId: 'otel',
      type: 'opentelemetry',
      'otel-protocol': 'https',
      'otel-path': '/v1/metrics',
      'otel-timeout': 5,
      'otel-verify-ssl': 1,
      'otel-max-body-size': 10000000,
      'otel-compression': 'gzip',
    })
    for (const graphiteOrInflux of ['proto', 'path', 'timeout', 'compression', 'verify-certificate', 'max-body-size']) {
      expect(posted).not.toHaveProperty(graphiteOrInflux)
    }
    const headers = new TextDecoder().decode(Uint8Array.from(atob(posted['otel-headers']), c => c.charCodeAt(0)))
    expect(JSON.parse(headers)).toEqual({ Authorization: 'Bearer é' })
  })

  it('edits from the full config and deletes the options the user cleared', async () => {
    let put: any = null
    server.use(
      http.get('*/api/v1/connections/c4/cluster/metrics/server', () => HttpResponse.json({ data: [{ id: 'otel', type: 'opentelemetry', server: '10.0.0.5', port: 4318, disable: 0 }] })),
      http.get('*/api/v1/connections/c4/cluster/metrics/server/otel', () => HttpResponse.json({
        data: { type: 'opentelemetry', server: '10.0.0.5', port: 4318, disable: 0, 'otel-path': '/custom', 'otel-headers': btoa('{"X-A":"1"}') },
      })),
      http.put('*/api/v1/connections/c4/cluster/metrics/server/otel', async ({ request }) => {
        put = await request.json()
        return HttpResponse.json({ data: { success: true } })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<MetricServerTab connectionId="c4" />)
    const row = (await screen.findByText('otel')).closest('tr')!
    await user.click(within(row).getAllByRole('button')[0])

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByDisplayValue('/custom')).toBeInTheDocument())
    const headers = within(dialog).getByRole('textbox', { name: /HTTP Headers/ })
    expect(headers).toHaveValue('{"X-A":"1"}')
    fireEvent.change(headers, { target: { value: '' } })
    await user.click(within(dialog).getByRole('button', { name: /save/i }))

    await waitFor(() => expect(put).not.toBeNull())
    expect(put).toMatchObject({ server: '10.0.0.5', port: 4318, 'otel-path': '/custom', delete: 'otel-headers' })
    expect(put).not.toHaveProperty('type')
  })

  it('sends every OpenTelemetry option the user changes', async () => {
    let posted: any = null
    server.use(
      http.get('*/api/v1/connections/c5/cluster/metrics/server', () => HttpResponse.json({ data: [] })),
      http.post('*/api/v1/connections/c5/cluster/metrics/server', async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ data: { success: true } })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<MetricServerTab connectionId="c5" />)
    await user.click(await screen.findByRole('button', { name: /add/i }))
    await user.click(screen.getByRole('menuitem', { name: /opentelemetry/i }))
    const dialog = screen.getByRole('dialog')
    const textboxes = within(dialog).getAllByRole('textbox')
    fireEvent.change(textboxes[0], { target: { value: 'otel' } })
    fireEvent.change(textboxes[1], { target: { value: '10.0.0.5' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Path' }), { target: { value: '/otlp/v1/metrics' } })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Timeout (s)' }), { target: { value: '8' } })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Max Body Size (bytes)' }), { target: { value: '2048' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Resource Attributes/ }), { target: { value: '{"env": "lab"}' } })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Verify SSL' }))
    const [protocol, compression] = within(dialog).getAllByRole('combobox')
    await user.click(protocol)
    await user.click(screen.getByRole('option', { name: 'HTTP' }))
    await user.click(compression)
    await user.click(screen.getByRole('option', { name: 'None' }))
    await user.click(within(dialog).getByRole('button', { name: /create/i }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({
      'otel-protocol': 'http',
      'otel-path': '/otlp/v1/metrics',
      'otel-timeout': '8',
      'otel-verify-ssl': 0,
      'otel-max-body-size': '2048',
      'otel-compression': 'none',
      'otel-resource-attributes': btoa('{"env": "lab"}'),
    })
    expect(posted).not.toHaveProperty('otel-headers')
  })

  it('refuses to save headers that are not valid JSON', async () => {
    server.use(http.get('*/api/v1/connections/c6/cluster/metrics/server', () => HttpResponse.json({ data: [] })))
    const user = userEvent.setup()
    renderWithProviders(<MetricServerTab connectionId="c6" />)
    await user.click(await screen.findByRole('button', { name: /add/i }))
    await user.click(screen.getByRole('menuitem', { name: /opentelemetry/i }))
    const dialog = screen.getByRole('dialog')
    const textboxes = within(dialog).getAllByRole('textbox')
    fireEvent.change(textboxes[0], { target: { value: 'otel' } })
    fireEvent.change(textboxes[1], { target: { value: '10.0.0.5' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /HTTP Headers/ }), { target: { value: '{"Authorization": ' } })

    expect(within(dialog).getByText('Invalid JSON')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /create/i })).toBeDisabled()
  })

  it('shows a header value that is not base64 as stored', async () => {
    server.use(
      http.get('*/api/v1/connections/c7/cluster/metrics/server', () => HttpResponse.json({ data: [{ id: 'otel', type: 'opentelemetry', server: '10.0.0.5', port: 4318 }] })),
      http.get('*/api/v1/connections/c7/cluster/metrics/server/otel', () => HttpResponse.json({
        data: { type: 'opentelemetry', server: '10.0.0.5', port: 4318, 'otel-headers': 'not base64!' },
      })),
    )
    const user = userEvent.setup()
    renderWithProviders(<MetricServerTab connectionId="c7" />)
    const row = (await screen.findByText('otel')).closest('tr')!
    await user.click(within(row).getAllByRole('button')[0])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('textbox', { name: /HTTP Headers/ })).toHaveValue('not base64!')
  })

  it('does not open the edit dialog when the full config cannot be read', async () => {
    server.use(
      http.get('*/api/v1/connections/c8/cluster/metrics/server', () => HttpResponse.json({ data: [{ id: 'otel', type: 'opentelemetry', server: '10.0.0.5', port: 4318 }] })),
      http.get('*/api/v1/connections/c8/cluster/metrics/server/otel', () => HttpResponse.json({ error: 'Permission denied: connection.manage' }, { status: 403 })),
    )
    const user = userEvent.setup()
    renderWithProviders(<MetricServerTab connectionId="c8" />)
    const row = (await screen.findByText('otel')).closest('tr')!
    await user.click(within(row).getAllByRole('button')[0])

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Permission denied: connection.manage'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
