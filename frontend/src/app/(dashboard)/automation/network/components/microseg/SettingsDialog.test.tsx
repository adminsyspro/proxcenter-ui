/**
 * Settings of the Micro-segmentation tab: bounds, the log rate limit form, the
 * self IPs, the changed fields only, the errors of the write, and the removal
 * that needs the connection name typed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { screen, fireEvent, renderWithProviders, waitFor } from '@/__tests__/setup/renderWithProviders'
import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'
import type { MicrosegSettings } from '@/lib/microseg/types'

import { calls, fetchMock, mock, policy, reply, resetMocks, zone } from './microsegTestKit'
import { body } from './policyTestKit'
import SettingsDialog from './SettingsDialog'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SETTINGS: MicrosegSettings = {
  light_interval_sec: 300, ips_interval_sec: 900, full_interval_sec: 1800, log_interval_sec: 60, ready_after_hours: 24,
  write_cap: 50, observe_log_rate_limit: '', original_log_rate_limit: '', notify_drift: true, notify_paused: true,
  notify_unprotected: true, notify_blocked: true,
}

function open(settings: Partial<MicrosegSettings> = {}, props: Partial<Parameters<typeof SettingsDialog>[0]> = {}, withZones = false) {
  const base = policy(withZones ? { zones: [zone('web')] } : {})
  const current = { ...base, policy: { ...base.policy, settings: { ...SETTINGS, ...settings } } }
  const handlers = { reloadPolicy: vi.fn(async () => undefined), startRun: vi.fn(), onClose: vi.fn() }
  renderWithProviders(<SettingsDialog connectionId='c1' connectionName='prod-cluster' policy={current} {...handlers} {...props} />)
  return handlers
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
const put = () => calls('PUT /policy')
const ADDRESSES = 'Addresses Proxmox sees'
const openAdvanced = () => fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

describe('form', () => {
  it('shows the current values and keeps Save off until something changes', () => {
    open()
    expect(field('Tag prefix').value).toBe('zone-')
    expect(field('Light check interval').value).toBe('300')
    expect(field('Write cap per run').value).toBe('50')
    expect(save().disabled).toBe(true)
    type('Light check interval', '120')
    expect(save().disabled).toBe(false)
  })

  it('refuses an interval out of bounds and says the bounds', () => {
    open()
    type('Light check interval', '30')
    expect(screen.getByText('Light check interval must be between 60 and 3600 seconds.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    fireEvent.click(save())
    expect(put()).toHaveLength(0)

    type('Light check interval', '60')
    expect(screen.queryByText(/must be between/)).toBeNull()
    expect(save().disabled).toBe(false)
  })

  it.each([
    ['IP read interval', 'Guest IP read interval', '299', 300, 86400, 'seconds'],
    ['full interval', 'Full check interval', '86401', 600, 86400, 'seconds'],
    ['log interval', 'Firewall log read interval', '601', 30, 600, 'seconds'],
    ['ready after', 'Observation before blocking (inbound and outbound)', '169', 1, 168, 'hours'],
    ['write cap', 'Write cap per run', '0', 1, 500, 'writes'],
  ])('refuses the %s out of bounds', (_name, label, value, min, max, unit) => {
    open()
    type(label, value)
    expect(screen.getByText(`${label} must be between ${min} and ${max} ${unit}.`)).toBeTruthy()
    expect(save().disabled).toBe(true)
  })

  it('refuses a tag prefix the orchestrator would refuse', () => {
    open()
    type('Tag prefix', 'Zone Prefix')
    expect(screen.getByText(/The tag prefix is 1 to 16 characters/)).toBeTruthy()
    expect(save().disabled).toBe(true)
  })
})

describe('layout', () => {
  it('puts the checkboxes in the control column, flush left, under the same left edge as the fields', () => {
    open()
    for (const name of ['Drifts', 'Engine paused', 'Unprotected guests', 'Blocked flows']) {
      const box = screen.getByRole('checkbox', { name })
      const grid = box.closest('div[class*="MuiBox"]')?.parentElement?.parentElement as HTMLElement
      expect(grid.children).toHaveLength(2)
      expect(grid.children[1].contains(box)).toBe(true)
      expect(grid.children[0].contains(box)).toBe(false)
      expect(grid.children[0].textContent).toBe(name)
    }
  })

  it('separates every section after the first with a divider', () => {
    open()
    const sections = screen.getAllByTestId('settings-section')
    expect(sections.length).toBeGreaterThanOrEqual(6)
    sections.forEach((section, i) => {
      const divider = section.querySelector('[data-testid="settings-section-divider"]')
      expect(!!divider).toBe(i > 0)
    })
  })

  it('shows the write cap unit and the gear icon', () => {
    open()
    expect(screen.getByText('writes')).toBeTruthy()
    expect(screen.getByTestId('settings-dialog-icon').className).toContain('ri-settings-3-line')
  })

  it('has an info tooltip on the rate limit, the log interval, the observation and the write cap', async () => {
    open()
    const tips = screen.getAllByTestId('form-row-tip')
    expect(tips.length).toBeGreaterThanOrEqual(4)
    const expected: Array<[string, string]> = [
      ['Log rate limit', 'Cap on log lines per rule'],
      ['Firewall log read interval', 'Delay between two reads of the firewall log'],
      ['Observation before blocking (inbound and outbound)', 'it is not a lock'],
      ['Write cap per run', 'Past it, the engine stops'],
    ]
    for (const [label, text] of expected) {
      const row = screen.getByText(label).parentElement as HTMLElement
      const icon = within(row).getByTestId('form-row-tip')
      fireEvent.mouseOver(icon)
      expect((await screen.findAllByText(new RegExp(text))).length).toBeGreaterThan(0)
      fireEvent.mouseLeave(icon)
    }
  })
})

describe('log rate limit', () => {
  it('reads the stored value into the rate, the unit and the burst', () => {
    open({ observe_log_rate_limit: 'enable=1,rate=10/minute,burst=20' })
    expect(field('Log rate limit').value).toBe('10')
    expect(field('Log burst').value).toBe('20')
    expect(screen.getByRole('combobox', { name: 'Log rate unit' }).textContent).toBe('per minute')
  })

  it('builds enable=1,rate=N/unit,burst=N and round trips', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    open({ observe_log_rate_limit: 'enable=1,rate=10/second,burst=20' })

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Log rate unit' }))
    fireEvent.click(await screen.findByRole('option', { name: 'per hour' }))
    type('Log burst', '30')
    fireEvent.click(save())

    await waitFor(() => expect(put()).toHaveLength(1))
    expect(body(put()[0][1])).toEqual({ version: 3, settings: { observe_log_rate_limit: 'enable=1,rate=10/hour,burst=30' } })
  })

  it('sets the limit from empty fields', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    open()
    type('Log rate limit', '5')
    expect(screen.getByText('Give both the log rate and the log burst, or leave both empty.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    type('Log burst', '15')
    fireEvent.click(save())
    await waitFor(() => expect(put()).toHaveLength(1))
    expect(body(put()[0][1]).settings).toEqual({ observe_log_rate_limit: 'enable=1,rate=5/second,burst=15' })
  })

  it('sends an empty value when both fields are emptied (PVE left alone again)', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    open({ observe_log_rate_limit: 'enable=1,rate=10/second,burst=20' })
    type('Log rate limit', '')
    type('Log burst', '')
    fireEvent.click(save())
    await waitFor(() => expect(put()).toHaveLength(1))
    expect(body(put()[0][1]).settings).toEqual({ observe_log_rate_limit: '' })
  })

  it('refuses a rate that is not a whole number', () => {
    open()
    type('Log rate limit', '1.5')
    type('Log burst', '10')
    expect(screen.getByText('The log rate is a whole number, 1 or more.')).toBeTruthy()
    expect(save().disabled).toBe(true)
  })
})

describe('self IPs', () => {
  it('names the address that is not valid and refuses to save', () => {
    open()
    openAdvanced()
    type(ADDRESSES, '10.0.0.5, 10.0.0.999')
    expect(screen.getByText('10.0.0.999 is not a valid IP address.')).toBeTruthy()
    expect(save().disabled).toBe(true)
  })

  it('refuses more than 16', () => {
    open()
    openAdvanced()
    type(ADDRESSES, Array.from({ length: 17 }, (_, i) => `10.0.0.${i + 1}`).join(' '))
    expect(screen.getByText('At most 16 addresses.')).toBeTruthy()
    expect(save().disabled).toBe(true)
  })

  it('sends the list, and an empty list when they are cleared', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    open({ self_ips: ['10.0.0.5'] })
    openAdvanced()
    expect(field(ADDRESSES).value).toBe('10.0.0.5')
    type(ADDRESSES, '10.0.0.5, fd00::1')
    fireEvent.click(save())
    await waitFor(() => expect(put()).toHaveLength(1))
    expect(body(put()[0][1]).settings).toEqual({ self_ips: ['10.0.0.5', 'fd00::1'] })
  })

  it('clears them with an empty list', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    open({ self_ips: ['10.0.0.5'] })
    openAdvanced()
    type(ADDRESSES, '')
    fireEvent.click(save())
    await waitFor(() => expect(put()).toHaveLength(1))
    expect(body(put()[0][1]).settings).toEqual({ self_ips: [] })
  })
})

describe('advanced section', () => {
  const openWith = (extra: Record<string, unknown>, settings: Partial<MicrosegSettings> = {}) =>
    open(settings, { policy: { ...policy(), ...extra, policy: { ...policy().policy, settings: { ...SETTINGS, ...settings } } } as never })

  it('is closed at opening, last before the removal, and holds the addresses with their tooltip', async () => {
    open()
    const toggle = screen.getByRole('button', { name: 'Advanced' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('textbox', { name: ADDRESSES })).toBeNull()
    const sections = screen.getAllByTestId('settings-section')
    expect(sections[sections.length - 2].contains(toggle)).toBe(true)
    expect(sections[sections.length - 1].textContent).toBe('Removal')

    openAdvanced()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const input = field(ADDRESSES)
    const row = input.closest('div[class*="MuiBox"]')?.parentElement?.parentElement as HTMLElement
    fireEvent.mouseOver(within(row).getByTestId('form-row-tip'))
    expect(await screen.findByText(/Addresses ProxCenter reaches the nodes from\. The preflight checks they are not cut off\./)).toBeTruthy()
  })

  it.each([
    ['install', ['10.42.0.250', '2001:db8::250'], '10.42.0.250, 2001:db8::250 (install script)'],
    ['detected', ['172.17.0.3'], '172.17.0.3 (detected)'],
  ])('shows the %s addresses an empty field stands for', (source, ips, text) => {
    openWith({ self_ips_effective: ips, self_ips_source: source })
    openAdvanced()
    expect(field(ADDRESSES).placeholder).toBe(text)
    expect(field(ADDRESSES).title).toBe(text)
    expect(field(ADDRESSES).value).toBe('')
  })

  it('shows the addresses of the settings in the field, and the detection as placeholder', () => {
    openWith({ self_ips_effective: ['10.0.0.5'], self_ips_source: 'settings' }, { self_ips: ['10.0.0.5'] })
    openAdvanced()
    expect(field(ADDRESSES).value).toBe('10.0.0.5')
    expect(field(ADDRESSES).placeholder).toBe('Detected automatically')
  })

  it('warns that a lone container address is not what Proxmox sees, until an address is typed', async () => {
    openWith({ self_ips_effective: ['172.17.0.3'], self_ips_source: 'detected', self_ips_docker_internal: true })
    openAdvanced()
    expect(field(ADDRESSES).placeholder).toBe('172.17.0.3 (detected)')
    const warning = screen.getByTestId('settings-field-warning')
    expect(warning.getAttribute('aria-label')).toBe("Address internal to Docker: Proxmox sees the host's address, enter it here.")
    type(ADDRESSES, '10.42.0.250')
    expect(screen.queryByTestId('settings-field-warning')).toBeNull()
  })

  it('has no warning for a host address', () => {
    openWith({ self_ips_effective: ['10.42.0.250'], self_ips_source: 'install', self_ips_docker_internal: false })
    openAdvanced()
    expect(screen.queryByTestId('settings-field-warning')).toBeNull()
  })

  it('falls back to the detection wording on an older orchestrator', () => {
    open()
    openAdvanced()
    expect(field(ADDRESSES).placeholder).toBe('Detected automatically')
  })

  it('says Unchanged in the empty log rate fields', () => {
    open()
    expect(field('Log rate limit').placeholder).toBe('Unchanged')
    expect(field('Log burst').placeholder).toBe('Unchanged')
  })
})

describe('saving', () => {
  it('sends only the changed fields with the draft version, reloads and closes', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    const { reloadPolicy, onClose } = open()

    type('Tag prefix', 'seg-')
    type('Write cap per run', '20')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Drifts' }))
    fireEvent.click(save())

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(body(put()[0][1])).toEqual({ version: 3, tag_prefix: 'seg-', settings: { write_cap: 20, notify_drift: false } })
    expect(reloadPolicy).toHaveBeenCalled()
  })

  it('shows the server message of a 400 INVALID and keeps the input', async () => {
    mock.routes['PUT /policy'] = () => reply(400, { code: 'INVALID', error: 'write_cap must be 1 to 500 writes, got 700' })
    const { onClose } = open()
    type('Light check interval', '120')
    fireEvent.click(save())

    expect(await screen.findByText(/write_cap must be 1 to 500 writes, got 700/)).toBeTruthy()
    expect(field('Light check interval').value).toBe('120')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reloads the policy on a 409 and keeps the input to send again', async () => {
    let conflict = true
    mock.routes['PUT /policy'] = () => (conflict
      ? reply(409, { code: 'VERSION_CONFLICT', error: 'version conflict' })
      : reply(200, { version: 5, policy: policy().policy }))
    const { reloadPolicy, onClose } = open()
    type('Light check interval', '120')
    fireEvent.click(save())

    expect(await screen.findByText(/changed elsewhere/i)).toBeTruthy()
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
    expect(field('Light check interval').value).toBe('120')
    expect(onClose).not.toHaveBeenCalled()

    conflict = false
    fireEvent.click(save())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('tag prefix change', () => {
  const confirmButton = () => within(screen.getByRole('dialog', { name: 'Change the tag prefix?' })).getByRole('button', { name: 'Change the prefix' }) as HTMLButtonElement

  it('warns, and asks to type the new prefix, when the policy has zones', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    const { onClose } = open({}, {}, true)
    expect(screen.queryByText(/leave their zones at the next apply\.$/)).toBeNull()

    type('Tag prefix', 'seg-')
    expect(screen.getByText('Guests tagged with the old prefix leave their zones at the next apply.')).toBeTruthy()
    fireEvent.click(save())

    const dialog = await screen.findByRole('dialog', { name: 'Change the tag prefix?' })
    expect(put()).toHaveLength(0)
    expect(confirmButton().disabled).toBe(true)
    const input = within(dialog).getByRole('textbox', { name: 'Type seg- to confirm' })
    fireEvent.change(input, { target: { value: 'seg' } })
    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'seg-' } })
    fireEvent.click(confirmButton())

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(body(put()[0][1])).toEqual({ version: 3, tag_prefix: 'seg-' })
  })

  it('saves nothing when the confirmation is cancelled', async () => {
    open({}, {}, true)
    type('Tag prefix', 'seg-')
    fireEvent.click(save())
    const dialog = await screen.findByRole('dialog', { name: 'Change the tag prefix?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change the tag prefix?' })).toBeNull())
    expect(put()).toHaveLength(0)
    expect(field('Tag prefix').value).toBe('seg-')
  })

  it('does not ask for another field, nor warn when the prefix is not touched', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    const { onClose } = open({}, {}, true)
    type('Write cap per run', '20')
    expect(screen.queryByText(/Guests tagged with the old prefix/)).toBeNull()
    fireEvent.click(save())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: 'Change the tag prefix?' })).toBeNull()
  })

  it('neither warns nor asks when the policy has no zone', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    const { onClose } = open()
    type('Tag prefix', 'seg-')
    expect(screen.queryByText(/Guests tagged with the old prefix/)).toBeNull()
    fireEvent.click(save())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(body(put()[0][1])).toEqual({ version: 3, tag_prefix: 'seg-' })
  })
})

describe('a stored value the form cannot show', () => {
  it('does not block Save: a rate without burst reads as leave as is', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    const { onClose } = open({ observe_log_rate_limit: 'enable=1,rate=5/minute' })
    expect(field('Log rate limit').value).toBe('')
    type('Write cap per run', '20')
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(body(put()[0][1])).toEqual({ version: 3, settings: { write_cap: 20 } })
  })

  it('does not block Save for a stored interval out of the bounds while another field is edited', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    const { onClose } = open({ light_interval_sec: 30 })
    type('Write cap per run', '20')
    expect(screen.queryByText(/must be between/)).toBeNull()
    fireEvent.click(save())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(body(put()[0][1]).settings).toEqual({ write_cap: 20 })
  })
})

describe('removal', () => {
  const askRemoval = () => fireEvent.click(screen.getByRole('button', { name: 'Remove…' }))
  const confirmButton = () => within(screen.getByRole('dialog', { name: 'Remove micro-segmentation?' })).getByRole('button', { name: 'Remove' }) as HTMLButtonElement

  it('needs the connection name typed before it removes anything', async () => {
    mock.routes['POST /remove'] = () => reply(202, { run_id: 'run-9' })
    const { startRun, onClose } = open()
    askRemoval()
    const dialog = await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })

    expect(confirmButton().disabled).toBe(true)
    const input = within(dialog).getByRole('textbox', { name: 'Type prod-cluster to confirm' })
    fireEvent.change(input, { target: { value: 'prod-clust' } })
    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'PROD-CLUSTER' } })
    expect(confirmButton().disabled).toBe(true)
    expect(calls('POST /remove')).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'prod-cluster' } })
    expect(confirmButton().disabled).toBe(false)
    fireEvent.click(confirmButton())

    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(startRun.mock.calls[0][0]).toMatchObject({ runId: 'run-9', kind: 'remove', label: 'prod-cluster' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows why the removal did not start and stays open', async () => {
    mock.routes['POST /remove'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    const { startRun } = open()
    askRemoval()
    const dialog = await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'prod-cluster' } })
    fireEvent.click(confirmButton())

    expect(await screen.findByText(/Another operation is running/)).toBeTruthy()
    expect(startRun).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Remove micro-segmentation?' })).toBeTruthy()
  })

  it('cancels without removing', async () => {
    open()
    askRemoval()
    const dialog = await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove micro-segmentation?' })).toBeNull())
    expect(calls('POST /remove')).toHaveLength(0)
  })
})

describe('removal from one cluster of a shared policy', () => {
  const NAMES: Record<string, string> = { c1: 'PVE-PROD', c2: 'PVE-DR' }
  const linked = (connection_id: string) => ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })
  const clusterName = (id: string) => NAMES[id] ?? id
  const openShared = (clusters = [linked('c1'), linked('c2'), linked('c3')]) => open({}, { policy: { ...policy(), clusters }, clusterName })
  const dialog = () => screen.getByRole('dialog', { name: 'Remove micro-segmentation?' })

  it('removes the rules from the cluster chosen, typed by its name, through that cluster, and says it leaves the shared policy', async () => {
    mock.routes['POST /api/v1/firewall/microseg/c2/remove'] = () => reply(202, { run_id: 'run-dr' })
    const { startRun } = openShared()
    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }))
    await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    // The tab's cluster first; a cluster the user cannot see is not offered.
    expect(within(dialog()).getByRole('combobox', { name: 'Cluster or node' }).textContent).toBe('PVE-PROD')
    fireEvent.mouseDown(within(dialog()).getByRole('combobox', { name: 'Cluster or node' }))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)).toEqual(['PVE-DR', 'PVE-PROD'])
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'PVE-DR' }))
    expect(within(dialog()).getByText('PVE-DR leaves the shared policy and keeps none of it; the zone tags stay on its guests.')).toBeTruthy()
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Type PVE-DR to confirm' }), { target: { value: 'PVE-DR' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(calls('POST /remove')).toHaveLength(0)
    expect(startRun.mock.calls[0][0]).toMatchObject({ kind: 'remove', label: 'PVE-DR', runs: [{ connection_id: 'c2', run_id: 'run-dr' }] })
    expect(dialog().textContent).not.toContain('re-associ')
  })

  it('keeps the wording of a policy of one cluster', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }))
    await screen.findByRole('dialog', { name: 'Remove micro-segmentation?' })
    expect(within(dialog()).queryByRole('combobox', { name: 'Cluster' })).toBeNull()
    expect(within(dialog()).queryByText(/leaves the shared policy/)).toBeNull()
    expect(within(dialog()).getByText('The zone tags stay on the guests, and the draft is kept.')).toBeTruthy()
  })
})

describe('removal rights on a shared policy', () => {
  const linked = (connection_id: string) => ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })
  /** node.manage on c1 alone: the removal goes through every cluster of the policy (the relay checks each). */
  const managerOfC1: RBACContextValue = {
    permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading: false,
    hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true,
    hasPermissionOn: (permission: string, type: string, id: string) => permission === 'node.manage' && type === 'connection' && id === 'c1',
    refresh: () => undefined,
  }
  const render = (clusters: ReturnType<typeof linked>[]) => {
    const handlers = { reloadPolicy: vi.fn(async () => undefined), startRun: vi.fn(), onClose: vi.fn() }
    renderWithProviders(
      <RBACContext.Provider value={managerOfC1}>
        <SettingsDialog connectionId='c1' connectionName='prod-cluster' policy={{ ...policy(), clusters }} {...handlers} />
      </RBACContext.Provider>,
    )
  }
  const removeButton = () => screen.getByRole('button', { name: 'Remove…' }) as HTMLButtonElement

  it('does not offer the removal to a user who may not manage every cluster of the policy, and says why', () => {
    render([linked('c1'), linked('c2')])
    expect(removeButton().disabled).toBe(true)
    expect(screen.getByLabelText('You need node management rights on every cluster of this policy')).toBeTruthy()
  })

  it('offers it on a policy of one cluster with the right on that cluster', () => {
    render([linked('c1')])
    expect(removeButton().disabled).toBe(false)
  })
})

