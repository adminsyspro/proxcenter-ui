/**
 * Tests for the rule row cells shared by the four rules tables.
 *
 * These cover what the four panels used to re-implement identically and what
 * a reader of a rules table relies on: the position and Active switch, the
 * direction chip, source/destination/service (including the "any" and
 * dashed-out forms), the action chip, the log level — a dimmed dash when the
 * rule logs nothing — the comment, and the edit/delete buttons.
 *
 * Two behaviours are asserted per panel-specific prop rather than per panel:
 *   - `enabled` is passed in, because the VM/CT table counts only
 *     `enable === 1` as on while the others count anything but `0`;
 *   - `isGroupRule` turns a rule that references a security group purple and
 *     collapses its traffic columns; the security groups table leaves it off
 *     (PVE forbids nesting groups), which must keep the plain rendering.
 *
 * Dimmed text is asserted against the theme's own `text.disabled`, so the
 * assertion follows the palette instead of hardcoding a colour. No automatic
 * RTL cleanup is configured in this repo, hence afterEach.
 */

import type { ReactNode } from 'react'

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { Table, TableBody, TableRow } from '@mui/material'
import { createTheme } from '@mui/material/styles'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPI from '@/lib/api/firewall'

import {
  RuleActionCell,
  RuleLogCommentCells,
  RuleRowActionsCell,
  RuleRowLeadingCells,
  RuleTrafficCells,
} from './RuleTableCells'

const { text } = createTheme().palette

const RULE: firewallAPI.FirewallRule = { pos: 3, type: 'in', action: 'ACCEPT' }

const rule = (overrides: Partial<firewallAPI.FirewallRule> = {}): firewallAPI.FirewallRule => ({ ...RULE, ...overrides })

/** Cells only render inside a row; keep the table nesting valid. */
function renderRow(cells: ReactNode) {
  return renderWithProviders(<Table><TableBody><TableRow>{cells}</TableRow></TableBody></Table>)
}

const cells = () => screen.getAllByRole('cell')

