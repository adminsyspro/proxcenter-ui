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
  fireEvent,
  userEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

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

/**
 * USB / PCI passthrough through datacenter resource mappings (#852).
 *
 * PVE refuses a raw device (host=vendor:product, a PCI address) from any API
 * token, on edit and on delete alike, so the dialog locks those and offers
 * `mapping=<id>` values only. The mapping list comes from
 * /cluster/mapping/{usb|pci}; MSW errors on any request that was not seeded,
 * which is how the "locked" cases prove nothing is fetched.
 */

const mappingHandler = (kind: 'usb' | 'pci', data: unknown[]) =>
  http.get(`*/api/v1/connections/conn-1/cluster/mapping/${kind}`, () => HttpResponse.json({ data }))

const usbMappings = [
  { id: 'tablet', map: ['node=pve1,id=0627:0001'] },
  { id: 'dongle', map: ['node=pve1,id=1234:5678'] },
]

// The MUI Select shows the current option's content; climb back to the combobox.
async function findMappingCombobox(current: string | RegExp) {
  const display = await screen.findByText(current)
  const combobox = display.closest('[role="combobox"]')
  expect(combobox).not.toBeNull()
  return combobox as HTMLElement
}

const saveButton = () => screen.getByRole('button', { name: 'Save' })
const deleteButton = () => screen.getByRole('button', { name: 'Delete' })

describe('EditOtherHardwareDialog — mapped USB/PCI passthrough (#852)', () => {
  afterEach(cleanup)

  it('locks a raw USB device and points to the Proxmox UI', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const hardware: OtherHardwareItem = { id: 'usb1', type: 'usb', rawValue: 'host=046d:c52b,usb3=1' }

    renderWithProviders(<EditOtherHardwareDialog {...makeProps({ hardware })} />)

    expect(screen.getByText(/Manage it from the Proxmox web UI/)).toBeVisible()
    expect(screen.getByText('host=046d:c52b,usb3=1')).toBeVisible()
    expect(saveButton()).toBeDisabled()
    expect(deleteButton()).toBeDisabled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('locks a raw PCI device', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const hardware: OtherHardwareItem = { id: 'hostpci0', type: 'pci', rawValue: '0000:01:00.0,pcie=1' }

    renderWithProviders(<EditOtherHardwareDialog {...makeProps({ hardware })} />)

    expect(screen.getByText(/Manage it from the Proxmox web UI/)).toBeVisible()
    expect(screen.getByText('0000:01:00.0,pcie=1')).toBeVisible()
    expect(saveButton()).toBeDisabled()
    expect(deleteButton()).toBeDisabled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('edits a mapped USB device', async () => {
    server.use(mappingHandler('usb', usbMappings))
    const props = makeProps({
      hardware: { id: 'usb1', type: 'usb', rawValue: 'mapping=tablet,usb3=1' } satisfies OtherHardwareItem,
    })

    renderWithProviders(<EditOtherHardwareDialog {...props} />)

    fireEvent.mouseDown(await findMappingCombobox('tablet'))
    fireEvent.click(await screen.findByRole('option', { name: /dongle/i }))

    const usb3 = screen.getByLabelText('USB 3.0 (xHCI)') as HTMLInputElement
    expect(usb3.checked).toBe(true)
    await userEvent.click(usb3)

    await userEvent.click(saveButton())
    expect(props.onSave).toHaveBeenCalledWith({ usb1: 'mapping=dongle' })
  })

  it('edits the options of a mapped PCI device', async () => {
    server.use(mappingHandler('pci', [{ id: 'gpu', map: ['node=pve1,path=0000:01:00.0'] }]))
    const props = makeProps({
      hardware: { id: 'hostpci0', type: 'pci', rawValue: 'mapping=gpu,pcie=1,rombar=1' } satisfies OtherHardwareItem,
    })

    renderWithProviders(<EditOtherHardwareDialog {...props} />)

    await findMappingCombobox('gpu')
    await userEvent.click(screen.getByLabelText('Primary GPU'))

    await userEvent.click(saveButton())
    expect(props.onSave).toHaveBeenCalledWith({ hostpci0: 'mapping=gpu,pcie=1,rombar=1,x-vga=1' })
  })

  it('keeps a mapping that PVE no longer lists selectable as the current value', async () => {
    server.use(mappingHandler('usb', []))
    const props = makeProps({
      hardware: { id: 'usb1', type: 'usb', rawValue: 'mapping=ghost' } satisfies OtherHardwareItem,
    })

    renderWithProviders(<EditOtherHardwareDialog {...props} />)

    const combobox = await findMappingCombobox(/ghost/)
    expect(combobox).toHaveTextContent('ghost')

    await userEvent.click(saveButton())
    expect(props.onSave).toHaveBeenCalledWith({ usb1: 'mapping=ghost' })
  })

  it('appends the mapping hint to a root-only PVE error on delete', async () => {
    server.use(mappingHandler('usb', usbMappings))
    const props = makeProps({
      hardware: { id: 'usb1', type: 'usb', rawValue: 'mapping=tablet,usb3=1' } satisfies OtherHardwareItem,
      onDelete: vi.fn().mockRejectedValue(new Error(
        'PVE 500 /nodes/pve/qemu/100/config: {"message":"failed to update VM 100: only root can set \'usb1\' config for real devices\\n","data":null}',
      )),
    })

    renderWithProviders(<EditOtherHardwareDialog {...props} />)
    await findMappingCombobox('tablet')

    await userEvent.click(deleteButton())
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' })
    await userEvent.click(confirmButtons[confirmButtons.length - 1])

    const alert = await screen.findByText(/only root can set 'usb1' config for real devices/)
    expect(alert).toHaveTextContent('Select a resource mapping instead')
    expect(props.onDelete).toHaveBeenCalledWith('usb1')
  })
})
