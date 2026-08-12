/**
 * Component tests for FirewallDialogs.tsx — the Log level picker added to the
 * add-rule and edit-rule dialogs.
 *
 * The dialogs are controlled: every field pushes back through a setter prop.
 * A picker wired to a setter that drops the field would still *render*, so
 * these tests drive the real round trip through a small stateful harness —
 * pick a level, and assert both that the control shows it and that the state
 * the parent would submit now carries `log`. That is the defect this PR
 * fixes, so asserting on state rather than on the DOM alone is the point.
 *
 * A group rule is not a filterable rule — it is a reference to a security
 * group — so the edit dialog's group branch must NOT offer a log level. That
 * branch gets its own test.
 *
 * MUI's InputLabel here carries no `id` and the Selects no `labelId`, so a
 * combobox has no accessible name (same limitation noted in
 * CreateLxcDialog.test.tsx). Rather than indexing into getAllByRole, which
 * would silently follow any column reshuffle, the Log level control is found
 * from its own rendered label — the real `firewall.logLevel` string.
 */

import { useEffect, useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'

import FirewallDialogs from './FirewallDialogs'
import type { FirewallRule, SecurityGroup } from './types'

const LOG_LABEL = 'Log level'

const GROUPS: SecurityGroup[] = [
  { group: 'webserver', comment: 'HTTP + HTTPS' },
  { group: 'dbserver' },
]

const AUTOCOMPLETE_OPTIONS = [
  { label: 'web-front', secondary: '10.0.0.0/24' },
  { label: '+blocklist', secondary: '12 entries' },
]

/**
 * The FormControl that owns the Log level Select, located from its label.
 * Returns null when the picker is absent, which the group-branch test needs.
 */
function logLevelControl(): HTMLElement | null {
  const label = screen.queryAllByText(LOG_LABEL).find(el => el.tagName === 'LABEL')

  if (!label?.parentElement) return null

  return within(label.parentElement).getByRole('combobox')
}

const logLevel = () => {
  const control = logLevelControl()

  if (!control) throw new Error('Log level select not rendered')

  return control
}

/** Open the Log level dropdown and pick a level. */
function pickLogLevel(level: string) {
  fireEvent.mouseDown(logLevel())
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: level }))
}

/**
 * The dialog state as the parent component holds it. The harness reports it
 * through a spy after every commit, so a test can assert on the very object
 * the parent would submit.
 */
type Observed = { newRule: Partial<FirewallRule>; editingRule: FirewallRule | null }

type HarnessProps = {
  onState: (state: Observed) => void
  initialNewRule?: Partial<FirewallRule>
  initialEditingRule?: FirewallRule | null
  addRuleOpen?: boolean
  editRuleOpen?: boolean
  addGroupOpen?: boolean
  deleteConfirmOpen?: boolean
  autocompleteOptions?: typeof AUTOCOMPLETE_OPTIONS
  directionLabel?: string
  saving?: boolean
  onAddRule?: () => void
  onUpdateRule?: () => void
  onAddSecurityGroup?: () => void
  onDeleteRule?: () => void
}

/**
 * Holds the dialog state the way VmFirewallTab / the host and cluster panels
 * do, so the setter props exercised here are the real ones.
 */
