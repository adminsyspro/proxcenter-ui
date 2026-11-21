import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import FrameworksTab from './FrameworksTab'
import * as useFrameworkAssessmentsModule from '@/hooks/useFrameworkAssessments'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
}))

const { addTaskMock, toastInfoMock } = vi.hoisted(() => ({ addTaskMock: vi.fn(), toastInfoMock: vi.fn() }))

vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({ addTask: addTaskMock }),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ info: toastInfoMock }),
}))

vi.mock('@/lib/compliance/frameworks', () => ({
  getFramework: (id: string) => ({
    id,
    name: 'Test FW',
    version: 'Rev 5',
    baselineLabel: 'Moderate baseline',
    controls: [],
    sourceUrl: 'https://example.com/framework',
  }),
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

const BASE_ASSESSMENT = {
  frameworkId: 'nist-800-171-r3',
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
}

const TWO_NODES_RETURN = {
  assessments: [BASE_ASSESSMENT],
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

  it('renders the framework logo image with the framework name as alt', () => {
    render(<FrameworksTab />)
    const logos = screen.getAllByRole('img', { name: 'Test FW' })
    expect(logos.length).toBeGreaterThan(0)
    expect(logos[0]).toHaveAttribute('src', expect.stringContaining('/images/frameworks/'))
  })

  it('renders the assessed count (new style, no slash-total)', () => {
    render(<FrameworksTab />)
    // New design shows "5 controlsAssessed" without "/110"
    expect(screen.getByText(/5.*controlsAssessed/)).toBeInTheDocument()
    // Old coverage label "5 / 110" must NOT appear as standalone text
    expect(screen.queryByText(/5 \/ 110/)).toBeNull()
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
    const trigger = screen.getByLabelText('info-nist-800-171-r3')
    expect(trigger).toBeInTheDocument()
  })

  it('renders visible context text on the card (not tooltip-only)', () => {
    render(<FrameworksTab />)
    // The context key is rendered via t(`context.${frameworkId}`) = "context.nist-800-171-r3"
    const contextEl = screen.getByTestId('context-nist-800-171-r3')
    expect(contextEl).toBeInTheDocument()
    expect(contextEl.textContent).toContain('context.nist-800-171-r3')
  })

  it('does NOT render the old per-family list (e.g. "Access Control:" text)', () => {
    render(<FrameworksTab />)
    // The 19-family list entries like "Access Control: 0/24" must be gone
    expect(screen.queryByText(/Access Control:/)).toBeNull()
  })
})

describe('FrameworksTab with single node', () => {
  beforeEach(() => {
    vi.mocked(useFrameworkAssessmentsModule.useFrameworkAssessments).mockReturnValue({
      assessments: [BASE_ASSESSMENT],
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

describe('FrameworksTab with null score', () => {
  beforeEach(() => {
    vi.mocked(useFrameworkAssessmentsModule.useFrameworkAssessments).mockReturnValue({
      assessments: [{ ...BASE_ASSESSMENT, score: null, assessedControls: 0 }],
      nodes: [],
      isLoading: false,
      error: null,
    })
  })

  it('renders noAssessedShort in gauge when score is null', () => {
    render(<FrameworksTab />)
    const gauge = screen.getByTestId('gauge')
    expect(gauge.textContent).toContain('noAssessedShort')
  })

  it('renders noAssessed label when score is null', () => {
    render(<FrameworksTab />)
    expect(screen.getByText('noAssessed')).toBeInTheDocument()
  })
})

describe('FrameworksTab report download (background job)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useFrameworkAssessmentsModule.useFrameworkAssessments).mockReturnValue(TWO_NODES_RETURN)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const clickDownload = () => fireEvent.click(screen.getAllByRole('button', { name: /downloadReport/ })[0])

  it('starts a report job and hands it to the taskbar instead of waiting for the PDF', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'job-1', status: 'running' } }), { status: 202 }))
    render(<FrameworksTab />)

    clickDownload()

    await waitFor(() => expect(addTaskMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/compliance/report-jobs', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ frameworkId: 'nist-800-171-r3', connectionId: 'conn-1' })
    expect(addTaskMock.mock.calls[0][0]).toMatchObject({
      id: 'report-job-1',
      type: 'report',
      status: 'running',
      detail: 'Test Connection',
      statusUrl: '/api/v1/compliance/report-jobs/job-1',
      downloadUrl: '/api/v1/compliance/report-jobs/job-1/download',
    })
    expect(toastInfoMock).toHaveBeenCalledWith(expect.stringContaining('reportQueued'), 6000)
  })

  it('says so when too many reports are already being generated', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'E_TOO_MANY_REPORT_JOBS' }), { status: 429 }))
    render(<FrameworksTab />)

    clickDownload()

    expect(await screen.findByText('tooManyReports')).toBeInTheDocument()
    expect(addTaskMock).not.toHaveBeenCalled()
  })

  it('reports a generic failure otherwise', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }))
    render(<FrameworksTab />)

    clickDownload()

    expect(await screen.findByText('reportFailed')).toBeInTheDocument()
    expect(addTaskMock).not.toHaveBeenCalled()
  })
})
