import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within, act } from '@testing-library/react'

import type { ActionCard } from '@/lib/ai/actions/types'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: unknown; href: string }) => <a href={href}>{children as never}</a>
}))

import AIActionCard from './AIActionCard'
import type { ActionRun } from './useActionExecution'

// Keys with their values, so a test reads which text and which target.
const t = (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join('|')})` : key)

const card = (over: Partial<ActionCard> = {}): ActionCard => ({
  actionId: 'a1',
  kind: 'start',
  tier: 'safe',
  target: { connId: 'c1', cluster: 'prod', node: 'pve1', vmid: 104, guestKind: 'qemu', name: 'win2025' },
  params: {},
  preflight: { ok: true, checks: [{ level: 'ok', text: 'Guest is stopped' }] },
  expiresAt: Date.now() + 600_000,
  token: 'tok',
  ...over
})

const renderCard = (props: { card?: ActionCard; run?: ActionRun; busy?: boolean; waitsFor?: number } = {}) => {
  const onExecute = vi.fn()

  render(<AIActionCard card={props.card ?? card()} run={props.run} busy={props.busy ?? false} waitsFor={props.waitsFor} onExecute={onExecute} t={t} />)

  return { onExecute }
}

const executeButton = () => screen.getByRole('button', { name: 'ai.actions.execute' })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AIActionCard', () => {
  it('names the action, its full target and its kind icon on one card', () => {
    renderCard({ card: card({ kind: 'migrate', params: { target: 'pve2', online: true } }) })

    const group = screen.getByRole('group', { name: 'ai.actions.title.migrate(pve2)' })

    expect(within(group).getByText('win2025')).toBeTruthy()
    expect(within(group).getByText('#104')).toBeTruthy()
    expect(within(group).getByText('pve1')).toBeTruthy()
    expect(within(group).getByText('prod')).toBeTruthy()
    expect(group.querySelector('.ri-arrow-left-right-line')).toBeTruthy()
  })

  it('runs a safe action in one click, without confirmation', () => {
    const c = card()
    const { onExecute } = renderCard({ card: c })

    fireEvent.click(executeButton())

    expect(onExecute).toHaveBeenCalledWith(c, false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks a second confirmation for a disruptive action, repeating the target and the effect', () => {
    const c = card({ kind: 'reboot', tier: 'disruptive' })
    const { onExecute } = renderCard({ card: c })

    fireEvent.click(executeButton())
    expect(onExecute).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText('ai.actions.confirmTitle(ai.actions.title.reboot)')).toBeTruthy()
    expect(within(dialog).getByText('win2025')).toBeTruthy()
    expect(within(dialog).getByText('pve1')).toBeTruthy()
    expect(within(dialog).getByText('ai.actions.effects.reboot')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'ai.actions.confirm' }))

    expect(onExecute).toHaveBeenCalledWith(c, true)
  })

  it('sends nothing when the confirmation is cancelled', async () => {
    const { onExecute } = renderCard({ card: card({ kind: 'shutdown', tier: 'disruptive' }) })

    fireEvent.click(executeButton())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.cancel' }))

    expect(onExecute).not.toHaveBeenCalled()
  })

  it('asks for confirmation from the tier the client derives, whatever the card says', () => {
    // The decoder derives the tier from the kind; a card handed in raw still
    // gets the modal for a disruptive kind.
    const { onExecute } = renderCard({ card: card({ kind: 'maintenance', tier: 'safe', params: { mode: 'enter' } }) })

    fireEvent.click(executeButton())

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('ai.actions.effects.maintenanceEnter')).toBeTruthy()
    expect(onExecute).not.toHaveBeenCalled()
  })

  it('cannot run a card with a blocking check, and shows why without opening the details', () => {
    renderCard({
      card: card({ preflight: { ok: false, checks: [{ level: 'ok', text: 'Exists' }, { level: 'block', text: 'Guest is already running' }] } })
    })

    expect((executeButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Guest is already running')).toBeTruthy()
  })

  it('folds the checks behind a chevron and renders their text as text', () => {
    renderCard({ card: card({ preflight: { ok: true, checks: [{ level: 'warn', text: '<b>No backup</b> in 7 days' }] } }) })

    const toggle = screen.getByRole('button', { name: /ai\.actions\.checks/ })

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('<b>No backup</b> in 7 days')).toBeTruthy()
    expect(document.querySelector('b')).toBeNull()
  })

  it('turns expired when its time is up and asks to propose it again', () => {
    vi.useFakeTimers()
    renderCard({ card: card({ expiresAt: Date.now() + 1000 }) })

    expect((executeButton() as HTMLButtonElement).disabled).toBe(false)
    act(() => { vi.advanceTimersByTime(1001) })

    expect((executeButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('ai.actions.expired')).toBeTruthy()
  })

  it('waits while another action of the widget runs', () => {
    renderCard({ busy: true })

    expect((executeButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the running, done and failed states', () => {
    renderCard({ run: { phase: 'tracking', progress: 40 } })
    expect(screen.getByText('ai.actions.running')).toBeTruthy()
    expect((screen.getByRole('button', { name: /ai\.actions\.running/ }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    renderCard({ run: { phase: 'done' } })
    expect(screen.getByText('ai.actions.done')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ai.actions.execute' })).toBeNull()
    cleanup()

    renderCard({ run: { phase: 'failed', code: 'route-refused', message: 'VM is locked (backup)', retryable: true } })
    expect(screen.getByText('VM is locked (backup)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ai.actions.retry' })).toBeTruthy()
  })

  it('has its own text for the cap, a turned-off kind and a changed situation', () => {
    const cases: Array<[string, string]> = [
      ['cap-reached', 'ai.actions.errors.capReached'],
      ['action-disabled', 'ai.actions.errors.actionDisabled'],
      ['expired', 'ai.actions.errors.situationChanged'],
      ['target-changed', 'ai.actions.errors.situationChanged'],
      ['preflight-failed', 'ai.actions.errors.situationChanged']
    ]

    for (const [code, key] of cases) {
      renderCard({ run: { phase: 'failed', code, message: 'raw server text', retryable: false } })
      expect(screen.getByText(key)).toBeTruthy()
      expect(screen.queryByText('raw server text')).toBeNull()
      expect(screen.queryByRole('button', { name: /ai\.actions\.(execute|retry)/ })).toBeNull()
      cleanup()
    }
  })

  it('points to the Task Center once the follow-up stopped', () => {
    renderCard({ run: { phase: 'untracked' } })

    expect(screen.getByText('ai.actions.untracked')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'ai.actions.taskCenter' }).getAttribute('href')).toBe('/operations/task-center')
  })

  it('says which step a locked plan step waits for', () => {
    renderCard({ waitsFor: 1 })

    expect((executeButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('ai.actions.waitsFor(1)')).toBeTruthy()
  })
})
