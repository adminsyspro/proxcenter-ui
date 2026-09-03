/**
 * Component tests for AddOtherHardwareDialog.tsx — clearable RNG fields.
 *
 * The dialog opens on the USB type, so each test switches the Type select to
 * VirtIO RNG to reach the two converted fields. MSW seeds the storages endpoint
 * the dialog fires on open (unhandled requests error loudly).
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
  waitFor,
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

/**
 * USB / PCI passthrough through datacenter resource mappings (#852).
 *
 * PVE only lets root@pam, logged in with a password, attach a raw host device
 * (host=vendor:product or a PCI address); an API token authenticates as
 * root@pam!name and fails that check, so the dialog only offers mappings and
 * greys the raw options out.
 */

const MAPPING_URL = (kind: 'usb' | 'pci') => `*/api/v1/connections/${CONN_ID}/cluster/mapping/${kind}`

function seedMappings(kind: 'usb' | 'pci', data: unknown[]) {
  server.use(
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storages`, () =>
      HttpResponse.json({ data: [] }),
    ),
    http.get(MAPPING_URL(kind), () => HttpResponse.json({ data })),
  )
}

async function pickOption(comboboxIndex: number, name: RegExp) {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[comboboxIndex])
  fireEvent.click(await screen.findByRole('option', { name }))
}

/** Wait for the mapping select (always the last combobox once loaded). */
async function openMappingSelect(expectedComboboxes: number) {
  await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(expectedComboboxes))
  const boxes = screen.getAllByRole('combobox')

  fireEvent.mouseDown(boxes[boxes.length - 1])
}

const USB_MAPPINGS = [
  { id: 'tablet', description: 'QEMU tablet', map: ['node=pve1,id=0627:0001'] },
  { id: 'dongle', map: ['node=pve2,id=1234:5678'] },
]

describe('AddOtherHardwareDialog — mapped USB/PCI passthrough (#852)', () => {
  afterEach(cleanup)

  it('offers mapped USB devices and disables the raw host device option', async () => {
    seedMappings('usb', USB_MAPPINGS)
    const props = makeProps()

    renderWithProviders(<AddOtherHardwareDialog {...props} />)

    fireEvent.mouseDown(screen.getAllByRole('combobox')[1])
    const rawOption = await screen.findByRole('option', { name: /Raw host device \(root@pam only\)/ })

    expect(rawOption).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('option', { name: /Mapped device/ }))

    await openMappingSelect(3)
    const dongle = await screen.findByRole('option', { name: /dongle/ })

    expect(dongle).toHaveAttribute('aria-disabled', 'true')
    expect(dongle.textContent).toContain('not mapped on pve1')
    fireEvent.click(screen.getByRole('option', { name: /tablet/ }))

    await userEvent.click(await screen.findByRole('button', { name: 'Add' }))

    expect(props.onSave).toHaveBeenCalledWith({ usb0: 'mapping=tablet,usb3=1' })
  })

  it('adds a mapped PCI device with its options', async () => {
    seedMappings('pci', [{ id: 'gpu', map: ['node=pve1,path=0000:01:00.0,id=10de:1c82'] }])
    const props = makeProps()

    renderWithProviders(<AddOtherHardwareDialog {...props} />)
    await pickOption(0, /PCI Device/i)

    await openMappingSelect(3)
    fireEvent.click(await screen.findByRole('option', { name: /gpu/ }))

    await userEvent.click(screen.getByLabelText('ROM-Bar'))
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }))

    expect(props.onSave).toHaveBeenCalledWith({ hostpci0: 'mapping=gpu,pcie=1' })
  })

  it('explains an empty mapping list', async () => {
    seedMappings('pci', [])

    renderWithProviders(<AddOtherHardwareDialog {...makeProps()} />)
    await pickOption(0, /PCI Device/i)

    expect(await screen.findByText(/No PCI resource mapping is available/)).toBeInTheDocument()
  })

  it('appends the mapping hint to a root-only PVE error', async () => {
    seedMappings('usb', USB_MAPPINGS)
    const props = makeProps({
      onSave: vi.fn().mockRejectedValue(new Error(
        'PVE 500 /nodes/pve/qemu/100/config: {"message":"failed to update VM 100: only root can set \'usb1\' config for real devices\\n","data":null}',
      )),
    })

    renderWithProviders(<AddOtherHardwareDialog {...props} />)
    await pickOption(1, /Mapped device/)

    await openMappingSelect(3)
    fireEvent.click(await screen.findByRole('option', { name: /tablet/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }))

    const alert = await screen.findByText(/only root can set 'usb1' config for real devices/)

    expect(alert.textContent).toContain('Select a resource mapping instead')
  })
})

describe('AddOtherHardwareDialog — mapping list failures (#852)', () => {
  afterEach(cleanup)

  it('shows the API error when the mapping list cannot be loaded', async () => {
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storages`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get(MAPPING_URL('pci'), () =>
        HttpResponse.json({ error: 'PVE 501 /cluster/mapping/pci: not implemented' }, { status: 500 }),
      ),
    )
    renderWithProviders(<AddOtherHardwareDialog {...makeProps()} />)
    await pickOption(0, /PCI Device/i)

    expect(await screen.findByText(/Could not load resource mappings: .*not implemented/)).toBeTruthy()
  })
})