function Harness({
  onState,
  initialNewRule = { type: 'in', action: 'ACCEPT', enable: 1, log: 'nolog' },
  initialEditingRule = null,
  addRuleOpen = false,
  editRuleOpen = false,
  addGroupOpen = false,
  deleteConfirmOpen = false,
  autocompleteOptions,
  directionLabel,
  saving = false,
  onAddRule = vi.fn(),
  onUpdateRule = vi.fn(),
  onAddSecurityGroup = vi.fn(),
  onDeleteRule = vi.fn(),
}: HarnessProps) {
  const [newRule, setNewRule] = useState<Partial<FirewallRule>>(initialNewRule)
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(initialEditingRule)
  const [selectedGroup, setSelectedGroup] = useState('')

  useEffect(() => {
    onState({ newRule, editingRule })
  }, [onState, newRule, editingRule])

  return (
    <FirewallDialogs
      addRuleOpen={addRuleOpen}
      setAddRuleOpen={vi.fn()}
      newRule={newRule}
      setNewRule={setNewRule}
      saving={saving}
      onAddRule={onAddRule}
      addGroupOpen={addGroupOpen}
      setAddGroupOpen={vi.fn()}
      selectedGroup={selectedGroup}
      setSelectedGroup={setSelectedGroup}
      availableGroups={GROUPS}
      onAddSecurityGroup={onAddSecurityGroup}
      editRuleOpen={editRuleOpen}
      setEditRuleOpen={vi.fn()}
      editingRule={editingRule}
      setEditingRule={setEditingRule}
      onUpdateRule={onUpdateRule}
      deleteConfirmOpen={deleteConfirmOpen}
      setDeleteConfirmOpen={vi.fn()}
      ruleToDelete={deleteConfirmOpen ? 0 : null}
      onDeleteRule={onDeleteRule}
      autocompleteOptions={autocompleteOptions}
      directionLabel={directionLabel}
    />
  )
}

/**
 * Renders the harness and returns a reader for the latest committed state,
 * so assertions read `state().newRule` after an interaction.
 */
function renderHarness(props: Omit<HarnessProps, 'onState'> = {}) {
  const onState = vi.fn<(state: Observed) => void>()

  renderWithProviders(<Harness onState={onState} {...props} />)

  return () => onState.mock.lastCall![0]
}

const RULE: FirewallRule = {
  pos: 3,
  type: 'out',
  action: 'DROP',
  enable: 1,
  source: '10.0.0.5',
  dest: '',
  proto: 'tcp',
  dport: '443',
  log: 'warning',
  comment: 'block egress',
}

describe('FirewallDialogs — add rule dialog', () => {
  afterEach(cleanup)

  it('offers a Log level picker defaulting to nolog', () => {
    renderHarness({ addRuleOpen: true })

    expect(screen.getByText('Add rule')).toBeInTheDocument()
    expect(logLevel()).toHaveTextContent('nolog')
  })

  it('falls back to nolog when the draft rule has no log field yet', () => {
    renderHarness({ addRuleOpen: true, initialNewRule: { type: 'in', action: 'ACCEPT' } })
    expect(logLevel()).toHaveTextContent('nolog')
  })

  it('writes the picked level into the draft rule', () => {
    const state = renderHarness({ addRuleOpen: true })

    pickLogLevel('warning')

    expect(state().newRule.log).toBe('warning')
    expect(logLevel()).toHaveTextContent('warning')
  })

  it('keeps the rest of the draft rule intact when the level changes', () => {
    const state = renderHarness({
      addRuleOpen: true,
      initialNewRule: { type: 'out', action: 'DROP', proto: 'tcp', dport: '22', comment: 'ssh' },
    })

    pickLogLevel('info')

    expect(state().newRule).toEqual({
      type: 'out', action: 'DROP', proto: 'tcp', dport: '22', comment: 'ssh', log: 'info',
    })
  })

  it('renders plain Source/Destination text fields when no autocomplete catalogue is given', () => {
    const state = renderHarness({ addRuleOpen: true })

    const source = screen.getByLabelText('Source')

    fireEvent.change(source, { target: { value: '10.0.0.0/8' } })
    expect(state().newRule.source).toBe('10.0.0.0/8')

    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'web-front' } })
    expect(state().newRule.dest).toBe('web-front')
  })

  it('renders alias/ipset autocompletes when a catalogue is given, and keeps the Log level picker', () => {
    const state = renderHarness({ addRuleOpen: true, autocompleteOptions: AUTOCOMPLETE_OPTIONS })

    const source = screen.getByLabelText('Source')

    fireEvent.change(source, { target: { value: 'web' } })
    expect(state().newRule.source).toBe('web')

    // The option row renders the label and its secondary (CIDR / entry count)
    const option = within(screen.getByRole('listbox')).getByRole('option')

    expect(option).toHaveTextContent('web-front')
    expect(option).toHaveTextContent('10.0.0.0/24')

    expect(logLevel()).toHaveTextContent('nolog')
  })

  it('uses the caller-supplied direction label', () => {
    renderHarness({ addRuleOpen: true, directionLabel: 'Direction' })
    expect(screen.getAllByText('Direction').length).toBeGreaterThan(0)
  })

  it('defaults the direction label to Type', () => {
    renderHarness({ addRuleOpen: true })
    expect(screen.getAllByText('Type').length).toBeGreaterThan(0)
  })

  it('submits through onAddRule and disables the button while saving', () => {
    const onAddRule = vi.fn()

    renderHarness({ addRuleOpen: true, onAddRule })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAddRule).toHaveBeenCalledTimes(1)

    cleanup()
    renderHarness({ addRuleOpen: true, saving: true })
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })
})

