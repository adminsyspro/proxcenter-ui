import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import FrameworksTab from './FrameworksTab'
import * as useFrameworkAssessmentsModule from '@/hooks/useFrameworkAssessments'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

vi.mock('@/lib/compliance/frameworks', () => ({
  getFramework: (id: string) => ({ id, name: 'Test FW', version: 'vX', controls: [], sourceUrl: 'https://example.com/framework' }),
}))

vi.mock('@/hooks/useConnections', () => ({
  usePVEConnections: () => ({
    data: { data: [{ id: 'conn-1', name: 'Test Connection' }] },
  }),
}))

vi.mock('@mui/material/styles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material/styles')>()
  return {
    ...actual,
    useTheme: () => ({ palette: { divider: '#e0e0e0' } }),
  }
})

vi.mock('@/components/dashboard/widgets/CircularGauge', () => ({
  default: ({ children }: any) => <div data-testid="gauge">{children}</div>,
}))

vi.mock('@/hooks/useFrameworkAssessments', () => ({
  useFrameworkAssessments: vi.fn(),
}))

const TWO_NODES_MOCK = [
  {
    node: 'pve1',
    checks: [
      { id: 'c1', name: 'SSH check', category: 'ssh', severity: 'high', status: 'fail' },
      { id: 'c2', name: 'OS check', category: 'os', severity: 'medium', status: 'pass' },
    ],
  },
  {
    node: 'pve2',
    checks: [
      { id: 'c3', name: 'SSH check', category: 'ssh', severity: 'high', status: 'pass' },
    ],
  },
]

const TWO_NODES_RETURN = {
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
      controls: [],
    },
  ],
  nodes: TWO_NODES_MOCK,
  isLoading: false,
  error: null,
}

beforeEach(() => {
  vi.mocked(useFrameworkAssessmentsModule.useFrameworkAssessments).mockReturnValue(TWO_NODES_RETURN)
})

afterEach(() => {
  cleanup()
})

describe('FrameworksTab', () => {
  it('renders a framework card with its score inside the gauge', () => {
    render(<FrameworksTab />)
    const gauge = screen.getByTestId('gauge')
    expect(gauge).toBeInTheDocument()
    expect(gauge.textContent).toContain('60%')
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

  it('shows per-node section with both node names when nodes.length > 1', () => {
    render(<FrameworksTab />)
    expect(screen.getAllByText('pve1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('pve2').length).toBeGreaterThan(0)
  })

  it('shows the perNodeTitle heading when nodes.length > 1', () => {
    render(<FrameworksTab />)
    expect(screen.getAllByText('perNodeTitle').length).toBeGreaterThan(0)
  })

  it('renders a link to the framework sourceUrl', () => {
    render(<FrameworksTab />)
    const link = screen.getByRole('link', { name: 'sourceLink' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://example.com/framework')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders the info icon tooltip trigger for the framework context', () => {
    render(<FrameworksTab />)
    // The tooltip trigger has aria-label="info-<frameworkId>"
    const trigger = screen.getByLabelText('info-nist-800-171-r2')
    expect(trigger).toBeInTheDocument()
  })
})

describe('FrameworksTab with single node', () => {
  beforeEach(() => {
    vi.mocked(useFrameworkAssessmentsModule.useFrameworkAssessments).mockReturnValue({
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
          controls: [],
        },
      ],
      nodes: [{ node: 'pve1', checks: [] }],
      isLoading: false,
      error: null,
    })
  })

  it('does not show per-node section when nodes.length <= 1', () => {
    render(<FrameworksTab />)
    expect(screen.queryByText('perNodeTitle')).toBeNull()
  })
})
