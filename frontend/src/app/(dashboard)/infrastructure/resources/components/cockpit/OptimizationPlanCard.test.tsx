import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { OptimizationPlan, PlanGuest, PlanItem, PlanNode } from '@/lib/resources/optimizationPlan'

import OptimizationPlanCard from './OptimizationPlanCard'

afterEach(cleanup)

const GiB = 1024 ** 3

function guest(overrides: Partial<PlanGuest>): PlanGuest {
  return {
    type: 'guest',
    id: 'c1:qemu:pve1:101',
    name: 'web-01',
    node: 'pve1',
    cluster: 'Prod',
    status: 'running',
    vcpu: 8,
    ramBytes: 16 * GiB,
    ...overrides,
  }
}

function planNode(overrides: Partial<PlanNode>): PlanNode {
  return {
    type: 'node',
    key: 'c1:pve1',
    name: 'pve1',
    cluster: 'Prod',
    online: true,
    cpuPct: 40.4,
    ramPct: 81.7,
    vcpuRatio: 6,
    ...overrides,
  }
}

function item(overrides: Partial<PlanItem>): PlanItem {
  return {
    ref: 'L1',
    kind: 'rightsize',
    cluster: 'Prod',
    gain: { vcpu: 4, ramBytes: 8 * GiB },
    facts: { count: 2 },
    details: [],
    rulePriority: 'high',
    priority: 'high',
    explanation: 'Model explanation',
    action: 'Model action',
    ...overrides,
  }
}

function plan(overrides: Partial<OptimizationPlan>): OptimizationPlan {
  return {
    provider: 'ollama',
    model: 'llama3',
    generatedAt: '2026-10-31T08:00:00.000Z',
    summary: 'Model plan summary',
    items: [],
    ...overrides,
  }
}

type Props = React.ComponentProps<typeof OptimizationPlanCard>

function renderCard(overrides: Partial<Props> = {}) {
  const onRegenerate = vi.fn()
  const onOpenVm = vi.fn()

  renderWithProviders(<OptimizationPlanCard plan={null} loading={false} failed={false} onRegenerate={onRegenerate} onOpenVm={onOpenVm} {...overrides} />)

  return { onRegenerate, onOpenVm }
}

/** The clickable header of a plan row, found by its kind label. */
function rowOf(label: string): HTMLElement {
  const line = screen.getByText(label).parentElement?.parentElement
  if (!line) throw new Error(`no row for ${label}`)

  return line
}