describe('FirewallDialogs — edit rule dialog', () => {
  afterEach(cleanup)

  it('shows the rule’s current level', () => {
    renderHarness({ editRuleOpen: true, initialEditingRule: RULE })

    expect(screen.getByText('Edit rule')).toBeInTheDocument()
    expect(logLevel()).toHaveTextContent('warning')
  })

  it('shows nolog for a rule PVE returned without a log field', () => {
    renderHarness({ editRuleOpen: true, initialEditingRule: { ...RULE, log: undefined } })
    expect(logLevel()).toHaveTextContent('nolog')
  })

  it('writes the picked level into the edited rule without losing its position', () => {
    const state = renderHarness({ editRuleOpen: true, initialEditingRule: RULE })

    pickLogLevel('debug')

    expect(state().editingRule).toEqual({ ...RULE, log: 'debug' })
    expect(logLevel()).toHaveTextContent('debug')
  })

  it('submits through onUpdateRule', () => {
    const onUpdateRule = vi.fn()

    renderHarness({ editRuleOpen: true, initialEditingRule: RULE, onUpdateRule })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onUpdateRule).toHaveBeenCalledTimes(1)
  })

  it('does not offer a Log level for a security-group rule', () => {
    renderHarness({
      editRuleOpen: true,
      initialEditingRule: { pos: 0, type: 'group', action: 'webserver', enable: 1 },
    })

    // The group branch shows the group name and an enable switch, nothing else
    expect(screen.getByText('Edit Security Group')).toBeInTheDocument()
    expect(screen.getByDisplayValue('webserver')).toBeDisabled()
    expect(logLevelControl()).toBeNull()
  })

  it('lets a security-group rule be enabled and commented', () => {
    const state = renderHarness({
      editRuleOpen: true,
      initialEditingRule: { pos: 0, type: 'group', action: 'webserver', enable: 1 },
    })

    fireEvent.click(screen.getByRole('switch'))
    expect(state().editingRule?.enable).toBe(0)

    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'front tier' } })
    expect(state().editingRule?.comment).toBe('front tier')
  })
})

describe('FirewallDialogs — group and delete dialogs', () => {
  afterEach(cleanup)

  it('lists the available security groups and confirms the pick', () => {
    renderHarness({ addGroupOpen: true })

    expect(screen.getByText('Add Security Group')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox'))

    const listbox = screen.getByRole('listbox')

    expect(within(listbox).getByText('HTTP + HTTPS')).toBeInTheDocument()

    fireEvent.click(within(listbox).getByRole('option', { name: /webserver/ }))

    expect(screen.getByText(/The Security Group webserver rules will be applied/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).not.toBeDisabled()
  })

  it('keeps Add disabled until a group is selected', () => {
    renderHarness({ addGroupOpen: true })
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('asks for confirmation before deleting a rule', () => {
    const onDeleteRule = vi.fn()

    renderHarness({ deleteConfirmOpen: true, onDeleteRule })

    expect(screen.getByText('Confirm deletion')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDeleteRule).toHaveBeenCalledTimes(1)
  })
})
