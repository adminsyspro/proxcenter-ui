/**
 * The "IP filter" section of a guest panel: one line for the state, one per NIC, one per address held back (with
 * "Allow"), the unknown sources and the DHCP note, then the two settings. Every edit is a PUT /policy that carries the
 * WHOLE list of guest settings and the draft version; a read-only user gets no working control.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { GuestIPFilter } from '@/lib/microseg/types'

import GuestIPFilterSection from './GuestIPFilterSection'
import { filterAnswer, filterGuest } from './ipFilterTestKit'
import { MicrosegWriteContext } from './microsegAccess'
import { calls, mock, policy, renderTab, reply, resetMocks } from './microsegTestKit'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const GUEST = { connectionId: 'c1', type: 'qemu' as const, vmid: 100, name: 'web-1' }
const OTHER: GuestIPFilter = { connection_id: 'c1', type: 'lxc', vmid: 300, name: 'ct-1', disabled: true }

/** The policy route with the IP filter on (or as given) and these guest settings. */
function setPolicy(ipFilter: boolean | undefined, guestFilters: GuestIPFilter[] | null = []) {
  const base = policy()
  const record = ipFilter === undefined ? base.policy : { ...base.policy, ip_filter: ipFilter, guest_filters: guestFilters }
  mock.routes['GET /policy'] = () => reply(200, { ...base, policy: record })
}

const body = (key: string, index = 0) => JSON.parse(String((calls(key)[index][1] as RequestInit).body))

function render(canWrite = true) {
  return renderTab(
    <MicrosegWriteContext.Provider value={canWrite}>
      <GuestIPFilterSection connectionId='c1' guest={GUEST} />
    </MicrosegWriteContext.Provider>,
  )
}

const stateLine = async () => (await screen.findByTestId('ipfilter-state')).textContent

describe('an orchestrator that does not know the IP filter', () => {
  it('draws nothing and reads nothing of it', async () => {
    setPolicy(undefined)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer())
    render()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
    expect(screen.queryByRole('region', { name: 'IP filter' })).toBeNull()
    expect(screen.queryByTestId('ipfilter-state')).toBeNull()
    expect(calls('GET /ipfilter')).toHaveLength(0)
  })
})

describe('the state line', () => {
  it.each([
    ['Filtered', filterGuest()],
    ['Will be filtered once a zone is enforced and applied', filterGuest({ applied: false })],
    ['Left without the filter', filterGuest({ mode: 'excluded', applied: false, nics: {} })],
    ['Managed by hand', filterGuest({ mode: 'manual', manual: ['net0'] })],
    ['Not filtered: no known address on net1', filterGuest({ mode: 'no_address', applied: false, no_address: ['net1'] })],
  ])('says "%s"', async (text, row) => {
    setPolicy(true)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([row]))
    render()
    await waitFor(async () => expect(await stateLine()).toBe(text))
  })

  it('says the guest is not a member of a zone, without its settings', async () => {
    setPolicy(true)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest({ vmid: 7 })]))
    render()
    await waitFor(async () => expect(await stateLine()).toBe('Not a member of a zone'))
    expect(screen.queryByRole('switch', { name: 'Leave without the filter' })).toBeNull()
    expect(screen.queryByTestId('ipfilter-nic')).toBeNull()
  })

  it('waits for the first full check, as the drifts do, and shows no list meanwhile', async () => {
    setPolicy(true)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest()], { computed: false }))
    render()
    await waitFor(async () => expect(await stateLine()).toBe('Waiting for the first full check'))
    expect(screen.queryByTestId('ipfilter-nic')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Leave without the filter' })).toBeTruthy()
  })

  it('says the filter is off for a policy that does not filter', async () => {
    setPolicy(false)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest({ applied: false })], { enabled: false }))
    render()
    await waitFor(async () => expect(await stateLine()).toBe('The IP filter is off for this policy'))
  })
})

