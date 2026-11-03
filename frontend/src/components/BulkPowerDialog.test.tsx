/**
 * roadmap#197: the power dialog of a selection confirms the action, sets the
 * per-host parallelism, then follows every guest until its task ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import BulkPowerDialog, { shownStatus, type BulkPowerTarget } from '@/components/BulkPowerDialog'

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const runner = vi.hoisted(() => ({ calls: [] as any[], resolve: null as null | ((o: any) => void) }))
const prefs = vi.hoisted(() => ({ perNode: 3, written: [] as number[] }))
vi.mock('@/lib/inventory/bulkGuestPower', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/inventory/bulkGuestPower')>()
  return {
    ...actual,
    readPerNodePreference: () => prefs.perNode,
    writePerNodePreference: (v: number) => { prefs.written.push(v) },
    runBulkGuestPower: (guests: any, action: any, opts: any) => {
      runner.calls.push({ guests, action, opts })
      return new Promise(r => { runner.resolve = r })
    },
  }
})

const guest = (vmid: number, node = 'pve1'): BulkPowerTarget => ({ connId: 'c1', node, type: vmid > 200 ? 'lxc' : 'qemu', vmid, name: `g${vmid}`, status: 'stopped' })
const GUESTS = Array.from({ length: 10 }, (_, i) => guest(101 + i, i % 2 ? 'pve2' : 'pve1'))

beforeEach(() => {
  runner.calls = []
  runner.resolve = null
  prefs.written = []
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
  Object.values(toast).forEach(f => f.mockClear())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('shownStatus', () => {
  it('shows the state a finished task left, else the one picked', () => {
    expect(shownStatus('start', { status: 'completed' }, 'stopped')).toBe('running')
    expect(shownStatus('reboot', { status: 'completed' }, 'running')).toBe('running')
    expect(shownStatus('shutdown', { status: 'completed' }, 'running')).toBe('stopped')
    expect(shownStatus('stop', { status: 'failed' }, 'running')).toBe('running')
  })
})

describe('BulkPowerDialog', () => {
  it('confirms with the scope, the guests left out and the stored parallelism', () => {
    const onClose = vi.fn()
    renderWithProviders(<BulkPowerDialog action="stop" guests={GUESTS} skipped={2} onClose={onClose} />)
    const text = screen.getByTestId('bulk-power-dialog').textContent

    expect(text).toContain('Force stop 10 guest(s)')
    expect(text).toContain('10 guest(s) on 2 host(s).')
    expect(text).toContain('2 selected guest(s) left out: not running.')
    expect(text).toContain('pulling the plug')
    expect(text).toContain('Tasks in parallel per host: 3')

    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
    expect(runner.calls).toHaveLength(0)
  })

  it('runs the batch with the chosen parallelism and follows each guest', async () => {
    renderWithProviders(<BulkPowerDialog action="start" guests={GUESTS} skipped={1} onClose={vi.fn()} />)
    expect(screen.getByTestId('bulk-power-dialog').textContent).toContain('left out: not stopped.')

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })
    fireEvent.click(screen.getByTestId('bulk-power-confirm'))
    expect(prefs.written).toEqual([4])
    expect(runner.calls[0]).toMatchObject({ action: 'start', opts: { perNode: 4 } })

    const { onUpdate, shouldContinue } = runner.calls[0].opts
    act(() => {
      onUpdate(0, { status: 'completed' })
      onUpdate(1, { status: 'failed', error: 'no quorum' })
      onUpdate(2, { status: 'completed', warning: 'WARNINGS: 1' })
      onUpdate(3, { status: 'running' })
    })
    expect(screen.getByTestId('bulk-power-counts').textContent).toBe('Done: 2Failed: 1Running: 1Queued: 6')

    // Failed rows come first; their detail opens under a chevron.
    const rows = screen.getAllByTestId('bulk-power-row')
    expect(rows).toHaveLength(8)
    expect(rows[0].textContent).toContain('g102')
    fireEvent.click(screen.getAllByLabelText('Show the details')[0])
    expect(rows[0].textContent).toContain('no quorum')

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }))
    expect(screen.getAllByTestId('bulk-power-row')).toHaveLength(2)

    expect(shouldContinue()).toBe(true)
    fireEvent.click(screen.getByTestId('bulk-power-stop'))
    expect(shouldContinue()).toBe(false)
    expect((screen.getByTestId('bulk-power-stop') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { runner.resolve!({ success: 2, errors: 1, results: [] }) })
    expect(screen.queryByTestId('bulk-power-stop')).toBeNull()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('still tells the verdict when closed while the batch runs', async () => {
    const view = renderWithProviders(<BulkPowerDialog action="shutdown" guests={GUESTS.slice(0, 2)} skipped={0} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('bulk-power-confirm'))
    view.unmount()

    await act(async () => { runner.resolve!({ success: 1, errors: 1, firstError: 'locked', results: [] }) })
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('locked'))
  })

  it('warns before leaving the page while the batch runs', () => {
    const add = vi.spyOn(globalThis, 'addEventListener')
    renderWithProviders(<BulkPowerDialog action="reboot" guests={GUESTS.slice(0, 1)} skipped={0} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('bulk-power-confirm'))

    const call = add.mock.calls.find(c => c[0] === 'beforeunload')
    expect(call).toBeDefined()
    const ev = { preventDefault: vi.fn() }
    ;(call![1] as any)(ev)
    expect(ev.preventDefault).toHaveBeenCalled()
    add.mockRestore()
  })
})