describe('associated clusters', () => {
  const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }, { id: 'c3', name: 'LAB' }]
  const linked = (connection_id: string, active = true) =>
    ({ connection_id, active, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })

  function openShared(clusters = [linked('c1')]) {
    const onClustersChanged = vi.fn()
    const onDissociated = vi.fn()
    const clusterName = (id: string) => CONNECTIONS.find(c => c.id === id)?.name ?? id
    const handlers = open({}, { policy: { ...policy(), clusters }, connections: CONNECTIONS, clusterName, maxClusters: 8, onClustersChanged, onDissociated })
    return { ...handlers, onClustersChanged, onDissociated }
  }

  it('shows the clusters of the policy, by name, in the General section', () => {
    openShared([linked('c1'), linked('c2', false)])
    expect(screen.getByText('Associated clusters')).toBeTruthy()
    expect(screen.getByText('PVE-PROD')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'applies at the next application' })).toBeTruthy()
  })

  it('associates a cluster, then reads the group and the draft again', async () => {
    mock.routes['POST /clusters'] = () => reply(201, { clusters: [linked('c1'), linked('c3', false)], max: 8 })
    const { reloadPolicy, onClustersChanged } = openShared()
    fireEvent.click(screen.getByRole('button', { name: 'Add a cluster' }))
    const options = within(screen.getByRole('group', { name: 'Clusters or nodes' })).getAllByRole('checkbox').map(o => o.getAttribute('aria-label')).filter(Boolean)
    expect(options).toEqual(['LAB', 'PVE-DR'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'LAB' }))
    fireEvent.click(screen.getByRole('button', { name: 'Associate' }))
    await waitFor(() => expect(onClustersChanged).toHaveBeenCalledTimes(1))
    expect(reloadPolicy).toHaveBeenCalled()
    expect(calls('POST /clusters')).toHaveLength(1)
  })

  it('proposes no connection that already shares another policy, and names clusters with the tab lookup', () => {
    open({}, { policy: { ...policy(), clusters: [linked('c1')] }, connections: CONNECTIONS, groupedElsewhere: ['c2'], clusterName: id => `name-${id}` })
    expect(screen.getByText('name-c1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a cluster' }))
    expect(within(screen.getByRole('group', { name: 'Clusters or nodes' })).getAllByRole('checkbox').map(o => o.getAttribute('aria-label')).filter(Boolean)).toEqual(['LAB'])
  })

  it('dissociates a cluster after its name is typed, then reads the group and the draft again', async () => {
    mock.routes['DELETE /clusters/c2'] = () => reply(200, { clusters: [linked('c1')], max: 8 })
    const { reloadPolicy, onClustersChanged, onDissociated } = openShared([linked('c1'), linked('c2')])
    fireEvent.click(screen.getByTestId('associated-clusters').querySelector('.MuiChip-root') as HTMLElement)
    fireEvent.click(screen.getByLabelText('Dissociate PVE-DR'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Type PVE-DR to confirm' }), { target: { value: 'PVE-DR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dissociate' }))
    await waitFor(() => expect(onClustersChanged).toHaveBeenCalledTimes(1))
    // The page is told who left and who remains, to leave the selection on a cluster of the group.
    expect(onDissociated).toHaveBeenCalledWith('c2', ['c1'])
    expect(reloadPolicy).toHaveBeenCalled()
    expect(calls('DELETE /clusters/c2')).toHaveLength(1)
  })

  it('names a cluster the user cannot see in general words, never by its ID, and offers no dissociation of it', () => {
    openShared([linked('c1'), linked('c9'), linked('c2')])
    const dialog = screen.getByRole('dialog', { name: 'Micro-segmentation settings' })
    expect(within(dialog).getByTestId('associated-clusters').innerHTML).not.toMatch(/\bc9\b/)
    // The list a chip opens names it in general words, without a remove icon.
    fireEvent.click(within(dialog).getByTestId('associated-clusters').querySelector('.MuiChip-root') as HTMLElement)
    const rows = screen.getAllByTestId('associated-cluster-row')
    expect(rows.map(r => r.textContent)).toEqual(['PVE-PROD', 'Another cluster', 'PVE-DR'])
    for (const row of rows) expect(row.innerHTML).not.toMatch(/\bc9\b/)
    expect(screen.queryAllByLabelText(/^Dissociate/).map(e => e.getAttribute('aria-label'))).toEqual(['Dissociate PVE-PROD', 'Dissociate PVE-DR'])
  })

  describe('impact of a dissociation', () => {
    const tagged = (vmid: number) => ({ vmid: String(vmid), name: `vm${vmid}`, node: 'pve1', type: 'qemu', status: 'running', tags: ['zone-web'] })
    const guestReads = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/vms?'))

    function openWithGuests(c2: unknown[] | number) {
      mock.routes['GET /api/v1/vms?connId=c1'] = () => reply(200, { data: { vms: [tagged(100), tagged(101)] } })
      mock.routes['GET /api/v1/vms?connId=c2'] = () => (typeof c2 === 'number' ? reply(c2, { error: 'down' }) : reply(200, { data: { vms: c2 } }))
      const clusterName = (id: string) => CONNECTIONS.find(c => c.id === id)?.name ?? id
      const shared = { ...policy({ zones: [zone('web')] }), clusters: [linked('c1'), linked('c2')] }
      // The guest reads run on mount (the test providers turn that off by default).
      renderWithProviders(
        <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0 }}>
          <SettingsDialog
            connectionId='c1' connectionName='PVE-PROD' policy={shared} reloadPolicy={vi.fn(async () => undefined)} startRun={vi.fn()} onClose={vi.fn()}
            connections={CONNECTIONS} clusterName={clusterName} maxClusters={8}
          />
        </SWRConfig>,
      )
    }

    it('reads the guests of every cluster only once the dissociation is asked, and counts each side', async () => {
      openWithGuests([tagged(100)])
      expect(guestReads()).toHaveLength(0)
      fireEvent.click(screen.getByTestId('associated-clusters').querySelector('.MuiChip-root') as HTMLElement)
    fireEvent.click(screen.getByLabelText('Dissociate PVE-DR'))
      expect(await screen.findByText('1 guest of PVE-DR will no longer be recognised by the other clusters, 2 guests the other way.')).toBeTruthy()
      expect(guestReads().map(([url]) => url).sort()).toEqual(['/api/v1/vms?connId=c1', '/api/v1/vms?connId=c2'])
    })

    it('shows no count when the guests of one cluster could not be read', async () => {
      openWithGuests(500)
      fireEvent.click(screen.getByTestId('associated-clusters').querySelector('.MuiChip-root') as HTMLElement)
    fireEvent.click(screen.getByLabelText('Dissociate PVE-DR'))
      expect(await screen.findByText('PVE-DR keeps its rules, with its own copy of the policy.')).toBeTruthy()
      await waitFor(() => expect(guestReads()).toHaveLength(2))
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(screen.queryByText(/will no longer be recognised/)).toBeNull()
    })
  })
})

