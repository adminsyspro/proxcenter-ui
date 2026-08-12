/**
 * Component tests for RuleFormDialog.tsx — the rule form shared by the
 * cluster policy table and the security groups panel.
 *
 * The dialog is fully controlled: it never holds the draft rule, it reports
 * every edit through `onRuleChange` with the whole next rule. So the
 * assertions here are on the object handed back, field by field — a field
 * wired to the wrong key, or a handler that drops the rest of the rule,
 * fails here. That is the class of bug this PR fixed for the log level.
 *
 * The two scopes it serves differ in more than a chip: only a cluster rule
 * may reference a security group, so the GROUP type is offered there and
 * withheld from a rule that lives inside a group (PVE forbids nesting).
 *
 * The Selects carry an InputLabel but no `labelId`, so their combobox has no
 * accessible name and is located from the rendered label element — same
 * limitation as LogLevelSelect.test.tsx.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import {
  renderWithProviders,
  screen,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'

import RuleFormDialog, { type RuleFormData } from './RuleFormDialog'

const EMPTY_RULE: RuleFormData = {
  type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '',
  source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '',
}

const ALIASES: firewallAPIType.Alias[] = [{ name: 'net-mgmt', cidr: '10.99.99.0/24' }]
const IPSETS: firewallAPIType.IPSet[] = [{ name: 'trusted', comment: 'jump hosts', members: [{ cidr: '1.2.3.4' }] }]
const GROUPS: firewallAPIType.SecurityGroup[] = [{ group: 'sg-web' }, { group: 'sg-db' }]

function renderDialog(overrides: Partial<React.ComponentProps<typeof RuleFormDialog>> = {}) {
  const onRuleChange = vi.fn()
  const onSubmit = vi.fn()
  const onClose = vi.fn()

  renderWithProviders(
    <RuleFormDialog
      open
      onClose={onClose}
      onSubmit={onSubmit}
      isNew
      scope={{ type: 'cluster' }}
      rule={EMPTY_RULE}
      onRuleChange={onRuleChange}
      securityGroups={GROUPS}
      aliases={ALIASES}
      ipsets={IPSETS}
      {...overrides}
    />,
  )

  return { onRuleChange, onSubmit, onClose }
}

/** A Select found from its rendered label (no labelId on these controls). */
function selectByLabel(label: string) {
  const el = screen.queryAllByText(label).find(n => n.tagName === 'LABEL')

  if (!el?.parentElement) throw new Error(`No Select labelled "${label}"`)

  return within(el.parentElement).getByRole('combobox')
}

