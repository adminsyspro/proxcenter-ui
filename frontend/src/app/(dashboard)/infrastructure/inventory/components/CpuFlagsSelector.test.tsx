import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import CpuFlagsSelector, { cpuWithFlags } from './CpuFlagsSelector'

afterEach(cleanup)

describe('cpuWithFlags', () => {
  it('returns the bare model when no flag is set', () => {
    expect(cpuWithFlags('host', {})).toBe('host')
  })

  it('appends the flags in PVE syntax', () => {
    expect(cpuWithFlags('x86-64-v2-AES', { aes: '+', pcid: '-' })).toBe('x86-64-v2-AES,flags=+aes;-pcid')
  })
})

describe('CpuFlagsSelector', () => {
  const flagButton = (flag: string, name: string) =>
    within(screen.getByRole('group', { name: flag })).getByRole('button', { name })

  it('counts the active flags in its header', () => {
    renderWithProviders(<CpuFlagsSelector flags={{ aes: '+', pcid: '-' }} onChange={vi.fn()} />)

    expect(screen.getByText('Extra CPU Flags')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('sets a flag on + or − and clears it on off', () => {
    const onChange = vi.fn()
    renderWithProviders(<CpuFlagsSelector flags={{ pcid: '-' }} onChange={onChange} />)
    fireEvent.click(screen.getByText('Extra CPU Flags'))

    fireEvent.click(flagButton('aes', '+'))
    expect(onChange).toHaveBeenLastCalledWith({ pcid: '-', aes: '+' })

    fireEvent.click(flagButton('pcid', 'off'))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('ignores a click on the button already selected', () => {
    const onChange = vi.fn()
    renderWithProviders(<CpuFlagsSelector flags={{ pcid: '-' }} onChange={onChange} />)
    fireEvent.click(screen.getByText('Extra CPU Flags'))

    fireEvent.click(flagButton('pcid', '−'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('locks every selector when disabled', () => {
    renderWithProviders(<CpuFlagsSelector flags={{}} onChange={vi.fn()} disabled />)
    fireEvent.click(screen.getByText('Extra CPU Flags'))

    expect(flagButton('aes', '+')).toBeDisabled()
  })
})
