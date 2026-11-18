/**
 * NamedNetworksField: the networks of the settings, one per line (a name, a CIDR, a button to take it out), and "Add
 * a network"; what cannot be saved is marked as it is typed.
 */
import { useState } from 'react'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, within } from '@/__tests__/setup/renderWithProviders'

import NamedNetworksField from './NamedNetworksField'

afterEach(cleanup)

const VPN = { name: 'VPN', cidr: '192.168.72.0/24' }

describe('NamedNetworksField', () => {
  it('says there is none, and adds an empty row', () => {
    const onChange = vi.fn()
    renderWithProviders(<NamedNetworksField networks={[]} onChange={onChange} />)
    expect(screen.getByText('No network is named.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a network' }))
    expect(onChange).toHaveBeenCalledWith([{ name: '', cidr: '' }])
  })

  it('edits the name and the CIDR of a row, and takes a row out', () => {
    const onChange = vi.fn()
    renderWithProviders(<NamedNetworksField networks={[VPN, { name: 'Offices', cidr: '10.20.0.0/16' }]} onChange={onChange} />)
    const row = screen.getByRole('group', { name: 'VPN' })
    fireEvent.change(within(row).getByRole('textbox', { name: 'Name' }), { target: { value: 'VPN users' } })
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'VPN users', cidr: '192.168.72.0/24' }, { name: 'Offices', cidr: '10.20.0.0/16' }])
    fireEvent.change(within(row).getByRole('textbox', { name: 'Network (CIDR)' }), { target: { value: '192.168.80.0/24' } })
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'VPN', cidr: '192.168.80.0/24' }, { name: 'Offices', cidr: '10.20.0.0/16' }])
    fireEvent.click(within(row).getByRole('button', { name: 'Remove this network' }))
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Offices', cidr: '10.20.0.0/16' }])
  })

  it('keeps each row on its own fields when another row is added or taken out', () => {
    const OFFICES = { name: 'Offices', cidr: '10.20.0.0/16' }
    function Owner() {
      const [networks, setNetworks] = useState([VPN, OFFICES])
      return <NamedNetworksField networks={networks} onChange={setNetworks} />
    }
    renderWithProviders(<Owner />)
    const offices = within(screen.getByRole('group', { name: 'Offices' })).getByRole('textbox', { name: 'Name' })
    fireEvent.click(within(screen.getByRole('group', { name: 'VPN' })).getByRole('button', { name: 'Remove this network' }))
    expect(within(screen.getByRole('group', { name: 'Offices' })).getByRole('textbox', { name: 'Name' })).toBe(offices)
    fireEvent.click(screen.getByRole('button', { name: 'Add a network' }))
    expect(within(screen.getByRole('group', { name: 'Offices' })).getByRole('textbox', { name: 'Name' })).toBe(offices)
    expect(screen.getAllByRole('group')).toHaveLength(2)
  })

  it('marks a name or a CIDR that cannot be saved, and nothing can be edited while saving', () => {
    renderWithProviders(<NamedNetworksField networks={[{ name: '', cidr: '192.168.72.1' }, VPN]} disabled onChange={vi.fn()} />)
    const bad = screen.getByRole('group', { name: 'Network 1' })
    expect(within(bad).getByRole('textbox', { name: 'Name' }).getAttribute('aria-invalid')).toBe('true')
    expect(within(bad).getByRole('textbox', { name: 'Network (CIDR)' }).getAttribute('aria-invalid')).toBe('true')
    const good = screen.getByRole('group', { name: 'VPN' })
    expect(within(good).getByRole('textbox', { name: 'Name' }).getAttribute('aria-invalid')).toBe('false')
    expect((within(good).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add a network' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
