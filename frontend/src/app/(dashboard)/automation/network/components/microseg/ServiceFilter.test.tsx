/**
 * ServiceFilter: the button of the map toolbar that lists the services the map carries, each with its checkbox under
 * "All services" (ticked, unticked or in between), and says how many are drawn once some are hidden.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, within } from '@/__tests__/setup/renderWithProviders'

import ServiceFilter from './ServiceFilter'

afterEach(cleanup)

const SERVICES = [{ token: 'tcp/443', label: 'HTTPS' }, { token: 'icmp', label: 'icmp' }, { token: 'tcp/22', label: 'SSH' }]
const box = (menu: HTMLElement, name: string) => within(menu).getByRole('checkbox', { name }) as HTMLInputElement

describe('ServiceFilter', () => {
  it('lists the services ticked, and hides the one that is unticked', () => {
    const onHidden = vi.fn()
    renderWithProviders(<ServiceFilter services={SERVICES} hidden={new Set()} onHidden={onHidden} />)
    fireEvent.click(screen.getByRole('button', { name: 'Services' }))
    const menu = screen.getByRole('menu', { name: 'Services' })
    for (const name of ['All services', 'HTTPS', 'icmp', 'SSH']) expect(box(menu, name).checked).toBe(true)
    fireEvent.click(within(menu).getByText('icmp'))
    expect([...onHidden.mock.calls[0][0]]).toEqual(['icmp'])
  })

  it('says how many services are drawn, shows "All services" in between, and ticks all back', () => {
    const onHidden = vi.fn()
    renderWithProviders(<ServiceFilter services={SERVICES} hidden={new Set(['icmp'])} onHidden={onHidden} />)
    fireEvent.click(screen.getByRole('button', { name: 'Services: 2 of 3' }))
    const menu = screen.getByRole('menu', { name: 'Services' })
    expect(box(menu, 'icmp').checked).toBe(false)
    expect(box(menu, 'All services').checked).toBe(false)
    expect(box(menu, 'All services').getAttribute('data-indeterminate')).toBe('true')
    fireEvent.click(within(menu).getByText('All services'))
    expect([...onHidden.mock.calls[0][0]]).toEqual([])
  })

  it('unticks every service from "All services" when all are drawn, and is disabled on a map with no service', () => {
    const onHidden = vi.fn()
    const { unmount } = renderWithProviders(<ServiceFilter services={SERVICES} hidden={new Set()} onHidden={onHidden} />)
    fireEvent.click(screen.getByRole('button', { name: 'Services' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Services' })).getByText('All services'))
    expect([...onHidden.mock.calls[0][0]].sort((a, b) => a.localeCompare(b))).toEqual(['icmp', 'tcp/22', 'tcp/443'])
    unmount()
    renderWithProviders(<ServiceFilter services={[]} hidden={new Set()} onHidden={onHidden} />)
    expect((screen.getByRole('button', { name: 'Services' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
