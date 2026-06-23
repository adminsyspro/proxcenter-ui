import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import FrameworksTab from './FrameworksTab'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

vi.mock('@/lib/compliance/frameworks', () => ({
  getFramework: (id: string) => ({ id, name: 'Test FW', version: 'vX', controls: [] }),
}))

vi.mock('@/hooks/useConnections', () => ({
  usePVEConnections: () => ({
    data: { data: [{ id: 'conn-1', name: 'Test Connection' }] },
  }),
}))

vi.mock('@/hooks/useFrameworkAssessments', () => ({
  useFrameworkAssessments: () => ({
    assessments: [
      {
        frameworkId: 'nist-800-171-r2',
        score: 60,
        satisfied: 3,
        partial: 1,
        failed: 1,
        notAssessed: 105,
        assessedControls: 5,
        totalControls: 110,
        coverage: 0.04,
        families: [],
      },
    ],
    isLoading: false,
    error: null,
  }),
}))

describe('FrameworksTab', () => {
  it('renders a framework card with its score', () => {
    render(<FrameworksTab />)
    expect(screen.getByText('60%')).toBeInTheDocument()
  })

  it('renders the framework name', () => {
    render(<FrameworksTab />)
    expect(screen.getAllByText(/Test FW/).length).toBeGreaterThan(0)
  })

  it('renders the coverage label', () => {
    render(<FrameworksTab />)
    expect(screen.getAllByText(/5 \/ 110/).length).toBeGreaterThan(0)
  })

  it('renders the download button', () => {
    render(<FrameworksTab />)
    expect(screen.getAllByRole('button', { name: /downloadReport/ }).length).toBeGreaterThan(0)
  })
})
