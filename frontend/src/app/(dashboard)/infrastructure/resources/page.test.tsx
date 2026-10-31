import type { ReactNode } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import enMessages from '@/messages/en.json'

import type { ActionItem } from './algorithms/capacityPlanning'

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  tab: null as string | null,
  loadData: vi.fn(),
  resourceArgs: [] as unknown[][],
  aiArgs: [] as unknown[][],
  regenerate: vi.fn(),
  data: {} as Record<string, unknown>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(h.tab ? `tab=${h.tab}` : ''),
}))
vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: vi.fn() }) }))
vi.mock('@/components/guards/EnterpriseGuard', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/guards/ProviderTenantGuard', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/skeletons', () => ({ PageSkeleton: () => <div data-testid="skeleton" /> }))
vi.mock('./hooks/useResourceData', () => ({
  useResourceData: (...args: unknown[]) => {
    h.resourceArgs.push(args)

    return { ...h.data, loadData: h.loadData }
  },
}))
vi.mock('./hooks/useHistoryWindow', () => ({ useHistoryWindow: () => [90, vi.fn()] }))
vi.mock('./hooks/usePlanningAssumptions', () => ({ usePlanningAssumptions: () => [{ vmVcpu: 2, vmRamGb: 4 }, vi.fn()] }))
vi.mock('./hooks/useAiReading', () => ({
  useAiReading: (...args: unknown[]) => {
    h.aiArgs.push(args)

    return { reading: null, loading: false, failed: false, regenerate: h.regenerate }
  },
}))

// Children are stubbed: this test checks how the page wires them, each has its own test.
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => ({
    default: (props: Record<string, unknown>) => (
      <div data-testid={name} data-props={JSON.stringify(props, (_k, v: unknown) => (typeof v === 'function' ? 'fn' : v))} />
    ),
  }),
}))

vi.mock('./components/GlobalHealthScore', () => stub('health'))
vi.mock('./components/PredictiveAlertsCard', () => stub('forecast-dials'))
vi.mock('./components/ProjectionChart', () => stub('chart'))
vi.mock('./components/GreenMetricsCard', () => stub('green'))
vi.mock('./components/OverprovisioningCard', () => stub('overprovisioning'))
vi.mock('./components/NetworkIoCard', () => stub('network'))
vi.mock('./components/cockpit/HealthTrendCard', () => stub('health-trend'))
vi.mock('./components/cockpit/ClusterCapacityTable', () => stub('clusters'))
vi.mock('./components/cockpit/NodeHeatmap', () => stub('nodes'))
vi.mock('./components/cockpit/StoragePoolsTable', () => stub('pools'))
vi.mock('./components/cockpit/CapacitySimulator', () => stub('simulator'))
vi.mock('./components/VmDetailDrawer', () => ({
  default: ({ vm }: { vm: { name: string } | null }) => <div data-testid="drawer">{vm?.name ?? ''}</div>,
}))
vi.mock('./components/ClusterSelector', () => ({
  default: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange('prod')}>pick prod</button>,
}))
vi.mock('./components/cockpit/ActionList', () => ({
  default: ({ onOpen }: { onOpen: (item: ActionItem) => void }) => (
    <>
      <button onClick={() => onOpen({ id: 'a', severity: 'critical', kind: 'nPlusOne', params: {}, tab: 'simulation', target: { section: 'simulator', key: 'prod' } })}>open simulator</button>
      <button onClick={() => onOpen({ id: 'b', severity: 'warning', kind: 'poolRunway', params: {}, tab: 'capacity', target: { section: 'pools', key: 'prod::ceph' } })}>open pool</button>
    </>
  ),
}))
vi.mock('./components/cockpit/TopConsumersCard', () => ({
  default: ({ onOpenVm }: { onOpenVm: (vm: { name: string }) => void }) => <button onClick={() => onOpenVm({ name: 'web-01' })}>open web-01</button>,
}))
vi.mock('./components/cockpit/ForecastInsightsCard', () => ({
  default: ({ onRegenerate }: { onRegenerate: () => void }) => <button onClick={onRegenerate}>regenerate forecast</button>,
}))
vi.mock('./components/cockpit/OptimizationPlanCard', () => ({
  default: ({ onRegenerate }: { onRegenerate: () => void }) => <button onClick={onRegenerate}>regenerate plan</button>,
}))

import ResourcesPage from './page'

const thresholds = { cpu: { warning: 80, critical: 90 }, ram: { warning: 80, critical: 90 }, storage: { warning: 80, critical: 90 } }
const trends = Array.from({ length: 20 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10)

  return { t: d, d, cpu: 10, ram: 50, storage: 40 }
})

