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
