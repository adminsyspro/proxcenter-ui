/**
 * Settings of the Micro-segmentation tab: bounds, the log rate limit form, the
 * self IPs, the changed fields only, the errors of the write, and the removal
 * that needs the connection name typed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, renderWithProviders, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegSettings } from '@/lib/microseg/types'

import { calls, mock, policy, reply, resetMocks } from './microsegTestKit'
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

function open(settings: Partial<MicrosegSettings> = {}, props: Partial<Parameters<typeof SettingsDialog>[0]> = {}) {
  const base = policy()
  const current = { ...base, policy: { ...base.policy, settings: { ...SETTINGS, ...settings } } }
  const handlers = { reloadPolicy: vi.fn(async () => undefined), startRun: vi.fn(), onClose: vi.fn() }
  renderWithProviders(<SettingsDialog connectionId='c1' connectionName='prod-cluster' policy={current} {...handlers} {...props} />)
  return handlers
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
const put = () => calls('PUT /policy')

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
    ['ready after', 'Observation before enforcing', '169', 1, 168, 'hours'],
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
    type('ProxCenter addresses', '10.0.0.5, 10.0.0.999')
    expect(screen.getByText('10.0.0.999 is not a valid IP address.')).toBeTruthy()
    expect(save().disabled).toBe(true)
  })

  it('refuses more than 16', () => {
    open()
    type('ProxCenter addresses', Array.from({ length: 17 }, (_, i) => `10.0.0.${i + 1}`).join(' '))
    expect(screen.getByText('At most 16 addresses.')).toBeTruthy()
    expect(save().disabled).toBe(true)
  })

  it('sends the list, and an empty list when they are cleared', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    open({ self_ips: ['10.0.0.5'] })
    expect(field('ProxCenter addresses').value).toBe('10.0.0.5')
    type('ProxCenter addresses', '10.0.0.5, fd00::1')
    fireEvent.click(save())
    await waitFor(() => expect(put()).toHaveLength(1))
    expect(body(put()[0][1]).settings).toEqual({ self_ips: ['10.0.0.5', 'fd00::1'] })
  })

  it('clears them with an empty list', async () => {
    mock.routes['PUT /policy'] = () => reply(200, { version: 4, policy: policy().policy })
    open({ self_ips: ['10.0.0.5'] })
    type('ProxCenter addresses', '')
    fireEvent.click(save())
    await waitFor(() => expect(put()).toHaveLength(1))
    expect(body(put()[0][1]).settings).toEqual({ self_ips: [] })
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
