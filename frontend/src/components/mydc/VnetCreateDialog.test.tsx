/**
 * Component tests for VnetCreateDialog, the tenant VNet creation form.
 *
 * Focus: the VLAN branch (issue #646). A vDC with no VLAN pool must keep the
 * pre-existing VXLAN-only form and POST body byte-for-byte, while a vDC
 * carrying pools gains a network-type selector that unlocks bridge, VLAN ID
 * and the external-addressing checkbox.
 *
 * This repo has no RTL auto-cleanup, so cleanup() is called explicitly in
 * afterEach (same pattern as VnetsSection.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import {
  renderWithProviders, screen, fireEvent, waitFor,
} from '@/__tests__/setup/renderWithProviders'
import VnetCreateDialog from './VnetCreateDialog'

const VDC_PLAIN = { id: 'v1', name: 'ACME GRA4' }
const VDC_POOLED = {
  id: 'v1',
  name: 'ACME GRA4',
  vlanPools: [{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 199 }],
}
const VDC_RANGE = {
  id: 'v1',
  name: 'ACME GRA4',
  transport: { sharing: 'shared', vniRangeStart: 20000, vniRangeEnd: 20009 },
}
const VDC_DEDICATED = { id: 'v1', name: 'ACME GRA4', transport: { sharing: 'dedicated', vniRangeStart: null, vniRangeEnd: null } }
const VDC_PLATFORM_EDGE = { id: 'v1', name: 'ACME GRA4', edgeModel: 'platform' }
const VDC_TWO_BRIDGES = {
  id: 'v1',
  name: 'ACME GRA4',
  vlanPools: [
    { bridge: 'vmbr0', rangeStart: 100, rangeEnd: 199 },
    { bridge: 'vmbr1', rangeStart: 300, rangeEnd: 399 },
  ],
}

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonRes({ data: { id: 'vnet-1' } }, 201))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.cookie = 'pc_vdc_context=; path=/; max-age=0'
})

/** POST body of the last /vnets call, parsed. */
function lastPostBody() {
  const call = [...fetchMock.mock.calls].reverse().find(c => String(c[0]).includes('/vnets'))
  expect(call).toBeTruthy()
  return JSON.parse(String((call as any[])[1].body))
}

/** MUI appends a " *" to the label of a required field, so match on the
 *  label's own text and tolerate the asterisk. */