/** Open a Select's menu and pick an option by its visible text. */
function pick(label: string, option: string) {
  fireEvent.mouseDown(selectByLabel(label))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

describe('RuleFormDialog', () => {
  afterEach(cleanup)

  it('titles itself for a new cluster rule', () => {
    renderDialog()

    expect(within(screen.getByRole('dialog')).getByText('Add rule')).toBeInTheDocument()
    expect(screen.getByText('Cluster')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('titles itself for an edited rule inside a security group', () => {
    renderDialog({ isNew: false, scope: { type: 'security-group', name: 'sg-web' } })

    expect(within(screen.getByRole('dialog')).getByText('Edit rule')).toBeInTheDocument()
    expect(screen.getByText('SG: sg-web')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('offers the GROUP type only for a cluster rule', () => {
    renderDialog()
    fireEvent.mouseDown(selectByLabel('Type'))
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'GROUP (Security Group)' })).toBeInTheDocument()

    cleanup()

    // PVE forbids nesting groups, so a rule inside one cannot be of type group.
    renderDialog({ scope: { type: 'security-group', name: 'sg-web' } })
    fireEvent.mouseDown(selectByLabel('Type'))
    expect(within(screen.getByRole('listbox')).queryByRole('option', { name: 'GROUP (Security Group)' })).not.toBeInTheDocument()
  })

  it('lists the connection security groups as the action of a group rule', () => {
    renderDialog({ rule: { ...EMPTY_RULE, type: 'group', action: 'sg-web' } })

    expect(selectByLabel('Action')).toHaveTextContent('sg-web')

    fireEvent.mouseDown(selectByLabel('Action'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)).toEqual(['sg-web', 'sg-db'])
  })

  it('hides the traffic fields of a group rule, which carries none', () => {
    renderDialog({ rule: { ...EMPTY_RULE, type: 'group', action: 'sg-web' } })

    expect(screen.queryByLabelText('Source')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Destination')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Dest port')).not.toBeInTheDocument()
    expect(screen.queryAllByText('Log level')).toHaveLength(0)

    // The comment survives: it is what names the reference in the table.
    expect(screen.getByLabelText('Comment')).toBeInTheDocument()
  })

  it('reports the whole rule when the log level changes', () => {
    const { onRuleChange } = renderDialog()

    expect(selectByLabel('Log level')).toHaveTextContent('nolog')

    pick('Log level', 'crit')

    // The rest of the rule must survive the edit, not be replaced by it.
    expect(onRuleChange).toHaveBeenCalledWith({ ...EMPTY_RULE, log: 'crit' })
  })

  it.each([
    ['Dest port', 'dport', '8006'],
    ['Source port', 'sport', '1024:65535'],
    ['Interface', 'iface', 'vmbr0'],
    ['Comment', 'comment', 'from test'],
  ])('reports %s edits under the %s key', (label, field, value) => {
    const { onRuleChange } = renderDialog()

    fireEvent.change(screen.getByLabelText(label), { target: { value } })

    expect(onRuleChange).toHaveBeenCalledWith({ ...EMPTY_RULE, [field]: value })
  })

  it('reports the source and destination picked from the suggestions', async () => {
    const { onRuleChange } = renderDialog()

    // The aliases come first, then the IPSets in their `+name` PVE form.
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'net' } })
    fireEvent.click(await screen.findByRole('option', { name: /net-mgmt/ }))
    expect(onRuleChange).toHaveBeenCalledWith({ ...EMPTY_RULE, source: 'net-mgmt' })

    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: '+tru' } })
    fireEvent.click(await screen.findByRole('option', { name: /\+trusted/ }))
    expect(onRuleChange).toHaveBeenLastCalledWith({ ...EMPTY_RULE, dest: '+trusted' })
  })

  it('reports the type, action, active flag and protocol', () => {
    const { onRuleChange } = renderDialog()

    pick('Type', 'OUT')
    expect(onRuleChange).toHaveBeenLastCalledWith({ ...EMPTY_RULE, type: 'out' })

    pick('Action', 'DROP')
    expect(onRuleChange).toHaveBeenLastCalledWith({ ...EMPTY_RULE, action: 'DROP' })

    // The active flag is a number for PVE, not a boolean.
    pick('Active', 'Inactive')
    expect(onRuleChange).toHaveBeenLastCalledWith({ ...EMPTY_RULE, enable: 0 })

    pick('Protocol', 'UDP')
    expect(onRuleChange).toHaveBeenLastCalledWith({ ...EMPTY_RULE, proto: 'udp' })
  })

  it('renders an incoming rule as its current values', () => {
    renderDialog({
      rule: {
        ...EMPTY_RULE, type: 'out', action: 'REJECT', enable: 0, proto: 'tcp',
        dport: '443', sport: '1024', source: '10.0.0.0/8', dest: '+trusted',
        iface: 'vmbr1', log: 'warning', comment: 'https out',
      },
    })

    expect(selectByLabel('Type')).toHaveTextContent('OUT')
    expect(selectByLabel('Action')).toHaveTextContent('REJECT')
    expect(selectByLabel('Active')).toHaveTextContent('Inactive')
    expect(selectByLabel('Protocol')).toHaveTextContent('TCP')
    expect(selectByLabel('Log level')).toHaveTextContent('warning')
    expect(screen.getByLabelText('Source')).toHaveValue('10.0.0.0/8')
    expect(screen.getByLabelText('Destination')).toHaveValue('+trusted')
    expect(screen.getByLabelText('Dest port')).toHaveValue('443')
    expect(screen.getByLabelText('Source port')).toHaveValue('1024')
    expect(screen.getByLabelText('Interface')).toHaveValue('vmbr1')
    expect(screen.getByLabelText('Comment')).toHaveValue('https out')
  })

  it('hands the submit and cancel back to the panel', () => {
    const { onSubmit, onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while closed', () => {
    renderDialog({ open: false })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