const loaded = {
  loading: false,
  error: null,
  kpis: {
    cpu: { used: 10, allocated: 10, total: 10, trend: 0 },
    ram: { used: 50, allocated: 10, total: 10, trend: 0 },
    storage: { used: 40, total: 100, trend: 0 },
    vms: { total: 2, running: 2, stopped: 0 },
    efficiency: 50,
  },
  trends,
  trendsPeriod: null,
  historyAvailableDays: 20,
  topCpuVms: [],
  topRamVms: [],
  green: null,
  greenConfigured: false,
  overprovisioning: null,
  networkMetrics: { totalIn: 1 },
  connections: [{ id: 'prod', name: 'PVE-PROD' }],
  thresholds,
  storagePools: [],
  healthScoreHistory: [],
  clusters: [],
  nodes: [],
  stoppedAllocation: { count: 0, vcpu: 0, ramBytes: 0, diskBytes: 0 },
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ThemeProvider theme={createTheme()}>
        <ResourcesPage />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )
}

const props = (testId: string) => JSON.parse(screen.getByTestId(testId).getAttribute('data-props') ?? '{}')
const lastAi = (path: string) => h.aiArgs.filter(a => a[0] === path).at(-1)

beforeEach(() => {
  h.replace.mockReset()
  h.loadData.mockReset()
  h.regenerate.mockReset()
  h.resourceArgs = []
  h.aiArgs = []
  h.tab = null
  h.data = { ...loaded }
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ResourcesPage', () => {
  it('opens on the capacity tab and reads only the forecast with the model', () => {
    renderPage()

    expect(screen.getByTestId('chart')).toBeInTheDocument()
    expect(screen.getByTestId('pools')).toBeInTheDocument()
    expect(props('forecast-dials').alerts).toHaveLength(3)
    expect(lastAi('/api/v1/resources/forecast-insights')).toEqual(['/api/v1/resources/forecast-insights', undefined, true])
    expect(lastAi('/api/v1/resources/optimization-plan')).toEqual(['/api/v1/resources/optimization-plan', undefined, false])

    fireEvent.click(screen.getByText('regenerate forecast'))
    expect(h.regenerate).toHaveBeenCalled()
  })

  it('scopes the data, the AI readings and the PDF to the picked cluster', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Export PDF' })).toHaveAttribute('href', '/api/v1/resources/report')

    fireEvent.click(screen.getByText('pick prod'))

    expect(h.resourceArgs.at(-1)).toEqual(['prod', 90])
    expect(lastAi('/api/v1/resources/forecast-insights')?.[1]).toBe('prod')
    expect(screen.getByRole('link', { name: 'Export PDF' })).toHaveAttribute('href', '/api/v1/resources/report?connectionId=prod')
  })

  it('reloads on refresh and puts a tab change in the URL', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(h.loadData).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: /AI/ }))
    expect(h.replace).toHaveBeenCalledWith('/?tab=ai', { scroll: false })
  })

  it('reads the optimisation plan only on the AI tab', () => {
    h.tab = 'ai'
    renderPage()

    expect(lastAi('/api/v1/resources/optimization-plan')?.[2]).toBe(true)
    expect(lastAi('/api/v1/resources/forecast-insights')?.[2]).toBe(false)
    fireEvent.click(screen.getByText('regenerate plan'))
    expect(h.regenerate).toHaveBeenCalled()
  })

  it('opens a guest of the efficiency tab in the VM drawer', () => {
    h.tab = 'efficiency'
    renderPage()

    expect(screen.getByTestId('network')).toBeInTheDocument()
    fireEvent.click(screen.getByText('open web-01'))
    expect(screen.getByTestId('drawer')).toHaveTextContent('web-01')
  })

  it('shows the sustainability and simulation tabs', () => {
    h.tab = 'sustainability'
    const { unmount } = renderPage()
    expect(screen.getByTestId('green')).toBeInTheDocument()
    unmount()

    h.tab = 'simulation'
    renderPage()
    expect(props('simulator').initialClusterId).toBeUndefined()
    expect(props('simulator').assumptions).toEqual({ vmVcpu: 2, vmRamGb: 4 })
  })

  it('sends a "To handle" item to its tab, scrolls to it and presets the simulator on its cluster', () => {
    vi.useFakeTimers()
    h.tab = 'simulation'
    renderPage()

    fireEvent.click(screen.getByText('open simulator'))
    act(() => { vi.advanceTimersByTime(100) })

    expect(h.replace).toHaveBeenCalledWith('/?tab=simulation', { scroll: false })
    expect(props('simulator')).toMatchObject({ initialClusterId: 'prod', initialScenario: { loseLargestNode: true } })
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('highlights the row of a pool item', () => {
    renderPage()

    fireEvent.click(screen.getByText('open pool'))

    expect(props('pools').focus).toMatchObject({ key: 'prod::ceph' })
    expect(props('clusters').focus).toBeNull()
  })

  it('shows a skeleton on the first load and the load error', () => {
    h.data = { ...loaded, loading: true, kpis: null }
    const { unmount } = renderPage()
    expect(screen.getByTestId('skeleton')).toBeInTheDocument()
    unmount()

    h.data = { ...loaded, error: 'Proxmox unreachable' }
    renderPage()
    expect(screen.getByText('Proxmox unreachable')).toBeInTheDocument()
  })
})
