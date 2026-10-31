import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'

import type { ActionCard, ActionPlan } from '@/lib/ai/actions/types'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: unknown; href: string }) => <a href={href}>{children as never}</a>
}))

import AIActionPlan, { AIActions } from './AIActionPlan'
import type { ActionRuns } from './useActionExecution'

const t = (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join('|')})` : key)

const host = { connId: 'c1', cluster: 'prod', node: 'pve1', name: 'pve1' }

const stepCard = (actionId: string, step: number, mode: 'enter' | 'exit', after?: number): ActionCard => ({
  actionId,
  kind: 'maintenance',
  tier: 'disruptive',
  target: host,
  params: { mode },
  preflight: { ok: true, checks: [] },
  planId: 'p1',
  step,
  ...(after !== undefined ? { after } : {}),
  expiresAt: Date.now() + 600_000,
  token: 'tok'
})

const plan = (href: string): ActionPlan => ({
  planId: 'p1',
  finding: 'pending_updates',
  title: 'Install the pending updates of pve1',
  steps: [
    { step: 1, card: stepCard('s1', 1, 'enter') },
    { step: 2, manual: { text: 'Install the updates from the Rolling Update tab.', href } },
    { step: 3, card: stepCard('s3', 3, 'exit', 1) }
  ]
})

const renderPlan = (runs: ActionRuns, href = '/infrastructure/inventory?selectType=cluster&selectId=c1') => {
  const onExecute = vi.fn()
  const view = render(<AIActionPlan plan={plan(href)} runs={runs} busy={false} onExecute={onExecute} t={t} />)

  return { ...view, onExecute }
}

const stepGroup = (title: string) => screen.getByRole('group', { name: title })

afterEach(cleanup)

describe('AIActionPlan', () => {
  it('lists the steps under the plan title, only the current one runnable', () => {
    renderPlan({})

    expect(screen.getByText('Install the pending updates of pve1')).toBeTruthy()

    const enter = stepGroup('ai.actions.title.maintenanceEnter')
    const exit = stepGroup('ai.actions.title.maintenanceExit')

    expect((within(enter).getByRole('button', { name: 'ai.actions.execute' }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(exit).getByRole('button', { name: 'ai.actions.execute' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(exit).getByText('ai.actions.waitsFor(1)')).toBeTruthy()
  })

  it('unlocks the next card step once the previous one succeeded here, and shows each result under its step', () => {
    const { rerender, onExecute } = renderPlan({ s1: { phase: 'tracking' } })

    expect((within(stepGroup('ai.actions.title.maintenanceExit')).getByRole('button', { name: 'ai.actions.execute' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<AIActionPlan plan={plan('/x')} runs={{ s1: { phase: 'failed', code: 'route-refused', message: 'SSH failed', retryable: true } }} busy={false} onExecute={onExecute} t={t} />)
    expect(within(stepGroup('ai.actions.title.maintenanceEnter')).getByText('SSH failed')).toBeTruthy()
    expect((within(stepGroup('ai.actions.title.maintenanceExit')).getByRole('button', { name: 'ai.actions.execute' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<AIActionPlan plan={plan('/x')} runs={{ s1: { phase: 'done' } }} busy={false} onExecute={onExecute} t={t} />)

    const exit = stepGroup('ai.actions.title.maintenanceExit')

    expect(within(stepGroup('ai.actions.title.maintenanceEnter')).getByText('ai.actions.done')).toBeTruthy()
    expect(within(exit).queryByText('ai.actions.waitsFor(1)')).toBeNull()
    expect(screen.getByText('ai.actions.planProgress(1|2)')).toBeTruthy()

    fireEvent.click(within(exit).getByRole('button', { name: 'ai.actions.execute' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ai.actions.confirm' }))
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ actionId: 's3' }), true)
  })

  it('renders a manual step as a link inside the app', () => {
    renderPlan({}, '/infrastructure/inventory?selectType=cluster&selectId=c1')

    expect(screen.getByText('Install the updates from the Rolling Update tab.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'ai.actions.openPage' }).getAttribute('href')).toBe('/infrastructure/inventory?selectType=cluster&selectId=c1')
  })

  it('renders no link when the manual link was dropped as unsafe, nor for anything outside the app', () => {
    renderPlan({}, '')
    expect(screen.getByText('Install the updates from the Rolling Update tab.')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    cleanup()

    renderPlan({}, 'javascript:alert(1)')
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('AIActions', () => {
  it('renders the loose cards then the plans of an answer', () => {
    const loose: ActionCard = { ...stepCard('l1', 1, 'enter'), planId: undefined, step: undefined, kind: 'snapshot', tier: 'safe', params: { name: 'ai-1' }, target: { ...host, vmid: 101, guestKind: 'lxc', name: 'ct1' } }

    render(<AIActions payload={{ cards: [loose], plans: [plan('')] }} runs={{}} busy={false} onExecute={vi.fn()} t={t} />)

    expect(stepGroup('ai.actions.title.snapshot(ai-1)')).toBeTruthy()
    expect(screen.getByText('Install the pending updates of pve1')).toBeTruthy()
  })
})
