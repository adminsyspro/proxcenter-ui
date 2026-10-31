import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import AiReadingCard, { type ReadingMeta } from './AiReadingCard'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const GENERATED_AT = '2026-10-31T14:05:00.000Z'
const TIME = new Date(GENERATED_AT).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

const ERROR_TEXT = 'Could not get this AI reading.'
const MODEL_FAILED_TEXT = 'The AI model did not answer in time: rule-based reading shown.'
const NO_MODEL_TEXT = /No AI model configured/
const DISCLAIMER_TEXT = /Text written by an AI model/

type Props = React.ComponentProps<typeof AiReadingCard>

function renderCard(overrides: Partial<Props> = {}) {
  const onRegenerate = vi.fn()
  const props: Props = {
    icon: 'ri-sparkling-line',
    title: 'Reading title',
    idleSubtitle: 'Idle subtitle',
    pendingTitle: 'Reading in progress',
    pendingHint: 'Please wait for the model',
    reading: null,
    summary: '',
    loading: false,
    failed: false,
    onRegenerate,
    children: <div>reading body</div>,
    ...overrides,
  }

  renderWithProviders(<AiReadingCard {...props} />)

  return { onRegenerate }
}

const modelReading: ReadingMeta = { provider: 'openai', model: 'gpt-4o', generatedAt: GENERATED_AT }
const basicReading: ReadingMeta = { provider: 'basic', generatedAt: GENERATED_AT }

describe('AiReadingCard subtitle', () => {
  it('shows the idle subtitle and no body before any reading', () => {
    renderCard()

    expect(screen.getByText('Reading title')).toBeInTheDocument()
    expect(screen.getByText('Idle subtitle')).toBeInTheDocument()
    expect(screen.queryByText('reading body')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('names the model, the provider label and the time of a model reading', () => {
    renderCard({ reading: modelReading })

    expect(screen.getByText(`gpt-4o via OpenAI, at ${TIME}`)).toBeInTheDocument()
    expect(screen.queryByText('Idle subtitle')).not.toBeInTheDocument()
  })

  it('falls back to the raw provider id when it has no label, and to an empty model', () => {
    renderCard({ reading: { provider: 'mistral', generatedAt: GENERATED_AT } })

    expect(screen.getByText(` via mistral, at ${TIME}`, { normalizer: s => s })).toBeInTheDocument()
  })

  it('says a rule-based reading was made by the rules', () => {
    renderCard({ reading: basicReading })

    expect(screen.getByText(`Rule-based reading, at ${TIME}`)).toBeInTheDocument()
  })
})

describe('AiReadingCard actions', () => {
  it('calls onRegenerate on the regenerate button', () => {
    const { onRegenerate } = renderCard({ reading: modelReading })

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('disables the regenerate button while loading', () => {
    renderCard({ loading: true })

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
  })

  it('shows the extra action only once a reading exists', () => {
    renderCard({ extraAction: <span>extra chip</span> })
    expect(screen.queryByText('extra chip')).not.toBeInTheDocument()

    cleanup()
    renderCard({ reading: modelReading, extraAction: <span>extra chip</span> })
    expect(screen.getByText('extra chip')).toBeInTheDocument()
  })
})

describe('AiReadingCard pending states', () => {
  it('shows the pending loader with the elapsed seconds from 3 s on, when nothing is shown yet', () => {
    vi.useFakeTimers()
    renderCard({ loading: true })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Reading in progress')
    expect(status).toHaveTextContent('Please wait for the model')
    expect(screen.queryByText(/s elapsed/)).not.toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.queryByText(/s elapsed/)).not.toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText('4 s elapsed')).toBeInTheDocument()
  })

  it('keeps the previous reading dimmed under a progress bar while regenerating', () => {
    renderCard({ reading: modelReading, summary: 'Old summary', loading: true })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Reading in progress' })).toBeInTheDocument()
    expect(screen.getByText('Old summary')).toBeInTheDocument()
    expect(screen.getByText('reading body')).toBeInTheDocument()
  })
})

describe('AiReadingCard alerts and body', () => {
  it('shows the failure alert when not loading', () => {
    renderCard({ failed: true })

    expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument()
  })

  it('hides the failure alert while a new attempt is loading', () => {
    renderCard({ failed: true, loading: true })

    expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument()
  })

  it('warns that the model failed and the rules stand in, without the no-model hint', () => {
    renderCard({ reading: { ...basicReading, aiFailed: true } })

    expect(screen.getByText(MODEL_FAILED_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NO_MODEL_TEXT)).not.toBeInTheDocument()
  })

  it('explains that no model is configured on a rule-based reading, without the AI disclaimer', () => {
    renderCard({ reading: basicReading, summary: 'Rule summary' })

    expect(screen.getByText(NO_MODEL_TEXT)).toBeInTheDocument()
    expect(screen.getByText('Rule summary')).toBeInTheDocument()
    expect(screen.getByText('reading body')).toBeInTheDocument()
    expect(screen.queryByText(DISCLAIMER_TEXT)).not.toBeInTheDocument()
  })

  it('shows the summary, the body and the AI disclaimer on a model reading', () => {
    renderCard({ reading: modelReading, summary: 'Model summary' })

    expect(screen.getByText('Model summary')).toBeInTheDocument()
    expect(screen.getByText('reading body')).toBeInTheDocument()
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NO_MODEL_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(MODEL_FAILED_TEXT)).not.toBeInTheDocument()
  })

  it('omits the summary box when the summary is empty', () => {
    renderCard({ reading: modelReading, summary: '' })

    expect(screen.getByText('reading body')).toBeInTheDocument()
    expect(screen.queryByText('Model summary')).not.toBeInTheDocument()
  })
})
