/**
 * A user without node.manage on the connection reads the Security Groups, Aliases and IP Sets tabs but
 * every write control is disabled, with the read-only reason as its tooltip; with the right everything is enabled.
 * The page hands the write access down (MicrosegWriteContext, set from useCanManageMicroseg, as the
 * Micro-segmentation tab does); each panel is rendered here under both values. The Firewalling tab has its own
 * read-only test in FirewallingView.test.tsx.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import type { ReactElement } from 'react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

vi.mock('@/lib/api/firewall', () => ({}))
vi.mock('@/lib/microseg/useMicroseg', () => ({ useMicrosegPolicy: () => ({ data: undefined }) }))
vi.mock('@/lib/microseg/useLastRevision', () => ({ useLastRevisionSnapshot: () => ({ revision: null, loading: false }) }))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import { MicrosegWriteContext } from '../microseg/microsegAccess'
import ObjectsTab from '../ObjectsTab'
import SecurityGroupsPanel from './SecurityGroupsPanel'

afterEach(cleanup)

const READ_ONLY = 'Read-only: you need node management rights'
const CONN = 'c1'
const RULE: firewallAPIType.FirewallRule = { pos: 0, type: 'in', action: 'ACCEPT', enable: 1, proto: 'tcp', dport: '22' }
const GUEST: VMFirewallInfo = {
  vmid: 100, name: 'web-01', node: 'pve1', type: 'qemu', status: 'running', firewallEnabled: true, optionsEnabled: true,
  nicFirewallEnabled: true, stateUnknown: false, rules: [RULE], rulesLoaded: true, options: null, vlans: [], tags: [],
}

/** Carries sg-web, so the members dialog lists it with a detach button. */
const MEMBER: VMFirewallInfo = { ...GUEST, rules: [{ pos: 0, type: 'group', action: 'sg-web', enable: 1 }] }

function renderAs(canWrite: boolean, ui: ReactElement) {
  return renderWithProviders(<MicrosegWriteContext.Provider value={canWrite}>{ui}</MicrosegWriteContext.Provider>)
}

const groups = () => (
  <SecurityGroupsPanel
    securityGroups={[{ group: 'sg-web', rules: [RULE] }]} vmFirewallData={[MEMBER]} loadingVMRules={false} guestsNotScanned={0}
    clusterRules={[]} hostRulesByNode={{}} firewallMode='cluster' selectedConnection={CONN} totalRules={1} aliases={[]} ipsets={[]}
    reload={vi.fn()} loadGuestRules={vi.fn().mockResolvedValue([])} reloadVMFirewallRules={vi.fn()}
  />
)

const objects = (view: 'aliases' | 'ipsets') => (
  <ObjectsTab
    aliases={[{ name: 'net-mgmt', cidr: '10.0.0.0/24' }]}
    ipsets={[{ name: 'blocklist', members: [{ cidr: '192.0.2.1' }] }] as firewallAPIType.IPSet[]}
    selectedConnection={CONN} loading={false} reload={vi.fn()} view={view}
  />
)

/** Every control the read-only user must not use is disabled and says why (the tooltip sits on its wrapper). */
async function expectReadOnly(controls: HTMLElement[]) {
  expect(controls.length).toBeGreaterThan(0)
  for (const control of controls) {
    expect(control).toBeDisabled()
    fireEvent.mouseOver(control.parentElement!)
  }
  await waitFor(() => expect(screen.getAllByText(READ_ONLY).length).toBeGreaterThan(0))
}

describe('Security Groups for a read-only user', () => {
  it('disables New policy, Add rule, Delete, the rule controls, attach and detach, with the reason', async () => {
    renderAs(false, groups())
    fireEvent.click(screen.getByText('sg-web'))
    const header = screen.getAllByRole('row').find(r => within(r).queryByText('sg-web'))!
    await expectReadOnly([
      screen.getByRole('button', { name: /New policy/i }),
      within(header).getByRole('button', { name: 'Add rule' }),
      within(header).getByRole('button', { name: 'Delete' }),
      screen.getByRole('button', { name: 'Edit' }),
      screen.getByRole('switch'),
    ])

    // The members stay readable; attaching or detaching is not offered.
    fireEvent.click(within(header).getAllByRole('button', { name: /Members of/i }).at(-1)!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /^Attach/i })).toBeDisabled()
    expect(within(dialog).getByRole('combobox')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: /Detach/i })).toBeDisabled()
  })

  it('leaves them enabled with the right', () => {
    renderAs(true, groups())
    expect(screen.getByRole('button', { name: /New policy/i })).toBeEnabled()
    const header = screen.getAllByRole('row').find(r => within(r).queryByText('sg-web'))!
    expect(within(header).getByRole('button', { name: 'Add rule' })).toBeEnabled()
    expect(within(header).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })
})

describe('Aliases and IP Sets for a read-only user', () => {
  it('disables New, edit and delete of an alias, with the reason', async () => {
    renderAs(false, objects('aliases'))
    await expectReadOnly([
      screen.getByRole('button', { name: /New/ }),
      screen.getByRole('button', { name: 'Edit' }),
      screen.getByRole('button', { name: 'Delete' }),
    ])
  })

  it('disables New, Add, edit and delete of an IP set, and offers no entry delete', async () => {
    renderAs(false, objects('ipsets'))
    expect(within(screen.getByTestId('ipset-entry-blocklist')).queryByTestId('CancelIcon')).toBeNull()
    await expectReadOnly([
      screen.getByRole('button', { name: /New/ }),
      screen.getByRole('button', { name: /^Add$/ }),
      screen.getByRole('button', { name: 'Edit' }),
      screen.getByRole('button', { name: 'Delete' }),
    ])
  })

  it('leaves them enabled with the right', () => {
    renderAs(true, objects('ipsets'))
    expect(screen.getByRole('button', { name: /New/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(within(screen.getByTestId('ipset-entry-blocklist')).getByTestId('CancelIcon')).toBeTruthy()
  })
})