describe('the lines of a member', () => {
  it('lists each NIC with its own addresses first and the technical ones after, a NIC without an address, the unknown sources and the DHCP note', async () => {
    setPolicy(true)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest({
      nics: { net0: ['0.0.0.0', '10.0.0.5', '10.0.0.6', 'fe80::1'] }, no_address: ['net1'], unknown: ['10.0.0.99', '10.0.0.98'], dhcp: ['net0'],
    })]))
    render()
    const net0 = await screen.findByRole('listitem', { name: 'net0' })
    expect(net0.textContent).toBe('net010.0.0.5, 10.0.0.60.0.0.0, fe80::1')
    expect(screen.getByRole('listitem', { name: 'net1' }).textContent).toBe('net1no known address')
    expect(screen.getByTestId('ipfilter-unknown').textContent).toBe('Source addresses seen that the filter would drop: 10.0.0.99, 10.0.0.98')
    expect(screen.getByTestId('ipfilter-dhcp').textContent).toBe('net0 on DHCP: an address that changes is cut until the next address collection')
  })

  it('says who holds an address that was not added, by reason', async () => {
    setPolicy(true)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest({
      held: [
        { nic: 'net0', addr: '10.0.0.7', reason: 'guest', by: 'db-1' },
        { nic: 'net0', addr: '10.0.0.8', reason: 'peer' },
        { nic: 'net1', addr: '10.0.1.9', reason: 'source', by: '10.0.1.0/24' },
      ],
    })]))
    render()
    await screen.findAllByTestId('ipfilter-held')
    expect(screen.getAllByTestId('ipfilter-held').map(e => e.textContent)).toEqual([
      '10.0.0.7 on net0: held by db-1, a member of another zoneAllow',
      '10.0.0.8 on net0: held by a member of another zone on another clusterAllow',
      '10.0.1.9 on net1: inside the source network 10.0.1.0/24 of a flowAllow',
    ])
  })
})

