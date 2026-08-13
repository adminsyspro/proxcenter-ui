/**
 * Tests for the header row shared by the four rules tables (cluster policy,
 * hosts, VMs/CTs and security groups), which each used to carry their own
 * copy of it.
 *
 * The contract asserted here is the column list itself — labels, order, and
 * the count — because the panels pin `colSpan` on their section and empty
 * rows against it: 11 columns normally, 12 for security groups, whose
 * "Applied to" column sits between Service and Action (a capability of the
 * component: no table opts into it today). The log column carries the short
 * label, the full one being reserved for the rule dialogs. Labels come from the
 * real English bundle, so a missing translation key fails the test.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { Table } from '@mui/material'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import RulesTableHead from './RulesTableHead'

/** The nine rule columns, framed by the drag-handle and actions columns. */
const COLUMNS = ['', '#', 'Active', 'Dir', 'Source', 'Destination', 'Service', 'Action', 'Log', 'Comment', '']

const headers = () => screen.getAllByRole('columnheader').map(th => th.textContent)

describe('RulesTableHead', () => {
  afterEach(cleanup)

  it('renders the eleven columns of a rules table, in order', () => {
    renderWithProviders(<Table><RulesTableHead /></Table>)

    expect(headers()).toEqual(COLUMNS)
  })

  it('inserts "Applied to" between Service and Action for security groups', () => {
    renderWithProviders(<Table><RulesTableHead showAppliedTo /></Table>)

    expect(headers()).toEqual([
      '', '#', 'Active', 'Dir', 'Source', 'Destination', 'Service', 'Applied To', 'Action', 'Log', 'Comment', '',
    ])
  })

  it('leaves the drag-handle and actions columns unlabelled', () => {
    renderWithProviders(<Table><RulesTableHead /></Table>)

    const cells = screen.getAllByRole('columnheader')

    expect(cells[0]).toBeEmptyDOMElement()
    expect(cells[cells.length - 1]).toBeEmptyDOMElement()
  })
})