function labelRe(label: string) {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ?\\*?$`)
}

function field(label: string) {
  return screen.getByLabelText(labelRe(label))
}

function queryField(label: string) {
  return screen.queryByLabelText(labelRe(label))
}

function setText(label: string, value: string) {
  fireEvent.change(field(label) as HTMLInputElement, { target: { value } })
}

/** Open a MUI select by its label and pick the option with that text. */
async function pickOption(label: string, optionName: string | RegExp) {
  fireEvent.mouseDown(field(label))
  const option = await screen.findByRole('option', { name: optionName })
  fireEvent.click(option)
  // The open listbox carries the same aria-labelledby as its combobox, so a
  // second pick on the same select would see two matches for the label.
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

/** Fill the always-required fields (name + subnet). */
function fillRequired(name = 'web') {
  setText('Name', name)
  setText('CIDR', '10.42.0.0/24')
}

function createButton() {
  return screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
}

function renderDialog(vdcs: any[]) {
  return renderWithProviders(
    <VnetCreateDialog open vdcs={vdcs} onClose={() => {}} onCreated={() => {}} />,
  )
}

describe('VnetCreateDialog: vDC without VLAN pools', () => {
  it('renders no network-type selector', () => {
    renderDialog([VDC_PLAIN])

    expect(queryField('Network type')).toBeNull()
    expect(queryField('Bridge')).toBeNull()
    expect(queryField('VLAN ID')).toBeNull()
    // External addressing is a VLAN-only escape hatch: on a VXLAN overlay
    // ProxCenter's IPAM is the only allocator that works.
    expect(queryField('Addressing managed outside ProxCenter')).toBeNull()
    expect(screen.getByText('VNI is auto-allocated by ProxCenter.')).toBeTruthy()
  })

  it('posts the legacy body: no type, bridge, vlanTag or externalAddressing key', async () => {
    renderDialog([VDC_PLAIN])
    fillRequired()

    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = lastPostBody()
    expect(Object.keys(body).sort()).toEqual(['displayName', 'firewall', 'subnet'].sort())
    expect(body.displayName).toBe('web')
    expect(body.subnet.cidr).toBe('10.42.0.0/24')
    expect(body.subnet.gateway).toBe('10.42.0.1')
  })
})

describe('VnetCreateDialog: pure L2 network (roadmap#18) and L3 edge (#904)', () => {
  it('posts subnet: null once the IP configuration switch is off, and hides the subnet fields', async () => {
    renderDialog([VDC_PLAIN])
    setText('Name', 'l2')
    // Name alone is not enough while the subnet is on.
    expect(createButton().disabled).toBe(true)

    fireEvent.click(field('Configure IP addressing (CIDR, gateway, DNS)'))
    expect(queryField('CIDR')).toBeNull()
    expect(queryField('Gateway')).toBeNull()
    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = lastPostBody()
    expect(body.subnet).toBeNull()
    expect(body.displayName).toBe('l2')
    expect('vni' in body).toBe(false)
  })

  it('a platform-provided edge locks the IP configuration on', () => {
    renderDialog([VDC_PLATFORM_EDGE])
    const toggle = field('Configure IP addressing (CIDR, gateway, DNS)') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(true)
    expect(screen.getByText(/Your provider operates the L3 edge/)).toBeTruthy()
    expect(queryField('CIDR')).not.toBeNull()
  })

  it('offers no VNI field on a shared transport without a range', () => {
    renderDialog([VDC_PLAIN])
    expect(queryField('VNI')).toBeNull()
    expect(screen.getByText('VNI is auto-allocated by ProxCenter.')).toBeTruthy()
  })

  it('shared transport with a range: VNI field gated to the range, posted as a number', async () => {
    renderDialog([VDC_RANGE])
    fillRequired('web')
    // The range reads once, in the VNI field helper, and no subnet title
    // repeats the IP toggle label.
    expect(screen.getAllByText(/20000-20009/)).toHaveLength(1)
    expect(screen.getByText(/assigned you the VNI range 20000-20009/)).toBeTruthy()
    expect(screen.queryByText(/^Subnet \(CIDR/)).toBeNull()
    setText('VNI', '30000')
    await waitFor(() => expect(createButton().disabled).toBe(true))
    setText('VNI', '20003')
    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(lastPostBody().vni).toBe(20003)
  })

  it('dedicated transport: any VNI up to 16777215', async () => {
    renderDialog([VDC_DEDICATED])
    fillRequired('web')
    expect(screen.getByText(/dedicated transport: you choose the VNI/)).toBeTruthy()
    setText('VNI', '16777216')
    await waitFor(() => expect(createButton().disabled).toBe(true))
    setText('VNI', '42')
    await waitFor(() => expect(createButton().disabled).toBe(false))
  })
})

describe('VnetCreateDialog: vDC with VLAN pools', () => {
  it('offers the network type selector and reveals the VLAN fields once VLAN is picked', async () => {
    renderDialog([VDC_POOLED])

    expect(field('Network type')).toBeTruthy()
    // VXLAN stays the default: no VLAN field until the tenant asks for one,
    // and no external-addressing checkbox either.
    expect(queryField('Bridge')).toBeNull()
    expect(queryField('VLAN ID')).toBeNull()
    expect(queryField('Addressing managed outside ProxCenter')).toBeNull()

    await pickOption('Network type', 'VLAN')

    expect(field('Bridge')).toBeTruthy()
    expect(field('VLAN ID')).toBeTruthy()
    expect(field('Addressing managed outside ProxCenter')).toBeTruthy()
    expect(screen.getByText('The VLAN ID is allocated from the pools dedicated to your vDC.')).toBeTruthy()
    // The hint spells out the pool ranges the tenant may pick from.
    expect(screen.getByText(/100-199/)).toBeTruthy()
  })

  it('auto-selects the only bridge and submits { type, bridge } without a vlanTag', async () => {
    renderDialog([VDC_POOLED])
    fillRequired()
    await pickOption('Network type', 'VLAN')

    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = lastPostBody()
    expect(body.type).toBe('vlan')
    expect(body.bridge).toBe('vmbr0')
    expect('vlanTag' in body).toBe(false)
    expect('externalAddressing' in body).toBe(false)
  })

  it('submits the manual VLAN ID when the tenant types one', async () => {
    renderDialog([VDC_POOLED])
    fillRequired()
    await pickOption('Network type', 'VLAN')
    setText('VLAN ID', '150')

    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(lastPostBody().vlanTag).toBe(150)
  })

  it('blocks submit on a VLAN ID outside the vDC pools', async () => {
    renderDialog([VDC_POOLED])
    fillRequired()
    await pickOption('Network type', 'VLAN')
    setText('VLAN ID', '4000')

    await waitFor(() => expect(createButton().disabled).toBe(true))
    setText('VLAN ID', '150')
    await waitFor(() => expect(createButton().disabled).toBe(false))
  })

  it('leaves the bridge unselected when the vDC spans several bridges, and blocks submit until one is picked', async () => {
    renderDialog([VDC_TWO_BRIDGES])
    fillRequired()
    await pickOption('Network type', 'VLAN')

    // MUI renders a zero-width space in an empty select, so assert on the
    // absence of a bridge name rather than on an empty string.
    expect((field('Bridge') as HTMLElement).textContent).not.toContain('vmbr')
    await waitFor(() => expect(createButton().disabled).toBe(true))

    await pickOption('Bridge', 'vmbr1')
    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(lastPostBody().bridge).toBe('vmbr1')
  })

  it('sends externalAddressing when the checkbox is ticked', async () => {
    renderDialog([VDC_POOLED])
    fillRequired()
    await pickOption('Network type', 'VLAN')
    fireEvent.click(field('Addressing managed outside ProxCenter'))

    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(lastPostBody().externalAddressing).toBe(true)
  })

  it('drops the external-addressing flag when the tenant switches back to VXLAN', async () => {
    renderDialog([VDC_POOLED])
    fillRequired()
    await pickOption('Network type', 'VLAN')
    fireEvent.click(field('Addressing managed outside ProxCenter'))
    expect((field('Addressing managed outside ProxCenter') as HTMLInputElement).checked).toBe(true)

    await pickOption('Network type', /^VXLAN/)
    expect(queryField('Addressing managed outside ProxCenter')).toBeNull()

    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = lastPostBody()
    expect('externalAddressing' in body).toBe(false)
    expect('type' in body).toBe(false)
    expect('bridge' in body).toBe(false)
  })

  it('drops the VLAN sub-form back to VXLAN when the tenant switches vDC', async () => {
    const vdcB = { id: 'v2', name: 'ACME SBG', vlanPools: [{ bridge: 'vmbr9', rangeStart: 500, rangeEnd: 599 }] }
    renderDialog([VDC_POOLED, vdcB])

    await pickOption('Network type', 'VLAN')
    expect((field('Bridge') as HTMLElement).textContent).toContain('vmbr0')

    await pickOption('Virtual Datacenter', 'ACME SBG')

    // A bridge dedicated to vDC A means nothing in vDC B, so the whole
    // sub-form is gone and the type is back to the VXLAN default.
    expect(queryField('Bridge')).toBeNull()
    expect(queryField('VLAN ID')).toBeNull()
    expect((field('Network type') as HTMLElement).textContent).toContain('VXLAN')
  })

  it('still requires CIDR and gateway in VLAN mode', async () => {
    renderDialog([VDC_POOLED])
    setText('Name', 'web')
    await pickOption('Network type', 'VLAN')

    // Name + auto-selected bridge are not enough: the subnet is mandatory.
    await waitFor(() => expect(createButton().disabled).toBe(true))

    setText('CIDR', '10.42.0.0/24')
    await waitFor(() => expect(createButton().disabled).toBe(false))

    // The gateway is auto-suggested from the CIDR, so it can't be emptied;
    // point it outside the subnet instead and the gate closes again.
    setText('Gateway', '192.168.9.9')
    await waitFor(() => expect(createButton().disabled).toBe(true))
  })
})
