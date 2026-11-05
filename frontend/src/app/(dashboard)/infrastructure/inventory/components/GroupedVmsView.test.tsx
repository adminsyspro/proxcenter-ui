import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import GroupedVmsView from './GroupedVmsView'

afterEach(() => {
  cleanup()
})

const render = (groups: any[]) =>
  renderWithProviders(
    <GroupedVmsView title="By pool" icon="ri-folder-line" groups={groups} allVms={[]} onVmAction={vi.fn()} onLoadTrendsBatch={vi.fn().mockResolvedValue({})} />
  )

describe('GroupedVmsView group header', () => {
  it("shows a group's description right after its label", () => {
    render([{ key: 'team', label: 'team', description: 'Dev team pool', vms: [] }])

    const label = screen.getByText('team')

    expect(label.nextElementSibling).toHaveTextContent('Dev team pool')
  })

  it('renders no description element when the group has none', () => {
    render([{ key: 'team', label: 'team', sublabel: 'PVE-PROD', vms: [] }])

    expect(screen.getByText('team').nextElementSibling).toHaveTextContent('PVE-PROD')
  })
})

describe('GroupedVmsView actions (roadmap#200)', () => {
  it('shows the header action and a row action that does not toggle the group', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const onCreate = vi.fn()
    const onMembers = vi.fn()

    renderWithProviders(
      <GroupedVmsView
        title="By pool"
        icon="ri-folder-line"
        groups={[{ key: 'team', label: 'team', vms: [] }, { key: 'vdc-x', label: 'vdc-x', vms: [] }]}
        allVms={[]}
        onVmAction={vi.fn()}
        onLoadTrendsBatch={vi.fn().mockResolvedValue({})}
        headerAction={<button onClick={onCreate}>Create pool</button>}
        groupAction={group => (group.key.startsWith('vdc-') ? null : <button onClick={e => { e.stopPropagation(); onMembers(group.key) }}>Members</button>)}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create pool' }))
    expect(onCreate).toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Members' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Members' }))
    expect(onMembers).toHaveBeenCalledWith('team')
  })
})
