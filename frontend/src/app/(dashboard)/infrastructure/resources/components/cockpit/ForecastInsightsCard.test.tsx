import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { ForecastInsights, ForecastOutlookItem } from '@/lib/resources/forecastInsights'

import type { NodeCapacity } from '../../types'
import ForecastInsightsCard from './ForecastInsightsCard'

afterEach(cleanup)

const GENERATED_AT = '2026-10-31T09:30:00.000Z'

function node(overrides: Partial<NodeCapacity>): NodeCapacity {
  return {
    key: 'c1:pve1',
    connectionId: 'c1',
    connectionName: 'Prod',
    node: 'pve1',
    online: true,
    cores: 16,
    cpuPct: 20,
    memTotal: 64 * 1024 ** 3,
    memUsed: 32 * 1024 ** 3,
    ramPct: 50,
    vcpuAllocated: 32,
    ramAllocated: 48 * 1024 ** 3,
    guestsRunning: 5,
    guestsTotal: 6,
    ...overrides,
  }
}

function outlook(overrides: Partial<ForecastOutlookItem>): ForecastOutlookItem {
  return {
    ref: 'r1',
    kind: 'cluster',
    name: 'Prod',
    cluster: 'Prod',
    node: null,
    resource: 'ram',
    risk: 'high',
    pct: 81.6,
    days: 12,
    explanation: 'Model explanation',
    action: 'Model action',
    ...overrides,
  }
}

function insights(overrides: Partial<ForecastInsights>): ForecastInsights {
  return {
    provider: 'anthropic',
    model: 'claude',
    generatedAt: GENERATED_AT,
    summary: 'Model summary of the forecast',
    outlook: [],
    dataConfidence: 'medium',
    historyDays: 45,
    ...overrides,
  }
}

type Props = React.ComponentProps<typeof ForecastInsightsCard>

function renderCard(overrides: Partial<Props> = {}) {
  const onRegenerate = vi.fn()

  renderWithProviders(
    <ForecastInsightsCard insights={null} loading={false} failed={false} onRegenerate={onRegenerate} nodes={[]} isAllScope={false} {...overrides} />,
  )

  return { onRegenerate }
}

/** The clickable line of an outlook row, found by its scope label. */
function rowOf(scope: string): HTMLElement {
  const line = screen.getByText(scope).parentElement
  if (!line) throw new Error(`no row for ${scope}`)

  return line
}

