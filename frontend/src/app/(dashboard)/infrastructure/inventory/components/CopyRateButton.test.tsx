import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import CopyRateButton, { canChangeCopyRate } from './CopyRateButton'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, unknown>) => (vals ? `${k} ${JSON.stringify(vals)}` : k),
}))

let answers: Record<string, any>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  answers = {}
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method || 'GET'} ${url}`
    const a = answers[key] ?? { data: { copyRateLimit: (init?.body && JSON.parse(String(init.body)).copyRateLimit) ?? null } }
    return new Response(JSON.stringify(a), { status: a.error ? 400 : 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const warmJob = (over: any = {}) => ({ id: 'j1', status: 'full_copy', config: { migrationType: 'warm' }, ...over })
const calls = () => fetchMock.mock.calls.map(c => `${(c[1] as RequestInit | undefined)?.method || 'GET'} ${c[0]}`)

describe('canChangeCopyRate', () => {
  it('offers the change on a warm migration that is not over', () => {
    expect(canChangeCopyRate(warmJob())).toBe(true)
    expect(canChangeCopyRate(warmJob({ status: 'completed' }))).toBe(false)
    expect(canChangeCopyRate(warmJob({ config: { migrationType: 'cold' } }))).toBe(false)
    expect(canChangeCopyRate(null)).toBe(false)
  })
})

describe('CopyRateButton', () => {
  it('renders nothing for a finished migration', () => {
    const { container } = render(<CopyRateButton job={warmJob({ status: 'failed' })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('changes the cap of a single migration from its dialog, showing the share in force', async () => {
    answers['GET /api/v1/migrations/j1/copy-rate'] = { data: { copyRateLimit: { mbps: 40 }, scope: 'job', batchId: null, perHostMbps: null, effectiveMbps: 40, editable: true } }
    render(<CopyRateButton job={warmJob()} />)
    fireEvent.click(screen.getByTestId('copy-rate-button'))

    expect(await screen.findByText('copyRate.dialogTitle')).toBeInTheDocument()
    expect(screen.getByText('copyRate.inForce {"rate":"40 copyRate.unit"}')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('copy-rate-input'), { target: { value: '25' } })
    fireEvent.click(screen.getByTestId('copy-rate-confirm'))

    await waitFor(() => expect(calls()).toContain('PATCH /api/v1/migrations/j1/copy-rate'))
    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')!
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ copyRateLimit: { mbps: 25 } })
    await waitFor(() => expect(screen.queryByText('copyRate.dialogTitle')).not.toBeInTheDocument())
  })

  it('changes the cap of the batch for a migration of a batch', async () => {
    answers['GET /api/v1/migrations/j1/copy-rate'] = { data: { copyRateLimit: { mbps: 80 }, scope: 'batch', batchId: 'b1', perHostMbps: 30, effectiveMbps: null, editable: true } }
    render(<CopyRateButton job={warmJob({ batchId: 'b1' })} />)
    fireEvent.click(screen.getByTestId('copy-rate-button'))

    expect(await screen.findByText('copyRate.dialogTitleBatch')).toBeInTheDocument()
    expect(screen.getByText('copyRate.perHostNote {"rate":"30 copyRate.unit"}')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('copy-rate-confirm'))
    await waitFor(() => expect(calls()).toContain('POST /api/v1/migrations/batches/b1/copy-rate'))
  })

  it('opens on a batch and removes its cap', async () => {
    answers['GET /api/v1/migrations/batches/b1/copy-rate'] = { data: { copyRateLimit: { mbps: 80 }, perHostMbps: null, editable: true } }
    render(<CopyRateButton batchId="b1" batchStatus="running" />)
    fireEvent.click(screen.getByTestId('copy-rate-button'))
    await screen.findByText('copyRate.dialogTitleBatch')
    fireEvent.click(screen.getByTestId('copy-rate-remove'))
    await waitFor(() => expect(calls()).toContain('POST /api/v1/migrations/batches/b1/copy-rate'))
    const post = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ copyRateLimit: null })
  })

  it('keeps the dialog open with the refusal', async () => {
    answers['GET /api/v1/migrations/j1/copy-rate'] = { data: { copyRateLimit: null, scope: 'job', batchId: null, perHostMbps: null, effectiveMbps: null, editable: true } }
    answers['PATCH /api/v1/migrations/j1/copy-rate'] = { error: 'The copy rate cap needs the migration feature (Enterprise)' }
    render(<CopyRateButton job={warmJob()} />)
    fireEvent.click(screen.getByTestId('copy-rate-button'))
    await screen.findByText('copyRate.dialogTitle')
    fireEvent.click(screen.getByTestId('copy-rate-confirm'))
    expect(await screen.findByText('The copy rate cap needs the migration feature (Enterprise)')).toBeInTheDocument()
    expect(screen.getByText('copyRate.dialogTitle')).toBeInTheDocument()
  })

  it('does not apply while the typed value is not a cap', async () => {
    answers['GET /api/v1/migrations/j1/copy-rate'] = { data: { copyRateLimit: { mbps: 40 }, scope: 'job', batchId: null, perHostMbps: null, effectiveMbps: null, editable: true } }
    render(<CopyRateButton job={warmJob()} />)
    fireEvent.click(screen.getByTestId('copy-rate-button'))
    await screen.findByText('copyRate.dialogTitle')
    fireEvent.change(screen.getByTestId('copy-rate-input'), { target: { value: '1.5' } })
    expect(screen.getByTestId('copy-rate-confirm')).toBeDisabled()
    fireEvent.change(screen.getByTestId('copy-rate-input'), { target: { value: '15' } })
    expect(screen.getByTestId('copy-rate-confirm')).toBeEnabled()
  })

  // In the migration window the control sits next to the throughput it changes.
  it('shows as an icon with its name in the tooltip, and opens the same dialog', async () => {
    answers['GET /api/v1/migrations/j1/copy-rate'] = { data: { copyRateLimit: { mbps: 20 }, scope: 'job', batchId: null, perHostMbps: null, effectiveMbps: 20, editable: true } }
    render(<CopyRateButton job={warmJob()} variant="icon" />)
    const icon = screen.getByTestId('copy-rate-button')
    expect(icon).toHaveAttribute('aria-label', 'copyRate.button')
    expect(icon).not.toHaveTextContent('copyRate.button')
    fireEvent.click(icon)
    expect(await screen.findByText('copyRate.dialogTitle')).toBeInTheDocument()
  })

  it('renders nothing on a batch that is over', () => {
    const { container } = render(<CopyRateButton batchId="b1" batchStatus="completed" />)
    expect(container).toBeEmptyDOMElement()
  })
})
