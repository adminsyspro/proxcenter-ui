/**
 * Component tests for AddOtherHardwareDialog.tsx — clearable RNG fields.
 *
 * The dialog opens on the USB type, so each test switches the Type select to
 * VirtIO RNG to reach the two converted fields. MSW seeds the storages and USB
 * device endpoints the dialog fires on open (unhandled requests error loudly).
 *
 * Both fields keep fallback 0 on purpose: the payload builder omits
 * max_bytes / period when they are 0, which is what the old `Number('')`
 * coercion already committed on an empty field.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  fireEvent,
  userEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import { AddOtherHardwareDialog } from './AddOtherHardwareDialog'

const CONN_ID = 'conn-1'
const NODE_NAME = 'pve1'

function seedHandlers() {
  server.use(
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storages`, () =>
      HttpResponse.json({ data: [] }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/hardware/usb`, () =>
      HttpResponse.json({ data: [] }),
    ),
  )
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    connId: CONN_ID,
    node: NODE_NAME,
    vmid: '100',
    existingHardware: [] as string[],
    ...overrides,
  }
}

/**
 * Switch the hardware Type select to VirtIO RNG.
 * MUI Select aria naming does not resolve under jsdom, so the Type select is
 * reached by position: it is the first combobox in the dialog.
 */
async function selectRngType() {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
  fireEvent.click(await screen.findByRole('option', { name: /VirtIO RNG/i }))
}

const maxBytesField = () => screen.getByLabelText('Max Bytes per Period') as HTMLInputElement
const periodField = () => screen.getByLabelText('Period (ms)') as HTMLInputElement

describe('AddOtherHardwareDialog — clearable RNG fields', () => {
  // This suite renders repeatedly; RTL is not auto-cleaned up in this repo.
  afterEach(cleanup)

  beforeEach(() => {
    seedHandlers()
  })

  it('shows the RNG defaults once the RNG type is selected', async () => {
    renderWithProviders(<AddOtherHardwareDialog {...makeProps()} />)
    await selectRngType()

    expect(maxBytesField().value).toBe('1024')
    expect(periodField().value).toBe('1000')
  })

  it('replaces max bytes instead of gluing the old digits in front', async () => {
    renderWithProviders(<AddOtherHardwareDialog {...makeProps()} />)
    await selectRngType()

    await userEvent.clear(maxBytesField())
    expect(maxBytesField().value).toBe('')

    await userEvent.type(maxBytesField(), '2048')
    expect(maxBytesField().value).toBe('2048')
  })

  it('replaces the period instead of gluing the old digits in front', async () => {
    renderWithProviders(<AddOtherHardwareDialog {...makeProps()} />)
    await selectRngType()

    await userEvent.clear(periodField())
    await userEvent.type(periodField(), '500')
    expect(periodField().value).toBe('500')
  })

  it('adds the RNG device with the retyped values', async () => {
    const props = makeProps()

    renderWithProviders(<AddOtherHardwareDialog {...props} />)
    await selectRngType()

    await userEvent.clear(maxBytesField())
    await userEvent.type(maxBytesField(), '2048')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(props.onSave).toHaveBeenCalledWith({
      rng0: 'source=/dev/urandom,max_bytes=2048,period=1000',
    })
  })

  it('falls back to 0 on blur, which drops the limit from the payload', async () => {
    const props = makeProps()

    renderWithProviders(<AddOtherHardwareDialog {...props} />)
    await selectRngType()

    await userEvent.clear(periodField())
    await userEvent.tab()
    expect(periodField().value).toBe('0')

    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(props.onSave).toHaveBeenCalledWith({
      rng0: 'source=/dev/urandom,max_bytes=1024',
    })
  })
})