describe('the IP filter of the zone members', () => {
  function openWith(ipFilter: boolean | undefined) {
    const base = policy()
    const current = { ...base, policy: { ...base.policy, settings: SETTINGS, ...(ipFilter === undefined ? {} : { ip_filter: ipFilter }) } }
    const handlers = { reloadPolicy: vi.fn(async () => undefined), startRun: vi.fn(), onClose: vi.fn() }
    renderWithProviders(<SettingsDialog connectionId='c1' connectionName='prod-cluster' policy={current} {...handlers} />)
    return handlers
  }
  const toggle = () => screen.getByRole('switch', { name: 'IP filter on zone members' }) as HTMLInputElement

  it('has no row on an orchestrator that does not know it', () => {
    openWith(undefined)
    expect(screen.queryByRole('switch', { name: 'IP filter on zone members' })).toBeNull()
    expect(screen.queryByText('IP filter on zone members')).toBeNull()
  })

  it('shows the switch as the policy holds it, under Enforcement, with its explanation behind the info icon', () => {
    openWith(true)
    expect(toggle().checked).toBe(true)
    expect(save().disabled).toBe(true)
    const sectionOf = toggle().closest('[data-testid="settings-section"]') ?? toggle().closest('div.MuiBox-root')
    expect(sectionOf).toBeTruthy()
    expect(screen.getByText('IP filter on zone members')).toBeTruthy()
  })

  it('saves the switch alone with the draft version, through the existing Save', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4 })
    const { onClose, reloadPolicy } = openWith(false)
    expect(toggle().checked).toBe(false)
    fireEvent.click(toggle())
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    await waitFor(() => expect(put()).toHaveLength(1))
    expect(body(put()[0][1] as RequestInit)).toEqual({ version: 3, ip_filter: true })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(reloadPolicy).toHaveBeenCalled()
  })

  it('sends nothing for a switch moved and put back', () => {
    openWith(true)
    fireEvent.click(toggle())
    fireEvent.click(toggle())
    expect(save().disabled).toBe(true)
  })
})
