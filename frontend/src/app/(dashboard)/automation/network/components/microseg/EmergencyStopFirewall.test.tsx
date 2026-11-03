/**
 * The Emergency stop turns the Proxmox cluster firewall off: what the stop dialog says, what the resume dialog says
 * and does when the management rules are missing, and how the banner shows the state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, renderTab, reply, resetMocks, status } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'

// A portal, like the real MUI dialog.
vi.mock('../DeploymentWizard', async () => {
  const { createPortal } = await import('react-dom')
  return {
    default: (props: { open: boolean }) => props.open
      ? createPortal(<div role='dialog' aria-label='Deployment wizard' />, document.body)
      : null,
  }
})

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const FIREWALL = { clusterOptions: null, clusterRules: [], nodesList: ['pve1'], firewallMode: 'cluster' as const, onComplete: vi.fn() }
const engine = (clusterFirewall?: 'enabled' | 'disabled' | 'unknown') => ({
  paused_until: null, held: false, last_runs: {}, last_log: null, ...(clusterFirewall ? { cluster_firewall: clusterFirewall } : {}),
})
const renderConfigured = () => renderTab(<MicrosegTab connectionId='c1' connectionName='prod' firewall={FIREWALL} />)

describe('the stop dialog', () => {
  it('says on one line each that it disables the cluster firewall, what stops being evaluated, what stays and when to use it', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    const dialog = await screen.findByRole('dialog')

    for (const text of [
      'Disables the Proxmox cluster firewall with a single request: immediate on every node',
      'Every firewall rule stops being evaluated, including the ones ProxCenter does not manage (management rules, host and guest rules)',
      'The micro-segmentation objects stay in place; Resume re-enables the cluster firewall and re-applies the policy',
      'Use it when the segmentation blocks something it should not',
    ]) {
      const line = within(dialog).getByText(text)
      expect(line.className).toContain('MuiTypography-noWrap')
      expect(line.previousElementSibling?.tagName).toBe('I')
    }
    expect(calls('POST /emergency-stop')).toHaveLength(0)
  })

  it('still asks the same confirmation: nothing is sent before the button', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: true })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
  })
})

describe('the resume dialog', () => {
  beforeEach(() => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine('disabled') }))
  })

  it('says it re-enables the cluster firewall then re-applies the last revision, and when it is refused', async () => {
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Re-enables the cluster firewall, then re-applies the last revision')).toBeTruthy()
    expect(within(dialog).getByText('Refused if the management rules (SSH 22, web 8006) are missing: fix them in the Dashboard deployment wizard first')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
  })

  it('keeps the dialog open on a SOCLE_MISSING refusal, with the message, the server wording and a way to the wizard', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'SOCLE_MISSING', error: 'cluster firewall not re-enabled: rule SSH 22 missing' })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))

    expect(await within(dialog).findByText(/The management rules \(SSH 22, web 8006\) are missing, so the cluster firewall was not re-enabled/)).toBeTruthy()
    expect(within(dialog).getByText('cluster firewall not re-enabled: rule SSH 22 missing')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(JSON.parse(calls('POST /emergency-stop')[0][1]!.body as string)).toEqual({ on: false })
    // The dialog keeps the refusal: the banner shows no second error.
    expect(document.querySelectorAll('.MuiAlert-standardError')).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('opens the deployment wizard from the refusal and closes the dialog', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'SOCLE_MISSING', error: 'x' })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resume' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open the deployment wizard' }))

    expect(await screen.findByRole('dialog', { name: 'Deployment wizard' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Resume micro-segmentation?' })).toBeNull())
  })

  it('offers no wizard button when the page gives no wizard, but still explains the refusal', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'SOCLE_MISSING', error: 'x' })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))

    expect(await within(dialog).findByText(/so the cluster firewall was not re-enabled/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
  })

  it('clears the refusal when the dialog is asked again', async () => {
    let refuse = true
    mock.routes['POST /emergency-stop'] = () => (refuse ? reply(409, { code: 'SOCLE_MISSING', error: 'x' }) : reply(200, { accepted: true, applied_by: 'self', on: false }))
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))
    await within(dialog).findByText(/so the cluster firewall was not re-enabled/)

    refuse = false
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    const again = await screen.findByRole('dialog')
    expect(within(again).queryByText(/so the cluster firewall was not re-enabled/)).toBeNull()
    fireEvent.click(within(again).getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(2))
  })

  it('sends other refusals to the banner and closes the dialog, as before', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(403, { code: 'FORBIDDEN', error: 'no' })
    renderConfigured()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resume' }))

    expect(await screen.findByText('You do not have permission to do this.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('the banner', () => {
  it.each([
    ['disabled', true],
    ['enabled', false],
    ['unknown', false],
    [undefined, false],
  ] as const)('with the stop on and the cluster firewall %s, the "Cluster firewall disabled" mark is %s', async (state, shown) => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: engine(state) }))
    renderTab()
    const alert = (await screen.findByText('Emergency stop active: every zone is in observation')).closest('[role="alert"]') as HTMLElement
    expect(within(alert).queryByText('Cluster firewall disabled') !== null).toBe(shown)
  })

  it('shows no mark while the stop is off, whatever the cluster firewall', async () => {
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: false, engine: engine('disabled') }))
    renderTab()
    await screen.findByRole('button', { name: 'Emergency stop' })
    await waitFor(() => expect(calls('GET /status').length).toBeGreaterThan(0))
    expect(screen.queryByText('Cluster firewall disabled')).toBeNull()
  })
})
