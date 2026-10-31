import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import { makeResult } from './fixtures'
import PolicyGuests, { GUESTS_PAGE, type PolicyGuest } from './PolicyGuests'

afterEach(cleanup)

const guest = (vmid: number, name: string, availability: number | null, connection = 'c1'): PolicyGuest => ({
  ...makeResult('', ['up', 'down'], { ref: { connection_id: connection, kind: 'guest', vmid }, availability, down_seconds: 600 }),
  name,
  type: 'qemu',
})

const names = { c1: 'PVE-PROD', c2: 'PVE-DR' }

const lines = () => screen.getAllByRole('listitem').map(l => l.querySelector('p')?.textContent)

describe('PolicyGuests', () => {
  it('lists the guests below target first, named with their vmid and connection', () => {
    renderWithProviders(
      <PolicyGuests guests={[guest(1, 'ok', 99.99), guest(2, 'bad', 98), guest(3, 'worse', 90, 'c2'), guest(4, 'new', null)]} connectionNames={names} target={99.9} to='2026-10-27T10:02:00.000Z' />,
    )

    expect(lines()).toEqual(['worse', 'bad', 'ok', 'new'])
    expect(screen.getByText('3 · PVE-DR')).toBeInTheDocument()
    // A short list needs neither search nor filter.
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('pages a long list, searches it and keeps the guests below target on demand', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 25 }, (_, i) => guest(100 + i, `vm-${100 + i}`, i < 3 ? 95 : 100))

    renderWithProviders(<PolicyGuests guests={many} connectionNames={names} target={99.9} to='2026-10-27T10:02:00.000Z' />)

    expect(lines()).toHaveLength(GUESTS_PAGE)
    await user.click(screen.getByRole('button', { name: 'Show 10 more (15 left)' }))
    expect(lines()).toHaveLength(20)

    await user.click(screen.getByRole('button', { name: 'Below target (3)' }))
    expect(lines()).toEqual(['vm-100', 'vm-101', 'vm-102'])

    await user.click(screen.getByRole('button', { name: 'Below target (3)' }))
    await user.type(screen.getByRole('textbox', { name: 'Search a guest' }), 'vm-124')
    expect(lines()).toEqual(['vm-124'])

    await user.clear(screen.getByRole('textbox', { name: 'Search a guest' }))
    await user.type(screen.getByRole('textbox', { name: 'Search a guest' }), 'nothing')
    expect(screen.getByText('No guest matches.')).toBeInTheDocument()
  })

  it('opens the full timeline of a guest from its line', async () => {
    const user = userEvent.setup()

    renderWithProviders(<PolicyGuests guests={[guest(1, 'web', 99)]} connectionNames={names} target={99.9} to='2026-10-27T10:02:00.000Z' />)

    const line = screen.getByRole('button', { name: 'Timeline of web' })

    expect(line).toHaveAttribute('aria-expanded', 'false')
    await user.click(line)
    expect(line).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('img', { name: /^web: 99% available/ })).toBeInTheDocument()
  })
})