describe('RuleRowLeadingCells', () => {
  afterEach(cleanup)

  it('renders the drag handle, position, Active switch and direction', () => {
    renderRow(<RuleRowLeadingCells rule={rule()} enabled onToggleEnable={vi.fn()} />)

    expect(cells()).toHaveLength(4)
    expect(cells()[1]).toHaveTextContent('3')
    expect(screen.getByRole('switch')).toBeChecked()
    expect(cells()[3]).toHaveTextContent('IN')
  })

  it('renders the switch off when the caller says the rule is disabled', () => {
    renderRow(<RuleRowLeadingCells rule={rule({ enable: 0 })} enabled={false} onToggleEnable={vi.fn()} />)

    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('reports a toggle of the Active switch to the panel', async () => {
    const onToggleEnable = vi.fn()

    renderRow(<RuleRowLeadingCells rule={rule()} enabled onToggleEnable={onToggleEnable} />)

    await userEvent.click(screen.getByRole('switch'))

    expect(onToggleEnable).toHaveBeenCalledTimes(1)
  })

  it('uppercases the direction and falls back to IN when PVE sent none', () => {
    renderRow(<RuleRowLeadingCells rule={{ pos: 1, type: '', action: 'DROP' }} enabled onToggleEnable={vi.fn()} />)

    expect(cells()[3]).toHaveTextContent('IN')
  })

  it('labels an outbound rule OUT', () => {
    renderRow(<RuleRowLeadingCells rule={rule({ type: 'out' })} enabled onToggleEnable={vi.fn()} />)

    expect(cells()[3]).toHaveTextContent('OUT')
  })

  it('labels a security-group reference GROUP', () => {
    renderRow(<RuleRowLeadingCells rule={rule({ type: 'group', action: 'sg-web' })} isGroupRule enabled onToggleEnable={vi.fn()} />)

    expect(cells()[3]).toHaveTextContent('GROUP')
  })
})

describe('RuleTrafficCells', () => {
  afterEach(cleanup)

  it('shows source and destination as PVE returned them', () => {
    renderRow(<RuleTrafficCells rule={rule({ source: '10.0.0.0/8', dest: '+webservers' })} />)

    expect(cells()[0]).toHaveTextContent('10.0.0.0/8')
    expect(cells()[1]).toHaveTextContent('+webservers')
    expect(cells()[0]).toHaveStyle({ color: text.primary })
  })

  it('reads an empty source or destination as a dimmed "any"', () => {
    renderRow(<RuleTrafficCells rule={rule()} />)

    expect(cells()[0]).toHaveTextContent('any')
    expect(cells()[1]).toHaveTextContent('any')
    expect(cells()[0]).toHaveStyle({ color: text.disabled })
    expect(cells()[1]).toHaveStyle({ color: text.disabled })
  })

  it('dashes out the traffic columns of a group rule', () => {
    renderRow(<RuleTrafficCells rule={rule({ type: 'group', action: 'sg-web', source: '10.0.0.1' })} isGroupRule />)

    expect(cells()[0]).toHaveTextContent('-')
    expect(cells()[1]).toHaveTextContent('-')
    expect(cells()[2]).toHaveTextContent('-')
    expect(cells()[0]).toHaveStyle({ color: text.disabled })
  })

  it.each([
    ['the macro when the rule uses one', { macro: 'SSH', proto: 'tcp', dport: '22' }, 'SSH'],
    ['protocol and port together', { proto: 'tcp', dport: '443' }, 'TCP/443'],
    ['the protocol alone', { proto: 'udp' }, 'UDP'],
    ['the port alone', { dport: '8006' }, '8006'],
    ['"any" when the rule matches everything', {}, 'any'],
  ])('renders %s in the Service column', (_label, overrides, expected) => {
    renderRow(<RuleTrafficCells rule={rule(overrides)} />)

    expect(cells()[2]).toHaveTextContent(expected)
  })
})

describe('RuleActionCell', () => {
  afterEach(cleanup)

  it.each(['ACCEPT', 'DROP', 'REJECT'])('renders the %s chip', action => {
    renderRow(<RuleActionCell rule={rule({ action })} />)

    expect(cells()[0]).toHaveTextContent(action)
  })

  it('falls back to ACCEPT when PVE sent no action', () => {
    renderRow(<RuleActionCell rule={{ pos: 1, type: 'in', action: '' }} />)

    expect(cells()[0]).toHaveTextContent('ACCEPT')
  })

  it('renders an unknown action as-is rather than dropping it', () => {
    renderRow(<RuleActionCell rule={rule({ action: 'NFLOG' })} />)

    expect(cells()[0]).toHaveTextContent('NFLOG')
  })

  it('names the referenced security group for a group rule', () => {
    renderRow(<RuleActionCell rule={rule({ type: 'group', action: 'sg-web' })} isGroupRule />)

    expect(cells()[0]).toHaveTextContent('sg-web')
  })
})

describe('RuleLogCommentCells', () => {
  afterEach(cleanup)

  it('shows the level of a rule that logs', () => {
    renderRow(<RuleLogCommentCells rule={rule({ log: 'warning' })} />)

    expect(cells()[0]).toHaveTextContent('warning')
    expect(cells()[0]).toHaveStyle({ color: text.primary })
  })

  it.each([
    ['nolog', 'nolog'],
    ['absent', undefined],
    ['empty', ''],
    ['unrecognised', 'verbose'],
  ])('dims a dash when the log level is %s', (_label, log) => {
    renderRow(<RuleLogCommentCells rule={rule({ log })} />)

    expect(cells()[0]).toHaveTextContent('-')
    expect(cells()[0]).toHaveStyle({ color: text.disabled })
  })

  it('shows the comment, and a dash when there is none', () => {
    renderRow(<RuleLogCommentCells rule={rule({ comment: 'allow monitoring' })} />)
    expect(cells()[1]).toHaveTextContent('allow monitoring')

    cleanup()

    renderRow(<RuleLogCommentCells rule={rule()} />)
    expect(cells()[1]).toHaveTextContent('-')
  })
})

describe('RuleRowActionsCell', () => {
  afterEach(cleanup)

  it('calls the panel back when edit is clicked', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()

    renderRow(<RuleRowActionsCell onEdit={onEdit} onDelete={onDelete} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('calls the panel back when delete is clicked', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()

    renderRow(<RuleRowActionsCell onEdit={onEdit} onDelete={onDelete} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('a full rule row', () => {
  afterEach(cleanup)

  it('fills the eleven columns of the rules tables', () => {
    const r = rule({ source: 'any', dest: '10.0.0.5', proto: 'tcp', dport: '22', log: 'info', comment: 'ssh' })

    renderRow(
      <>
        <RuleRowLeadingCells rule={r} enabled onToggleEnable={vi.fn()} />
        <RuleTrafficCells rule={r} />
        <RuleActionCell rule={r} />
        <RuleLogCommentCells rule={r} />
        <RuleRowActionsCell onEdit={vi.fn()} onDelete={vi.fn()} />
      </>
    )

    // Same count as RulesTableHead renders, which is what the panels' colSpan
    // on their section and empty rows is pinned to.
    expect(cells()).toHaveLength(11)
  })
})
