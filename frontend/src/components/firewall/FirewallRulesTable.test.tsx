/**
 * Component tests for FirewallRulesTable.tsx — the Log level column.
 *
 * The table renders two different column layouts (`variant="vm"` for the
 * guest firewall tab, `variant="node"` for host/cluster), and the Log level
 * cell deliberately sits *outside* that conditional so both layouts stay in
 * step. A column added inside one branch only is exactly the defect this
 * suite is here to catch, so the assertions are positional: they check that
 * the header cell and the body cell land on the same index within each
 * layout, not merely that the text appears somewhere in the table.
 *
 * Log level display is asserted through the four cases PVE can produce:
 * a real level, the explicit `nolog`, no `log` key at all, and a value the
 * UI does not know — the last three all collapsing to a dash.
 *
 * Header labels come from the real English bundle (`firewall.logLevel` =
 * "Log level"), so a missing translation key fails the test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'

import FirewallRulesTable, { type TableVariant } from './FirewallRulesTable'
import type { FirewallRule, SecurityGroup } from './types'

const LOG_HEADER = 'Log level'

/**
 * Index of the Log level cell in each layout. It is the second-to-last
 * column before Comment and the actions cell, and the two layouts do not
 * have the same number of columns before it — which is the whole point.
 */
const LOG_CELL_INDEX: Record<TableVariant, number> = {
  // drag, #, Active, Dir, Source, Dest, Service, Action, [Log level], Comment, actions
  vm: 8,
  // drag, #, Active, Type, Action, Source, Dest, Proto, Port, [Log level], Comment, actions
  node: 9,
}

const RULES: FirewallRule[] = [
  // A rule that genuinely logs
  { pos: 0, type: 'in', action: 'ACCEPT', enable: 1, source: '10.0.0.0/8', dest: '192.168.1.10', proto: 'tcp', dport: '22', log: 'warning', comment: 'ssh' },
  // PVE's explicit "no logging" — noise in a list, so it must read as a dash
  { pos: 1, type: 'out', action: 'DROP', enable: 0, log: 'nolog' },
  // No `log` key at all, the common case for pre-existing rules
  { pos: 2, type: 'in', action: 'REJECT', enable: 1, source: '', dest: '' },
  // A security group reference, plus a level the UI does not know
  { pos: 3, type: 'group', action: 'webserver', enable: 1, log: 'chatty' },
]

const GROUPS: SecurityGroup[] = [{ group: 'webserver' }]

function makeProps(overrides: Partial<React.ComponentProps<typeof FirewallRulesTable>> = {}) {
  return {
    rules: RULES,
    saving: false,
    draggedRule: null,
    dragOverRule: null,
    availableGroups: GROUPS,
    variant: 'vm' as TableVariant,
    onAddRuleOpen: vi.fn(),
    onAddGroupOpen: vi.fn(),
    onToggleRule: vi.fn(),
    onEditRule: vi.fn(),
    onDeleteRule: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    ...overrides,
  }
}

/** [thead row, ...tbody rows] split, so header and body indexes line up. */
function rows() {
  const [head, body] = screen.getAllByRole('rowgroup')

  return {
    headerCells: within(within(head).getByRole('row')).getAllByRole('columnheader'),
    bodyRows: within(body).getAllByRole('row'),
  }
}

const logCells = (variant: TableVariant) =>
  rows().bodyRows.map(row => within(row).getAllByRole('cell')[LOG_CELL_INDEX[variant]])

describe.each<TableVariant>(['vm', 'node'])('FirewallRulesTable (variant=%s) — Log level column', (variant) => {
  afterEach(cleanup)

  it('places the Log level header between the layout columns and Comment', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps({ variant })} />)

    const { headerCells } = rows()

    expect(headerCells[LOG_CELL_INDEX[variant]]).toHaveTextContent(LOG_HEADER)
    expect(headerCells[LOG_CELL_INDEX[variant] + 1]).toHaveTextContent('Comment')

    // Exactly one Log level column, in both layouts
    expect(headerCells.filter(c => c.textContent === LOG_HEADER)).toHaveLength(1)
  })

  it('shows the level for a rule that logs, and a dash for every rule that does not', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps({ variant })} />)

    // Same order as RULES: warning / nolog / no log key / unknown level
    expect(logCells(variant).map(c => c.textContent)).toEqual(['warning', '-', '-', '-'])
  })

  it('keeps the body cells aligned with the header (same column count)', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps({ variant })} />)

    const { headerCells, bodyRows } = rows()

    for (const row of bodyRows) {
      expect(within(row).getAllByRole('cell')).toHaveLength(headerCells.length)
    }
  })
})

