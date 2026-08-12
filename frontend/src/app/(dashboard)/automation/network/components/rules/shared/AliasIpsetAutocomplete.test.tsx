/**
 * Tests for the source/destination field shared by the rule dialogs
 * (cluster, host, VM/CT and security group) and for the hook that builds its
 * suggestions.
 *
 * What the dialogs depend on: the field is free text — PVE takes a bare IP or
 * CIDR — while still offering the connection's aliases and IPSets, each with
 * its CIDR or entry count on the right; and every keystroke reaches the
 * caller, because the panels hold the value in their own rule state.
 *
 * MUI's Autocomplete is driven the jsdom way: fire a change on the input,
 * then await the option, which only exists once the popup is open. No
 * automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { useState } from 'react'

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPI from '@/lib/api/firewall'

import AliasIpsetAutocomplete, { useAliasIpsetOptions } from './AliasIpsetAutocomplete'

const OPTIONS = [
  { label: 'web-servers', secondary: '10.0.0.0/24' },
  { label: '+blocklist', secondary: '12 entries' },
]

const input = () => screen.getByLabelText('Source') as HTMLInputElement

/** The field as the dialogs use it: value held by the caller. */
function ControlledField({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('')

  return (
    <AliasIpsetAutocomplete
      options={OPTIONS}
      value={value}
      onChange={v => { setValue(v); onChange?.(v) }}
      label="Source"
      placeholder="IP, CIDR, alias..."
    />
  )
}

describe('AliasIpsetAutocomplete', () => {
  afterEach(cleanup)

  it('renders the label, the placeholder and the incoming value', () => {
    renderWithProviders(
      <AliasIpsetAutocomplete options={OPTIONS} value="10.0.0.1" onChange={vi.fn()} label="Source" placeholder="IP, CIDR, alias..." />
    )

    expect(input()).toHaveValue('10.0.0.1')
    expect(input()).toHaveAttribute('placeholder', 'IP, CIDR, alias...')
  })

  it('offers the aliases and IPSets with their CIDR or entry count', async () => {
    renderWithProviders(
      <AliasIpsetAutocomplete options={OPTIONS} value="" onChange={vi.fn()} label="Source" placeholder="IP, CIDR, alias..." />
    )

    fireEvent.change(input(), { target: { value: 'e' } })

    expect(await screen.findByRole('option', { name: /web-servers/ })).toHaveTextContent('10.0.0.0/24')
    expect(screen.getByRole('option', { name: /\+blocklist/ })).toHaveTextContent('12 entries')
  })

  it('hands every keystroke to the caller, free-text included', () => {
    const onChange = vi.fn()

    renderWithProviders(
      <AliasIpsetAutocomplete options={OPTIONS} value="" onChange={onChange} label="Source" placeholder="IP, CIDR, alias..." />
    )

    fireEvent.change(input(), { target: { value: '192.168.1.0/24' } })

    expect(onChange).toHaveBeenCalledWith('192.168.1.0/24')
  })

  it('filters the suggestions on what has been typed and yields the picked alias', async () => {
    const onChange = vi.fn()

    renderWithProviders(<ControlledField onChange={onChange} />)

    fireEvent.change(input(), { target: { value: 'web' } })

    const option = await screen.findByRole('option', { name: /web-servers/ })

    expect(screen.getAllByRole('option')).toHaveLength(1)

    fireEvent.click(option)

    expect(onChange).toHaveBeenLastCalledWith('web-servers')
    expect(input()).toHaveValue('web-servers')
  })

  it('applies the compact input style the VM/CT dialog asks for', () => {
    renderWithProviders(
      <AliasIpsetAutocomplete options={OPTIONS} value="" onChange={vi.fn()} label="Source" placeholder="net0" inputSx={{ fontSize: 13 }} />
    )

    // The override lands on the Input wrapper, not on the <input> itself.
    expect(input().closest('.MuiInputBase-root')).toHaveStyle({ fontSize: '13px' })
  })
})

describe('useAliasIpsetOptions', () => {
  const aliases: firewallAPI.Alias[] = [{ name: 'web-servers', cidr: '10.0.0.0/24' }]

  it('lists the aliases first, then the IPSets under their +name form', () => {
    const ipsets: firewallAPI.IPSet[] = [{ name: 'blocklist', comment: 'known bad actors' }]

    const { result } = renderHook(() => useAliasIpsetOptions(aliases, ipsets))

    expect(result.current).toEqual([
      { label: 'web-servers', secondary: '10.0.0.0/24' },
      { label: '+blocklist', secondary: 'known bad actors' },
    ])
  })

  it('falls back to the entry count when an IPSet has no comment', () => {
    const ipsets: firewallAPI.IPSet[] = [
      { name: 'blocklist', members: [{ cidr: '1.2.3.4' }, { cidr: '5.6.7.8' }] },
      { name: 'empty' },
    ]

    const { result } = renderHook(() => useAliasIpsetOptions([], ipsets))

    expect(result.current).toEqual([
      { label: '+blocklist', secondary: '2 entries' },
      { label: '+empty', secondary: '0 entries' },
    ])
  })

  it('keeps the same array across renders so both fields of a dialog share it', () => {
    const ipsets: firewallAPI.IPSet[] = []

    const { result, rerender } = renderHook(() => useAliasIpsetOptions(aliases, ipsets))
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })
})
