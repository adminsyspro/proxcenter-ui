import { useState } from 'react'

import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import CheckboxGroup from './CheckboxGroup'

const items = [{ key: 'a', label: 'alpha' }, { key: 'b', label: 'beta' }, { key: 'g', label: 'gamma' }]

function Harness({ searchable = false }: { searchable?: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  return <CheckboxGroup title='Tags' items={items} selected={selected} onChange={setSelected} emptyText='none' searchable={searchable} />
}

afterEach(cleanup)

describe('CheckboxGroup', () => {
  it('moves All through empty, half checked and checked', async () => {
    const user = userEvent.setup()

    renderWithProviders(<Harness />)

    const all = screen.getByRole('checkbox', { name: 'All' })

    expect(all).not.toBeChecked()
    expect(all).toHaveAttribute('data-indeterminate', 'false')

    await user.click(screen.getByRole('checkbox', { name: 'alpha' }))
    expect(all).toHaveAttribute('data-indeterminate', 'true')

    await user.click(all)
    expect(all).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'gamma' })).toBeChecked()

    await user.click(all)
    expect(all).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'alpha' })).not.toBeChecked()
  })

  it('applies All to the rows the search leaves', async () => {
    const user = userEvent.setup()

    renderWithProviders(<Harness searchable />)

    await user.type(screen.getByRole('textbox'), 'a')
    await user.click(screen.getByRole('checkbox', { name: 'All' }))

    await user.clear(screen.getByRole('textbox'))
    expect(screen.getByRole('checkbox', { name: 'alpha' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'beta' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'gamma' })).toBeChecked()
  })

  it('shows the empty text without items', () => {
    renderWithProviders(<CheckboxGroup title='Tags' items={[]} selected={new Set()} onChange={() => {}} emptyText='none' />)

    expect(screen.getByText('none')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('CheckboxGroup by group', () => {
  const grouped = [
    { key: 'p1', label: 'web', group: 'PVE-PROD' },
    { key: 'p2', label: 'db', group: 'PVE-PROD' },
    { key: 'd1', label: 'web-dr', group: 'PVE-DR' },
  ]

  function Grouped() {
    const [selected, setSelected] = useState<Set<string>>(new Set())

    return <CheckboxGroup title='Guests' items={grouped} selected={selected} onChange={setSelected} emptyText='none' searchable />
  }

  it('heads each connection, ticks a whole one and counts it', async () => {
    const user = userEvent.setup()

    renderWithProviders(<Grouped />)

    const prod = screen.getByRole('checkbox', { name: 'All of PVE-PROD' })

    expect(screen.getByText('0 / 2')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'web' }))
    expect(prod).toHaveAttribute('data-indeterminate', 'true')

    await user.click(prod)
    expect(prod).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'db' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'web-dr' })).not.toBeChecked()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    await user.click(prod)
    expect(screen.getByRole('checkbox', { name: 'web' })).not.toBeChecked()
  })

  it('finds the guests of a connection by its name', async () => {
    const user = userEvent.setup()

    renderWithProviders(<Grouped />)
    await user.type(screen.getByRole('textbox'), 'pve-dr')

    expect(screen.getByRole('checkbox', { name: 'web-dr' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'db' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'All of PVE-PROD' })).toBeNull()
  })
})