describe('FirewallRulesTable — rendering and callbacks', () => {
  afterEach(cleanup)

  it('renders the empty state instead of a table when there are no rules', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps({ rules: [] })} />)

    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByText('Add a Security Group or a direct rule')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the rule count and the evaluation-order hint', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps()} />)

    expect(screen.getByText(String(RULES.length))).toBeInTheDocument()
    expect(screen.getByText(/Rules are evaluated from top to bottom/)).toBeInTheDocument()
  })

  it('disables the Security Group button when no group is available', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps({ availableGroups: [] })} />)
    expect(screen.getByRole('button', { name: 'Security Group' })).toBeDisabled()
  })

  it('renders headerExtra next to the action buttons', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps({ headerExtra: <span>policy widgets</span> })} />)
    expect(screen.getByText('policy widgets')).toBeInTheDocument()
  })

  it('wires the header buttons', () => {
    const props = makeProps()

    renderWithProviders(<FirewallRulesTable {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    fireEvent.click(screen.getByRole('button', { name: 'Security Group' }))

    expect(props.onAddRuleOpen).toHaveBeenCalledTimes(1)
    expect(props.onAddGroupOpen).toHaveBeenCalledTimes(1)
  })

  it('wires the per-row toggle, edit and delete controls', () => {
    const props = makeProps()

    renderWithProviders(<FirewallRulesTable {...props} />)

    const firstRow = rows().bodyRows[0]

    fireEvent.click(within(firstRow).getByRole('switch'))
    expect(props.onToggleRule).toHaveBeenCalledWith(RULES[0])

    const [edit, remove] = within(firstRow).getAllByRole('button')

    fireEvent.click(edit)
    expect(props.onEditRule).toHaveBeenCalledWith(RULES[0])

    fireEvent.click(remove)
    expect(props.onDeleteRule).toHaveBeenCalledWith(RULES[0].pos)
  })

  it('disables the row switches while a save is in flight', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps({ saving: true })} />)

    for (const box of screen.getAllByRole('switch')) expect(box).toBeDisabled()
  })

  it('forwards the drag-and-drop events with the row position', () => {
    const props = makeProps()

    renderWithProviders(<FirewallRulesTable {...props} />)

    const secondRow = rows().bodyRows[1]

    fireEvent.dragStart(secondRow)
    fireEvent.dragOver(secondRow)
    fireEvent.dragLeave(secondRow)
    fireEvent.drop(secondRow)
    fireEvent.dragEnd(secondRow)

    expect(props.onDragStart).toHaveBeenCalledWith(expect.anything(), RULES[1].pos)
    expect(props.onDragOver).toHaveBeenCalledWith(expect.anything(), RULES[1].pos)
    expect(props.onDrop).toHaveBeenCalledWith(expect.anything(), RULES[1].pos)
    expect(props.onDragLeave).toHaveBeenCalledTimes(1)
    expect(props.onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('highlights the dragged and drop-target rows without dropping the Log level cell', () => {
    renderWithProviders(
      <FirewallRulesTable {...makeProps({ draggedRule: 0, dragOverRule: 1 })} />,
    )

    // The drag styling lives on the row; the column layout must be untouched
    expect(logCells('vm').map(c => c.textContent)).toEqual(['warning', '-', '-', '-'])
  })

  it('renders a group rule as a GROUP chip carrying the group name', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps()} />)

    expect(screen.getByText('GROUP')).toBeInTheDocument()
    expect(screen.getByText('webserver')).toBeInTheDocument()
  })

  it('renders a group rule in the node layout with the group name spelled out', () => {
    renderWithProviders(<FirewallRulesTable {...makeProps({ variant: 'node' })} />)

    expect(screen.getByText('GROUP')).toBeInTheDocument()
    expect(screen.getByText('webserver')).toBeInTheDocument()
  })

  it('falls back to Unknown for a group rule with no action', () => {
    const orphan: FirewallRule = { pos: 9, type: 'group', action: '', enable: 1 }

    renderWithProviders(<FirewallRulesTable {...makeProps({ rules: [orphan] })} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })
})
