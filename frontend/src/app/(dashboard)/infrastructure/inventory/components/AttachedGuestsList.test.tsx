import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import AttachedGuestsList, { onActivateKey } from './AttachedGuestsList'
import type { AttachedGuest } from '../networkSummary'

const guest = (i: number, over: Partial<AttachedGuest> = {}): AttachedGuest => ({
  key: `c1:pve1:qemu:${i}`, connId: 'c1', vmid: String(i), name: `vm-${String(i).padStart(2, '0')}`,
  node: 'pve1', type: 'qemu', status: 'running', ifaces: ['net0'], bridges: ['vmbr0'], ...over,
})

afterEach(cleanup)

describe('AttachedGuestsList (#1290)', () => {
  it('pages a long list by 20 and keeps every guest reachable', () => {
    renderWithProviders(<AttachedGuestsList guests={Array.from({ length: 25 }, (_, i) => guest(i))} nodeStatus={() => 'online'} />)

    expect(screen.getAllByTestId('attached-guest-row')).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getAllByTestId('attached-guest-row')).toHaveLength(5)
  })

  it('falls back to the vmid, a dash and a bridge alias where the guest has no name, interface or raw bridge', () => {
    renderWithProviders(
      <AttachedGuestsList
        guests={[guest(9911, { name: '', type: 'lxc', ifaces: [], bridges: ['v32cf5fc'] }), guest(2, { bridges: [] })]}
        nodeStatus={() => undefined}
        showBridge
        aliases={{ v32cf5fc: 'backbone' }}
      />,
    )

    const [ct, vm] = screen.getAllByTestId('attached-guest-row')
    expect(ct.textContent).toBe('9911#9911pve1—backbone')
    expect(ct.querySelector('.ri-instance-line')).toBeTruthy()
    expect(vm.textContent).toBe('vm-02#2pve1net0—')
  })

  it('acts on Enter and Space only', () => {
    const action = vi.fn()
    const preventDefault = vi.fn()
    const handler = onActivateKey(action)

    handler({ key: 'Tab', preventDefault } as any)
    expect(action).not.toHaveBeenCalled()
    handler({ key: 'Enter', preventDefault } as any)
    handler({ key: ' ', preventDefault } as any)
    expect(action).toHaveBeenCalledTimes(2)
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })
})
