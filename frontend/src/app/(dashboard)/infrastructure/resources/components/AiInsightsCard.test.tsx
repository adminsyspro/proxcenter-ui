/**
 * Tests for the AI Insights card, centred on what it shows while it waits.
 *
 * A local model answers in tens of seconds. The card used to blank its whole
 * body for that time — the empty state is hidden as soon as `loading` is set,
 * and nothing replaced it — so the only sign of life was a 16px spinner in the
 * button. That reads as a hung page, not a slow one, which is what these tests
 * pin down: a shaped placeholder on the first analysis, and the previous answer
 * kept on screen under a progress bar on a refresh.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import type { AiAnalysis } from '../types'

import AiInsightsCard from './AiInsightsCard'

const RECOMMENDATION = {
  id: 'rec_1',
  type: 'overprovisioned',
  severity: 'medium',
  title: 'Too many vCPUs on web-01',
  description: 'web-01 holds 8 vCPUs for a 12% average load.',
  vmName: 'web-01',
}

function analysis(overrides: Partial<AiAnalysis> = {}): AiAnalysis {
  return {
    summary: '',
    recommendations: [],
    loading: false,
    provider: 'ollama',
    ...overrides,
  } as AiAnalysis
}

function renderCard(overrides: Partial<AiAnalysis> = {}) {
  const onAnalyze = vi.fn()

  renderWithProviders(<AiInsightsCard analysis={analysis(overrides)} onAnalyze={onAnalyze} />)

  return { onAnalyze }
}

const skeleton = () => screen.queryByTestId('ai-insights-skeleton')
const progressBar = () => screen.queryByRole('progressbar', { name: 'Analyzing...' })

describe('AiInsightsCard', () => {
  afterEach(cleanup)

  it('invites the first analysis while nothing is running', () => {
    renderCard()

    expect(screen.getByText('Analyze your infrastructure')).toBeInTheDocument()
    expect(skeleton()).not.toBeInTheDocument()
    expect(progressBar()).not.toBeInTheDocument()
  })

  describe('while the first analysis runs', () => {
    it('fills the body with a placeholder instead of emptying it', () => {
      renderCard({ loading: true })

      const placeholder = skeleton()

      expect(placeholder).toBeInTheDocument()
      expect(placeholder).toHaveAttribute('aria-busy', 'true')

      // The invitation must go: it offers an action that is already running.
      expect(screen.queryByText('Analyze your infrastructure')).not.toBeInTheDocument()
    })

    it('warns that a local model is slow, so the wait does not read as a freeze', () => {
      renderCard({ loading: true })

      expect(screen.getByText('A local model can take up to a minute to answer.')).toBeInTheDocument()
    })

    it('disables the button and labels it as running', () => {
      renderCard({ loading: true })

      const button = screen.getByRole('button', { name: /Analyzing/ })

      expect(button).toBeDisabled()
    })
  })

  describe('while a refresh runs over an existing answer', () => {
    const refreshing = { loading: true, summary: 'Cluster is healthy.', recommendations: [RECOMMENDATION] }

    it('keeps the previous answer readable rather than blanking the card', () => {
      renderCard(refreshing as Partial<AiAnalysis>)

      expect(screen.getByText('Cluster is healthy.')).toBeInTheDocument()
      expect(screen.getByText('Too many vCPUs on web-01')).toBeInTheDocument()

      // The placeholder belongs to the empty case only; showing it here would
      // throw away figures the operator is still reading.
      expect(skeleton()).not.toBeInTheDocument()
    })

    it('shows an indeterminate bar, since the answer time is unknown', () => {
      renderCard(refreshing as Partial<AiAnalysis>)

      const bar = progressBar()

      expect(bar).toBeInTheDocument()
      expect(bar).not.toHaveAttribute('aria-valuenow')
    })
  })

  describe('once the analysis lands', () => {
    it('shows the summary and its recommendations, with no waiting indicator', () => {
      renderCard({ summary: 'Cluster is healthy.', recommendations: [RECOMMENDATION] } as Partial<AiAnalysis>)

      expect(screen.getByText('Cluster is healthy.')).toBeInTheDocument()
      expect(screen.getByText('Too many vCPUs on web-01')).toBeInTheDocument()
      expect(screen.getByText('web-01')).toBeInTheDocument()

      expect(skeleton()).not.toBeInTheDocument()
      expect(progressBar()).not.toBeInTheDocument()
    })

    it('surfaces a failure instead of leaving the card silent', () => {
      renderCard({ error: 'Analysis error' })

      expect(screen.getByRole('alert')).toHaveTextContent('Analysis error')
      expect(skeleton()).not.toBeInTheDocument()
    })
  })
})
