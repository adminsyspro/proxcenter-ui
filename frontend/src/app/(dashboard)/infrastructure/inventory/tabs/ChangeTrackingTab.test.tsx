/**
 * The Changes tab of a guest, node or cluster: a skeleton while loading, the
 * empty state without a change, otherwise the journal narrowed to that
 * resource, without the resource column inside a single guest.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

const { changesMock } = vi.hoisted(() => ({ changesMock: vi.fn() }))

vi.mock('@/hooks/useChanges', () => ({ useChanges: (...args: unknown[]) => changesMock(...args) }))
vi.mock('@/hooks/useGuestStatus', () => ({ useGuestStatus: () => ({}) }))
vi.mock('@/components/skeletons', () => ({ CardsSkeleton: () => <div>loading</div> }))

import ChangeTrackingTab from './ChangeTrackingTab'

const ROW = {
  id: 1, timestamp: new Date().toISOString(), connectionId: 'c1', connectionName: 'PVE', node: 'pve1',
  resourceType: 'vm', resourceId: '100', resourceName: 'web', action: 'config_changed', user: 'system',
  fields: [{ field: 'tags', oldValue: '', newValue: 'prod' }]
}

describe('ChangeTrackingTab', () => {
  afterEach(() => {
    cleanup()
    changesMock.mockReset()
  })

  it('shows a skeleton while loading', () => {
    changesMock.mockReturnValue({ data: undefined, isLoading: true })
    renderWithProviders(<ChangeTrackingTab connectionId='c1' resourceType='vm' resourceId='100' />)
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('shows the empty state without a change', () => {
    changesMock.mockReturnValue({ data: { data: [] }, isLoading: false })
    renderWithProviders(<ChangeTrackingTab connectionId='c1' />)
    expect(screen.getByText('No changes detected')).toBeInTheDocument()
  })

  it('narrows the journal to the guest and drops the resource column', () => {
    changesMock.mockReturnValue({ data: { data: [ROW] }, isLoading: false })
    renderWithProviders(<ChangeTrackingTab connectionId='c1' resourceType='vm' resourceId='100' />)

    expect(changesMock).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'c1', resourceType: 'vm', resourceId: '100' }))
    expect(screen.getByText('prod')).toBeInTheDocument()
    expect(screen.queryByText('Resource')).not.toBeInTheDocument()
  })

  it('keeps the resource column on a node or a cluster', () => {
    changesMock.mockReturnValue({ data: { data: [ROW] }, isLoading: false })
    renderWithProviders(<ChangeTrackingTab connectionId='c1' node='pve1' />)
    expect(screen.getByText('Resource')).toBeInTheDocument()
  })
})
