/**
 * Component tests for EditOtherHardwareDialog.tsx — clearable RNG fields.
 *
 * A VirtIO RNG item is passed straight in, so the RNG branch renders with no
 * network at all (only the pci/usb branches fetch host devices).
 *
 * Both fields keep fallback 0 on purpose: 0 is a meaningful value here — the
 * payload builder omits max_bytes / period when they are 0, which is exactly
 * what the old `Number('') === 0` coercion committed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  userEvent,
} from '@/__tests__/setup/renderWithProviders'

import { EditOtherHardwareDialog, type OtherHardwareItem } from './EditOtherHardwareDialog'

const rngHardware: OtherHardwareItem = {
  id: 'rng0',
  type: 'rng',
  rawValue: 'source=/dev/urandom,max_bytes=1024,period=1000',
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    connId: 'conn-1',
    node: 'pve1',
    hardware: rngHardware,
    ...overrides,
  }
}

const maxBytesField = () => screen.getByLabelText('Max Bytes per Period') as HTMLInputElement
const periodField = () => screen.getByLabelText('Period (ms)') as HTMLInputElement

describe('EditOtherHardwareDialog — clearable RNG fields', () => {
  // This suite renders repeatedly; RTL is not auto-cleaned up in this repo.
  afterEach(cleanup)

  it('seeds both fields from the raw config value', () => {
    renderWithProviders(<EditOtherHardwareDialog {...makeProps()} />)
    expect(maxBytesField().value).toBe('1024')
    expect(periodField().value).toBe('1000')
  })

  it('replaces max bytes instead of gluing the old digits in front', async () => {
    renderWithProviders(<EditOtherHardwareDialog {...makeProps()} />)

    await userEvent.clear(maxBytesField())
    expect(maxBytesField().value).toBe('')

    await userEvent.type(maxBytesField(), '2048')
    expect(maxBytesField().value).toBe('2048')
  })

  it('replaces the period instead of gluing the old digits in front', async () => {
    renderWithProviders(<EditOtherHardwareDialog {...makeProps()} />)

    await userEvent.clear(periodField())
    await userEvent.type(periodField(), '500')
    expect(periodField().value).toBe('500')
  })

  it('saves the retyped values', async () => {
    const props = makeProps()

    renderWithProviders(<EditOtherHardwareDialog {...props} />)

    await userEvent.clear(maxBytesField())
    await userEvent.type(maxBytesField(), '2048')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(props.onSave).toHaveBeenCalledWith({
      rng0: 'source=/dev/urandom,max_bytes=2048,period=1000',
    })
  })

  it('falls back to 0 on blur, which drops the limit from the payload', async () => {
    const props = makeProps()

    renderWithProviders(<EditOtherHardwareDialog {...props} />)

    await userEvent.clear(maxBytesField())
    await userEvent.tab()
    expect(maxBytesField().value).toBe('0')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSave).toHaveBeenCalledWith({
      rng0: 'source=/dev/urandom,period=1000',
    })
  })
})