describe('leaving a guest without the filter', () => {
  it('sends the whole list with the entry of the guest added, the others untouched, and the draft version', async () => {
    setPolicy(true, [OTHER])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer())
    mock.routes['PUT /policy'] = () => reply(200, { version: 4 })
    render()
    const toggle = await screen.findByRole('switch', { name: 'Leave without the filter' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() => expect(calls('PUT /policy')).toHaveLength(1))
    expect(body('PUT /policy')).toEqual({ version: 3, guest_filters: [OTHER, { connection_id: 'c1', type: 'qemu', vmid: 100, name: 'web-1', disabled: true }] })
    // The draft and the filter are read again after the write.
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(1))
    await waitFor(() => expect(calls('GET /ipfilter').length).toBeGreaterThan(1))
  })

  it('reads the switch from the draft and takes the entry out of the list when it has nothing else', async () => {
    setPolicy(true, [{ type: 'qemu', vmid: 100, disabled: true }, OTHER])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest({ mode: 'excluded' })]))
    mock.routes['PUT /policy'] = () => reply(200, { version: 4 })
    render()
    const toggle = await screen.findByRole('switch', { name: 'Leave without the filter' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => expect(calls('PUT /policy')).toHaveLength(1))
    expect(body('PUT /policy')).toEqual({ version: 3, guest_filters: [OTHER] })
  })

  it('says a refusal above the lines and reads the draft again', async () => {
    setPolicy(true)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer())
    mock.routes['PUT /policy'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    render()
    fireEvent.click(await screen.findByRole('switch', { name: 'Leave without the filter' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(1))
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('additional addresses', () => {
  const stored: GuestIPFilter = { connection_id: 'c1', type: 'qemu', vmid: 100, name: 'web-1', extra: ['10.0.0.7'] }

  it('counts them on the row, and none as "None"', async () => {
    setPolicy(true, [stored])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer())
    render()
    expect(await screen.findByText('1 address')).toBeTruthy()
    cleanup()
    setPolicy(true, [])
    render()
    expect(await screen.findByText('None')).toBeTruthy()
  })

  it('edits them one per line and sends the whole list with the entry of the guest replaced', async () => {
    setPolicy(true, [OTHER, stored])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer())
    mock.routes['PUT /policy'] = () => reply(200, { version: 4 })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit the additional addresses' }))
    const dialog = await screen.findByRole('dialog', { name: 'Additional addresses of web-1' })
    const field = within(dialog).getByRole('textbox', { name: 'Addresses' }) as HTMLTextAreaElement
    expect(field.value).toBe('10.0.0.7')
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field, { target: { value: '10.0.0.7\n10.0.2.0/24\nfd00::5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PUT /policy')).toHaveLength(1))
    expect(body('PUT /policy')).toEqual({ version: 3, guest_filters: [OTHER, { ...stored, extra: ['10.0.0.7', '10.0.2.0/24', 'fd00::5'] }] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('names an entry that is neither an address nor a range and does not send it', async () => {
    setPolicy(true, [])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer())
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit the additional addresses' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Addresses' }), { target: { value: '10.0.0.7\nweb-2' } })
    expect(within(dialog).getByText('web-2 is not an address or a range')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls('PUT /policy')).toHaveLength(0)
  })

  it('shows the refusal of the server in the dialog, which stays open with what was typed', async () => {
    setPolicy(true, [])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer())
    mock.routes['PUT /policy'] = () => reply(400, { code: 'INVALID', error: 'guest_filters: 10.0.0.0/8 is too wide' })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit the additional addresses' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Addresses' }), { target: { value: '10.0.0.0/8' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText(/10\.0\.0\.0\/8 is too wide/)).toBeTruthy()
    expect((within(dialog).getByRole('textbox', { name: 'Addresses' }) as HTMLTextAreaElement).value).toBe('10.0.0.0/8')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('allowing an address held back', () => {
  const held = filterGuest({ held: [{ nic: 'net0', addr: '10.0.0.7', reason: 'guest', by: 'db-1' }] })

  it('asks in a themed dialog, then adds the address to the additional addresses of the guest', async () => {
    setPolicy(true, [{ connection_id: 'c1', type: 'qemu', vmid: 100, name: 'web-1', extra: ['10.0.0.6'] }])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([held]))
    mock.routes['PUT /policy'] = () => reply(200, { version: 4 })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Allow 10.0.0.7' }))
    const dialog = await screen.findByRole('dialog', { name: 'Allow 10.0.0.7 for web-1?' })
    expect(calls('PUT /policy')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow this address' }))
    await waitFor(() => expect(calls('PUT /policy')).toHaveLength(1))
    expect(body('PUT /policy')).toEqual({ version: 3, guest_filters: [{ connection_id: 'c1', type: 'qemu', vmid: 100, name: 'web-1', extra: ['10.0.0.6', '10.0.0.7'] }] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('writes nothing when the confirmation is cancelled, and keeps a refusal in the dialog', async () => {
    setPolicy(true, [])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([held]))
    mock.routes['PUT /policy'] = () => reply(400, { code: 'INVALID', error: 'address held by a peer' })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Allow 10.0.0.7' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls('PUT /policy')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Allow 10.0.0.7' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow this address' }))
    expect(await within(dialog).findByText(/address held by a peer/)).toBeTruthy()
  })
})

describe('a read-only user', () => {
  it('reads the section with every control disabled and the reason on each', async () => {
    setPolicy(true, [])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest({ held: [{ nic: 'net0', addr: '10.0.0.7', reason: 'guest', by: 'db-1' }] })]))
    render(false)
    const toggle = await screen.findByRole('switch', { name: 'Leave without the filter' }) as HTMLInputElement
    expect(toggle.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Edit the additional addresses' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Allow 10.0.0.7' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByLabelText('Read-only: you need node management rights').length).toBe(3)
    expect(await stateLine()).toBe('Filtered')
  })
})
