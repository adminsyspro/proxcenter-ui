import React, { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import BridgePicker from './BridgePicker'
import type { BridgePickerOption } from './bridgeChoices'

const OPTIONS: BridgePickerOption[] = [
  { iface: 'vmbr0', label: 'vmbr0', detail: 'OVS' },
  { iface: 'vmbr10', label: 'vmbr10' },
  { iface: 'h8a3f', label: 'VLAN2042', hint: 'h8a3f', detail: 'VNet · zone-dmz', icon: 'ri-shield-keyhole-line', accentIcon: true },
  { iface: 'VLAN2553', label: 'VLAN2553', icon: 'ri-node-tree' },
]

function Harness({ initial, freeSolo, onChange }: { initial: string; freeSolo?: boolean; onChange: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <BridgePicker
        options={OPTIONS}
        value={value}
        onChange={v => { setValue(v); onChange(v) }}
        label="Bridge"
        freeSolo={freeSolo}
        helperText="pick one"
      />
      <span data-testid="current">{value}</span>
    </>
  )
}

afterEach(cleanup)

describe('BridgePicker', () => {
  it('shows the selected label and keeps the option rendering', () => {
    renderWithProviders(<Harness initial="h8a3f" onChange={vi.fn()} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('VLAN2042')
    expect(screen.getByText('pick one')).toBeTruthy()

    fireEvent.mouseDown(input)
    const listbox = screen.getByRole('listbox')
    const rows = within(listbox).getAllByRole('option')
    expect(rows.map(r => r.textContent)).toEqual(['vmbr0OVS', 'vmbr10', 'VLAN2042h8a3fVNet · zone-dmz', 'VLAN2553'])
    expect(rows[2].querySelector('i.ri-shield-keyhole-line')).toBeTruthy()
  })

  it('filters on the alias, the PVE id and the caption, then writes the iface', () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness initial="vmbr0" onChange={onChange} />)
    const input = screen.getByRole('combobox')
    input.focus()

    fireEvent.change(input, { target: { value: 'dmz' } })
    expect(screen.getAllByRole('option').map(r => r.textContent)).toEqual(['VLAN2042h8a3fVNet · zone-dmz'])

    fireEvent.change(input, { target: { value: 'H8A3' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.click(screen.getByRole('option'))
    expect(onChange).toHaveBeenLastCalledWith('h8a3f')
    expect(screen.getByTestId('current').textContent).toBe('h8a3f')
  })

  it('says so when nothing matches', () => {
    renderWithProviders(<Harness initial="vmbr0" onChange={vi.fn()} />)
    const input = screen.getByRole('combobox')
    input.focus()
    fireEvent.change(input, { target: { value: 'nothing-like-this' } })
    expect(screen.getByText('No results')).toBeTruthy()
  })

  it('leaves the input empty when the value is not an option', () => {
    renderWithProviders(<Harness initial="vmbr99" onChange={vi.fn()} />)
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('')
  })

  it('free text mode keeps a typed name and writes the iface of a picked option', () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness initial="vmbr0" freeSolo onChange={onChange} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('vmbr0')

    fireEvent.change(input, { target: { value: 'vmbr42' } })
    expect(onChange).toHaveBeenLastCalledWith('vmbr42')
    expect(screen.getByTestId('current').textContent).toBe('vmbr42')

    fireEvent.change(input, { target: { value: 'VLAN2042' } })
    fireEvent.click(screen.getByRole('option', { name: /VLAN2042/ }))
    expect(onChange).toHaveBeenLastCalledWith('h8a3f')
    expect(input.value).toBe('h8a3f')
  })
})
