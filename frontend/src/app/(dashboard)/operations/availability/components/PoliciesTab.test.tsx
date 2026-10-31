import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import { makePolicy } from './fixtures'
import PoliciesTab from './PoliciesTab'

const { policiesMock, mutate, confirmSpy } = vi.hoisted(() => ({ policiesMock: vi.fn(), mutate: vi.fn(), confirmSpy: vi.fn() }))

vi.mock('../hooks/useSlaLists', () => ({
  usePolicies: (page: number) => policiesMock(page),
  usePolicyDetail: () => ({ data: undefined, error: undefined, isLoading: false }),
  useInventoryOptions: () => ({ options: { connections: [], guests: [], tags: [], pools: [] }, error: undefined, isLoading: false }),
  useMeasuredConnections: () => ({ data: { connectionIds: [] }, error: undefined, isLoading: false }),
}))

vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: () => true }) }))

const fetchMock = vi.fn()

const page = (n: number, total: number, count = 20) => ({
  data: {
    data: Array.from({ length: count }, (_, i) => makePolicy({ id: `p${n}-${i}`, name: `Policy ${n}-${i}` })),
    total,
    page: n,
    pageSize: 20,
    defaultTarget: 99.9,
  },
  error: undefined,
  isLoading: false,
  mutate,
})

beforeEach(() => {
  policiesMock.mockReset().mockImplementation((n: number) => page(n, 45))
  mutate.mockReset().mockResolvedValue(undefined)
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ deleted: true }) })
  confirmSpy.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('confirm', confirmSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PoliciesTab', () => {
  it('pages by 20: 45 policies make 3 pages, and a page change asks for the next one', async () => {
    const user = userEvent.setup()

    renderWithProviders(<PoliciesTab />)

    expect(screen.getAllByText(/^Policy 1-/)).toHaveLength(20)
    expect(screen.getAllByRole('button', { name: /^(go to )?page \d/i })).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: /page 2/i }))

    expect(policiesMock).toHaveBeenLastCalledWith(2)
  })

  it('deletes through the modal, never through confirm, then refreshes the list', async () => {
    const user = userEvent.setup()

    policiesMock.mockImplementation((n: number) => page(n, 1, 1))
    renderWithProviders(<PoliciesTab />)

    await user.click(screen.getByRole('button', { name: 'Delete Policy 1-0' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete the policy Policy 1-0?')
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sla/policies/p1-0', expect.objectContaining({ method: 'DELETE' }))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('shows the empty state and the unreachable orchestrator', () => {
    policiesMock.mockReturnValue({ ...page(1, 0, 0), data: { data: [], total: 0, page: 1, pageSize: 20, defaultTarget: 99.9 } })
    renderWithProviders(<PoliciesTab />)
    expect(screen.getByText('No SLA policy yet')).toBeInTheDocument()

    cleanup()
    policiesMock.mockReturnValue({ data: undefined, error: new Error('API error: 503'), isLoading: false, mutate })
    renderWithProviders(<PoliciesTab />)
    expect(screen.getByRole('alert')).toHaveTextContent('The orchestrator is unreachable')
  })
})