describe('OptimizationPlanCard frame', () => {
  it('shows the plan title, idle subtitle and regenerate action before any plan', () => {
    const { onRegenerate } = renderCard()

    expect(screen.getByText('Optimisation plan')).toBeInTheDocument()
    expect(screen.getByText('What is allocated without being used, and where to start')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('shows the plan pending texts while the first plan loads', () => {
    renderCard({ loading: true })

    expect(screen.getByRole('status')).toHaveTextContent('Preparing the optimisation plan')
  })

  it('says there is nothing to optimise on an empty plan', () => {
    renderCard({ plan: plan({ items: [] }) })

    expect(screen.getByText('No optimisation lever: allocations follow usage.')).toBeInTheDocument()
  })
})

describe('OptimizationPlanCard summary', () => {
  it('uses the model summary of a model plan', () => {
    renderCard({ plan: plan({ summary: 'Reclaim the idle VMs first' }) })

    expect(screen.getByText('Reclaim the idle VMs first')).toBeInTheDocument()
  })

  it('translates a rule-based summary and adds the GB unit to its RAM', () => {
    renderCard({ plan: plan({ provider: 'basic', summary: '', summaryKey: 'summary', summaryParams: { count: 2, vcpu: 8, ram: 16 } }) })

    expect(screen.getByText('2 optimisation levers, up to 8 vCPU and 16 GB to reclaim.')).toBeInTheDocument()
  })

  it('translates a rule-based summary key without params', () => {
    renderCard({ plan: plan({ provider: 'basic', summary: '', summaryKey: 'summaryNone' }) })

    expect(screen.getByText('Nothing to optimise: allocations follow usage.')).toBeInTheDocument()
  })
})

describe('OptimizationPlanCard rows', () => {
  it('shows a rightsize lever with its finding, gain and priority, and expands to its guests', () => {
    const target = guest({ cpuPct: 5, ramPct: 20, targetVcpu: 2, targetRamBytes: 4 * GiB })
    const { onOpenVm } = renderCard({ plan: plan({ items: [item({ details: [target] })] }) })

    const row = rowOf('Rightsize VMs')
    expect(within(row).getByText('2 VMs use far less than their allocation')).toBeInTheDocument()
    expect(within(row).getByText('-4 vCPU · -8 GB')).toBeInTheDocument()
    expect(within(row).getByText('High')).toBeInTheDocument()
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()

    fireEvent.click(row)

    expect(within(row).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Model explanation')).toBeInTheDocument()
    expect(screen.getByText('Model action')).toBeInTheDocument()
    expect(screen.getByText('8 vCPU · 16 GB')).toBeInTheDocument()
    expect(screen.getByText('CPU 5% · RAM 20%')).toBeInTheDocument()
    expect(screen.getByText('2 vCPU · 4 GB')).toBeInTheDocument()

    fireEvent.click(screen.getByText('web-01'))

    expect(onOpenVm).toHaveBeenCalledWith({ id: 'c1:qemu:pve1:101', name: 'web-01', node: 'pve1', connId: 'c1', type: 'qemu', vmid: '101' })
  })

  it('shows a dormant guest without a target size, and a RAM-only gain', () => {
    const stopped = guest({ id: 'c1:lxc:pve2:202', name: 'old-ct', node: 'pve2', status: 'stopped', vcpu: 0, ramBytes: 4 * GiB })
    const { onOpenVm } = renderCard({
      plan: plan({
        items: [item({ ref: 'L2', kind: 'dormant', priority: 'medium', gain: { vcpu: 0, ramBytes: 4 * GiB }, facts: { count: 1 }, details: [stopped] })],
      }),
    })

    const row = rowOf('Stopped guests')
    expect(within(row).getByText('-4 GB')).toBeInTheDocument()
    expect(within(row).getByText('Medium')).toBeInTheDocument()

    fireEvent.click(row)
    expect(screen.queryByText(/^CPU .* · RAM .*%$/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('old-ct'))
    expect(onOpenVm).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1:lxc:pve2:202', type: 'lxc', node: 'pve2', vmid: '202' }))
  })

  it('shows a rebalance lever with its spread and its nodes, read through the rule keys', () => {
    const rebalance = item({
      ref: 'L3',
      kind: 'rebalance',
      priority: 'low',
      gain: { vcpu: 0, ramBytes: 0 },
      facts: { top: 'pve1', topPct: 82, bottom: 'pve3', bottomPct: 30, points: 52 },
      details: [planNode({}), planNode({ key: 'c1:pve3', name: 'pve3', online: false, ramPct: 30.2, cpuPct: 10, vcpuRatio: 2 })],
      explanation: '',
      action: '',
      explanationKey: 'explain.rebalance',
      actionKey: 'action.rebalance',
    })
    renderCard({ plan: plan({ provider: 'basic', summary: '', items: [rebalance] }) })

    const row = rowOf('Rebalance Prod')
    expect(within(row).getByText('pve1 at 82% RAM, pve3 at 30%')).toBeInTheDocument()
    expect(within(row).getByText('52 pts spread')).toBeInTheDocument()
    expect(within(row).getByText('Low')).toBeInTheDocument()

    fireEvent.click(row)

    expect(screen.getByText(/A loaded node reaches its thresholds well before the others/)).toBeInTheDocument()
    expect(screen.getByText('Live-migrate guests from pve1 to pve3.')).toBeInTheDocument()
    expect(screen.getByText('RAM 82%')).toBeInTheDocument()
    expect(screen.getByText('CPU 40%')).toBeInTheDocument()
    expect(screen.getByText('6:1')).toBeInTheDocument()
    expect(screen.getByText('RAM 30%')).toBeInTheDocument()
    expect(screen.getByText('2:1')).toBeInTheDocument()
  })

  it('shows a dash for a lever that frees nothing and is not a rebalance, and folds back', () => {
    const overcommit = item({
      ref: 'L4',
      kind: 'overcommit',
      gain: { vcpu: 0, ramBytes: 0 },
      facts: { count: 1, max: 4, worstRatio: 7, worst: 'pve1' },
      details: [],
    })
    renderCard({ plan: plan({ items: [overcommit] }) })

    const row = rowOf('CPU overcommit on Prod')
    expect(within(row).getByText('1 node(s) above 4 vCPU per core, up to 7:1 on pve1')).toBeInTheDocument()
    expect(within(row).getByText('-')).toBeInTheDocument()

    fireEvent.click(row)
    expect(screen.getByText('Model explanation')).toBeInTheDocument()

    fireEvent.click(row)
    expect(within(row).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
  })
})