describe('ForecastInsightsCard frame', () => {
  it('shows the forecast title and idle subtitle before any reading, and regenerates on click', () => {
    const { onRegenerate } = renderCard()

    expect(screen.getByText('AI forecast reading')).toBeInTheDocument()
    expect(screen.getByText('What the forecast means and where to start')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('shows the forecast pending texts while the first reading loads', () => {
    renderCard({ loading: true })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Reading the forecast')
    expect(status).toHaveTextContent(/reading the forecast of every cluster and pool/)
  })

  it('shows the history confidence chip of a reading', () => {
    renderCard({ insights: insights({ dataConfidence: 'low', historyDays: 12 }) })

    expect(screen.getByText('12 d of history, low reliability')).toBeInTheDocument()
  })

  it('says there is nothing to handle on an empty outlook', () => {
    renderCard({ insights: insights({ outlook: [] }) })

    expect(screen.getByText('No capacity risk within the forecast horizon.')).toBeInTheDocument()
  })
})

describe('ForecastInsightsCard summary', () => {
  it('uses the model summary of a model reading', () => {
    renderCard({ insights: insights({ summary: 'Two clusters fill up soon' }) })

    expect(screen.getByText('Two clusters fill up soon')).toBeInTheDocument()
  })

  it('translates the summary key of a rule-based reading with its params', () => {
    renderCard({
      insights: insights({ provider: 'basic', summary: '', summaryKey: 'summaryUrgent', summaryParams: { total: 3, high: 1, first: 'Prod RAM' } }),
    })

    expect(screen.getByText('3 capacity risks, 1 of them to handle soon. Most urgent: Prod RAM.')).toBeInTheDocument()
  })

  it('keeps the plain summary of a rule-based reading without a key', () => {
    renderCard({ insights: insights({ provider: 'basic', summary: 'Plain rule summary' }) })

    expect(screen.getByText('Plain rule summary')).toBeInTheDocument()
  })
})

describe('ForecastInsightsCard outlook rows', () => {
  it('shows a model row with its figures, risk and action, and its explanation once expanded', () => {
    const item = outlook({ explanation: 'RAM grows fast on Prod', action: 'Buy RAM for Prod' })
    renderCard({ insights: insights({ outlook: [item] }), nodes: [node({})] })

    const row = rowOf('Prod')
    expect(within(row).getByText('RAM')).toBeInTheDocument()
    expect(within(row).getByText('82%')).toBeInTheDocument()
    expect(within(row).getByText('12 d')).toBeInTheDocument()
    expect(within(row).getByText('Buy RAM for Prod')).toBeInTheDocument()
    expect(within(row).getByText('High')).toBeInTheDocument()
    expect(row.querySelector('.ri-server-fill')).not.toBeNull()
    expect(screen.queryByText('RAM grows fast on Prod')).not.toBeInTheDocument()

    const toggle = within(row).getByRole('button', { name: 'Expand' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(row)
    expect(within(row).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('RAM grows fast on Prod')).toBeInTheDocument()
    expect(screen.getAllByText('Buy RAM for Prod')).toHaveLength(2)
  })

  it('translates the rule-based explanation and action keys with the row params', () => {
    const item = outlook({
      resource: 'cpu',
      pct: 70.4,
      days: 30,
      explanation: '',
      action: '',
      explanationKey: 'explainRunway',
      actionKey: 'actionCpu',
      params: { slope: 0.5, threshold: 90 },
    })
    renderCard({ insights: insights({ provider: 'basic', outlook: [item] }) })

    fireEvent.click(rowOf('Prod'))

    expect(screen.getByText('CPU at 70%, rising 0.5 points a day: the 90% critical threshold is reached in 30 days.')).toBeInTheDocument()
    expect(screen.getAllByText('Rebalance guests across nodes or review the vCPU ratio before adding more.').length).toBeGreaterThan(0)
  })

  it('labels an N+1 risk as N+1 and names the node and the cluster', () => {
    const item = outlook({
      explanation: '',
      action: '',
      explanationKey: 'explainNPlusOne',
      actionKey: 'actionNPlusOne',
      params: { node: 'pve2', ram: 104 },
    })
    renderCard({ insights: insights({ provider: 'basic', outlook: [item] }) })

    const row = rowOf('Prod')
    expect(within(row).getByText('N+1')).toBeInTheDocument()

    fireEvent.click(row)
    expect(screen.getByText(/If pve2 goes down, the other nodes of Prod reach 104% RAM/)).toBeInTheDocument()
  })

  it('names the whole estate on the all-clusters scope', () => {
    renderCard({ insights: insights({ outlook: [outlook({ kind: 'estate', name: 'All', cluster: null, risk: 'low' })] }), isAllScope: true })

    const row = rowOf('Whole estate')
    expect(row.querySelector('.ri-global-line')).not.toBeNull()
    expect(within(row).getByText('Low')).toBeInTheDocument()
  })

  it('keeps the estate name outside the all-clusters scope', () => {
    renderCard({ insights: insights({ outlook: [outlook({ kind: 'estate', name: 'Prod estate', cluster: null })] }), isAllScope: false })

    expect(rowOf('Prod estate')).toBeInTheDocument()
    expect(screen.queryByText('Whole estate')).not.toBeInTheDocument()
  })

  it('shows a local pool with its node, a shared pool without, and their run-out wording', () => {
    const local = outlook({ ref: 'p1', kind: 'pool', name: 'local-lvm', node: 'pve1', resource: 'storage', risk: 'medium', days: 0 })
    const shared = outlook({ ref: 'p2', kind: 'pool', name: 'ceph', node: null, resource: 'storage', risk: 'low', days: null })
    renderCard({ insights: insights({ outlook: [local, shared] }) })

    const localRow = rowOf('local-lvm (pve1)')
    expect(localRow.querySelector('.ri-hard-drive-2-line')).not.toBeNull()
    expect(within(localRow).getByText('Exceeded')).toBeInTheDocument()
    expect(within(localRow).getByText('Medium')).toBeInTheDocument()

    const sharedRow = rowOf('ceph')
    expect(sharedRow.querySelector('.ri-share-line')).not.toBeNull()
    expect(within(sharedRow).getByText('> 1 year')).toBeInTheDocument()
  })

  it('pages a long outlook', () => {
    const items = Array.from({ length: 25 }, (_, i) => outlook({ ref: `r${i}`, name: `cluster-${i}`, cluster: `cluster-${i}` }))
    renderCard({ insights: insights({ outlook: items }) })

    expect(screen.getByText('cluster-0')).toBeInTheDocument()
    expect(screen.queryByText('cluster-24')).not.toBeInTheDocument()
  })
})
