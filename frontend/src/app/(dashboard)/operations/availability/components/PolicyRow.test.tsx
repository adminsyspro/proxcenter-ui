import type { ReactElement } from 'react'

import { cleanup, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import { makePolicy, makeResult } from './fixtures'
import PolicyRow from './PolicyRow'

const { detailMock } = vi.hoisted(() => ({ detailMock: vi.fn() }))

vi.mock('../hooks/useSlaLists', () => ({ usePolicyDetail: (id: string | null) => detailMock(id) }))

const guest = (vmid: number, name: string | null, type: 'qemu' | 'lxc') => ({
  ...makeResult('', ['up', 'up'], { ref: { connection_id: 'c1', kind: 'guest', vmid } }),
  name,
  type,
})

beforeEach(() => {
  detailMock.mockReset().mockReturnValue({ data: undefined, error: undefined, isLoading: false })
})

afterEach(cleanup)

// A table row renders inside a table body.
const inTable = (ui: ReactElement) => <table><tbody>{ui}</tbody></table>

const renderRow = (policy = makePolicy()) =>
  renderWithProviders(inTable(<PolicyRow policy={policy} canManage onEdit={() => {}} onDelete={() => {}} />))

describe('PolicyRow status', () => {
  it.each([
    ['met', makePolicy({}, 99.95, 601), 'Met'],
    ['at risk at 25% exactly', makePolicy({}, 99.95, 600), 'At risk'],
    ['violated', makePolicy({}, 99.8, 1000), 'Violated'],
    ['not measured', makePolicy({}, null, null), 'Not measured'],
  ])('shows %s', (_label, policy, text) => {
    renderRow(policy)

    expect(screen.getAllByText(text).length).toBeGreaterThan(0)
  })

  it('does not fetch the guests until the chevron is opened', () => {
    renderRow()

    expect(detailMock).toHaveBeenCalledWith(null)
  })
})

describe('PolicyRow guests', () => {
  it('lists the guests with a VM or CT glyph and the fallback name', async () => {
    const user = userEvent.setup()

    detailMock.mockImplementation((id: string | null) => ({
      data: id ? { results: [guest(100, 'web', 'qemu'), guest(101, null, 'lxc'), guest(102, null, 'qemu')] } : undefined,
      error: undefined,
      isLoading: false,
    }))
    renderRow()

    await user.click(screen.getByRole('button', { name: 'Show the guests of Gold' }))

    const detail = screen.getByText('web').closest('td') as HTMLElement

    expect(within(detail).getByText('CT 101')).toBeInTheDocument()
    expect(within(detail).getByText('VM 102')).toBeInTheDocument()
    expect(detail.querySelectorAll('.ri-instance-line')).toHaveLength(1)
    expect(detail.querySelectorAll('.ri-computer-line')).toHaveLength(2)
    expect(detailMock).toHaveBeenLastCalledWith('p1')
  })

  it('hides the edit and delete buttons without the right to manage', () => {
    renderWithProviders(inTable(<PolicyRow policy={makePolicy()} canManage={false} onEdit={() => {}} onDelete={() => {}} />))

    expect(screen.queryByRole('button', { name: 'Edit Gold' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Gold' })).not.toBeInTheDocument()
  })
})

describe('PolicyRow budget and guests under target', () => {
  it('shows the budget used of the allowed one and the guests below target', () => {
    renderRow(makePolicy({ summary: { ...makePolicy().summary, below_target: 2, budget: { allowed_seconds: 7200, used_seconds: 0, remaining_seconds: 7200 } } }))

    expect(screen.getByText('0s of 2h 0m')).toBeInTheDocument()
    expect(screen.getByText('2 guests below target')).toBeInTheDocument()
  })

  it('counts a budget of seconds in seconds, never as 0m', () => {
    renderRow(makePolicy({ summary: { ...makePolicy().summary, budget: { allowed_seconds: 3, used_seconds: 480, remaining_seconds: 0 } } }))

    expect(screen.getByText('8m of 3s')).toBeInTheDocument()
  })

  it('leaves the budget and the guests below target out when nothing is measured', () => {
    renderRow(makePolicy({}, null, null))

    expect(screen.queryByText(/ of /)).not.toBeInTheDocument()
    expect(screen.queryByText(/below target/)).not.toBeInTheDocument()
  })

  it('shows no guest below target when there is none', () => {
    renderRow(makePolicy({ summary: { ...makePolicy().summary, budget: null } }))

    expect(screen.queryByText(/ of /)).not.toBeInTheDocument()
    expect(screen.queryByText(/below target/)).not.toBeInTheDocument()
  })

  it('shows the target with its decimals and the scope it selects', () => {
    renderRow(makePolicy({ target: 99.999 }))

    expect(screen.getByText('99.999%')).toBeInTheDocument()
    expect(screen.getByText('prod')).toBeInTheDocument()
    // The ticked guests in the scope column, the guests the policy resolves to in the last one.
    expect(screen.getAllByText('1 guest')).toHaveLength(2)
  })
})
