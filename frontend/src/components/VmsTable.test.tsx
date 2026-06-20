/**
 * Component tests for VmsTable.tsx
 *
 * Strategy: VmsTable receives all data via props (no internal fetch), so tests
 * render it with a hand-written fixture and assert visible output + callbacks.
 * DataGrid rows are queried by cell text or DOM selectors.
 * Context hooks (useTenant, useTagColors) are mocked at the module level.
 *
 * Not covered here:
 *   - recharts trend charts (require real SVG width; showTrends=false for all tests)
 *   - Excel export (dynamic import of exceljs; not practical under jsdom)
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import VmsTable from '@/components/VmsTable'
import { vmRowsFixture } from '@/__tests__/fixtures/vmRows'

// ------------------------------------------------------------------ //
// Context mocks
// ------------------------------------------------------------------ //

// TenantContext: VmsTable reads { loading, isFullClusterView }
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ loading: false, isFullClusterView: true }),
}))

// TagColorContext: VmsTable destructures { getColor, getShape, loadConnection }
vi.mock('@/contexts/TagColorContext', () => ({
  useTagColors: () => ({
    getColor: () => ({ bg: '#1976d2', fg: '#ffffff' }),
    getOverride: () => undefined,
    getShape: () => 'full',
    loadConnection: vi.fn(),
  }),
}))

// ------------------------------------------------------------------ //
// Cleanup after each test to avoid DOM accumulation
// ------------------------------------------------------------------ //
afterEach(() => {
  cleanup()
})

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

function makeCallbacks() {
  return {
    onVmClick: vi.fn(),
    onVmAction: vi.fn(),
    onMigrate: vi.fn(),
    onNodeClick: vi.fn(),
    onToggleFavorite: vi.fn(),
  }
}

// ------------------------------------------------------------------ //
// 1. Basic render
// ------------------------------------------------------------------ //

describe('VmsTable - basic render', () => {
  it('renders all VM names from the fixture', () => {
    renderWithProviders(
      <VmsTable vms={vmRowsFixture} />,
    )
    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('db-lxc')).toBeInTheDocument()
    expect(screen.getByText('ubuntu-template')).toBeInTheDocument()
    expect(screen.getByText('locked-vm')).toBeInTheDocument()
  })

  it('renders without crashing when vms is empty', () => {
    const { container } = renderWithProviders(<VmsTable vms={[]} />)
    expect(container.querySelector('.MuiDataGrid-root')).toBeInTheDocument()
  })

  it('renders without crashing when loading=true', () => {
    const { container } = renderWithProviders(
      <VmsTable vms={[]} loading />,
    )
    expect(container.querySelector('.MuiDataGrid-root')).toBeInTheDocument()
  })

  it('shows node text in rows when showNode is true', () => {
    const { container } = renderWithProviders(
      <VmsTable vms={[vmRowsFixture[0]]} showNode />,
    )
    // node column renders the node name
    const nodeEls = container.querySelectorAll('.node-name')
    expect(nodeEls.length).toBeGreaterThan(0)
    expect(nodeEls[0].textContent).toBe('pve1')
  })

  it('does not show node column when showNode is false', () => {
    const { container } = renderWithProviders(
      <VmsTable vms={[vmRowsFixture[0]]} showNode={false} />,
    )
    // When showNode=false no .node-name elements exist
    expect(container.querySelectorAll('.node-name').length).toBe(0)
  })
})

// ------------------------------------------------------------------ //
// 2. Density toggle
// ------------------------------------------------------------------ //

describe('VmsTable - density toggle', () => {
  it('renders the density toggle "Compact" text when showDensityToggle=true', () => {
    const { container } = renderWithProviders(
      <VmsTable vms={vmRowsFixture} showDensityToggle />,
    )
    // Find the element containing exactly "Compact" in the toolbar
    const allTexts = Array.from(container.querySelectorAll('*')).filter(
      el => el.textContent?.trim() === 'Compact' && el.children.length <= 1,
    )
    expect(allTexts.length).toBeGreaterThan(0)
  })

  it('flips the density label when the toggle box is clicked', () => {
    const { container } = renderWithProviders(
      <VmsTable vms={vmRowsFixture} showDensityToggle />,
    )
    // Find the toggle box: contains ri-list-check icon + "Compact" text
    const toggleIcon = container.querySelector('.ri-list-check')
    expect(toggleIcon).toBeInTheDocument()
    const toggleBox = toggleIcon!.parentElement!
    fireEvent.click(toggleBox)
    // After click isCompact flips to false -> icon becomes ri-list-check-2
    expect(container.querySelector('.ri-list-check-2')).toBeInTheDocument()
  })

  it('does not render density toggle icon when showDensityToggle=false', () => {
    const { container } = renderWithProviders(
      <VmsTable vms={vmRowsFixture} showDensityToggle={false} />,
    )
    // With showDensityToggle=false neither ri-list-check nor ri-list-check-2 is in the toolbar
    // Note: the toolbar only appears when vms.length > 0
    // The list-check icons are used only in the density toggle
    expect(container.querySelector('.ri-list-check')).not.toBeInTheDocument()
    expect(container.querySelector('.ri-list-check-2')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 3. Row click fires onVmClick
// ------------------------------------------------------------------ //

describe('VmsTable - row click', () => {
  it('fires onVmClick with the correct vm when the name cell is clicked', () => {
    const cbs = makeCallbacks()
    renderWithProviders(
      <VmsTable vms={vmRowsFixture} onVmClick={cbs.onVmClick} />,
    )
    fireEvent.click(screen.getByText('web-01'))
    expect(cbs.onVmClick).toHaveBeenCalledOnce()
    expect(cbs.onVmClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn1:100', name: 'web-01' }),
    )
  })

  it('fires onVmClick for the stopped lxc row when clicked', () => {
    const cbs = makeCallbacks()
    renderWithProviders(
      <VmsTable vms={vmRowsFixture} onVmClick={cbs.onVmClick} />,
    )
    fireEvent.click(screen.getByText('db-lxc'))
    expect(cbs.onVmClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn1:101', name: 'db-lxc' }),
    )
  })
})

// ------------------------------------------------------------------ //
// 4. Action buttons (showActions + onVmAction)
// ------------------------------------------------------------------ //

describe('VmsTable - action buttons', () => {
  it('renders action buttons in the actions column', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        showActions
        onVmAction={cbs.onVmAction}
        onMigrate={cbs.onMigrate}
      />,
    )
    const rowButtons = container.querySelectorAll('.MuiDataGrid-row button')
    expect(rowButtons.length).toBeGreaterThan(0)
  })

  it('Start button is disabled and Shutdown enabled for running vm', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        showActions
        onVmAction={cbs.onVmAction}
        onMigrate={cbs.onMigrate}
      />,
    )
    const rowButtons = container.querySelectorAll<HTMLButtonElement>('.MuiDataGrid-row button')
    // Button order (desktop, matchMedia matches:false): [0]=favorite-star, [1]=Start, [2]=Shutdown,
    //   [3]=Stop, [4]=Pause, [5]=Console, [6]=Migrate, [7]=Details
    // web-01 is 'running': Start (index 1) must be disabled, Shutdown (index 2) must be enabled.
    expect(rowButtons[1].disabled).toBe(true)   // Start: disabled when running
    expect(rowButtons[2].disabled).toBe(false)  // Shutdown: enabled when running
  })

  it('clicking Shutdown on running vm fires onVmAction with "shutdown"', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        showActions
        onVmAction={cbs.onVmAction}
        onMigrate={cbs.onMigrate}
      />,
    )
    const rowButtons = container.querySelectorAll<HTMLButtonElement>('.MuiDataGrid-row button')
    // Button layout in a row: [0]=favorite-star, [1]=Start(disabled/running), [2]=Shutdown(enabled), ...
    // Shutdown is at index 2 (after favorite star and disabled start)
    expect(rowButtons.length).toBeGreaterThan(2)
    // Index 2 is Shutdown for a running vm
    fireEvent.click(rowButtons[2])
    expect(cbs.onVmAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web-01' }),
      'shutdown',
    )
  })

  it('clicking Start on a stopped vm fires onVmAction with "start"', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[1]]}
        showActions
        onVmAction={cbs.onVmAction}
        onMigrate={cbs.onMigrate}
      />,
    )
    const rowButtons = container.querySelectorAll<HTMLButtonElement>('.MuiDataGrid-row button')
    // For a stopped vm: [0]=favorite-star, [1]=Start(enabled), [2]=Shutdown(disabled)...
    // Find the first action button (index 1 after favorite)
    // The favorite button is index 0; Start is index 1
    expect(rowButtons.length).toBeGreaterThan(1)
    const startBtn = rowButtons[1]
    expect(startBtn).not.toBeDisabled()
    fireEvent.click(startBtn)
    expect(cbs.onVmAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'db-lxc' }),
      'start',
    )
  })

  it('clicking Details fires onVmAction with "details"', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        showActions
        onVmAction={cbs.onVmAction}
        onMigrate={cbs.onMigrate}
      />,
    )
    const rowButtons = container.querySelectorAll<HTMLButtonElement>('.MuiDataGrid-row button')
    // Details is the last action button in the row
    const lastBtn = rowButtons[rowButtons.length - 1]
    fireEvent.click(lastBtn)
    expect(cbs.onVmAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web-01' }),
      'details',
    )
  })

  it('clicking the Deploy button on a template fires onVmAction with "clone"', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[2]]}
        showActions
        onVmAction={cbs.onVmAction}
        onMigrate={cbs.onMigrate}
      />,
    )
    const rowButtons = container.querySelectorAll<HTMLButtonElement>('.MuiDataGrid-row button')
    // Template row: [0]=favorite-star, [1]=Deploy(Clone), [2]=Migrate
    expect(rowButtons.length).toBeGreaterThan(1)
    fireEvent.click(rowButtons[1])
    expect(cbs.onVmAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ubuntu-template', template: true }),
      'clone',
    )
  })

  it('does not render action buttons in rows when showActions is false', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        showActions={false}
        onVmAction={cbs.onVmAction}
      />,
    )
    // With showActions=false the only row button is the favorite star (no start/stop/migrate).
    const rowButtons = container.querySelectorAll<HTMLButtonElement>('.MuiDataGrid-row button')
    expect(rowButtons.length).toBe(1)  // only the favorite star
    // Clicking the star must not trigger onVmAction (it calls onToggleFavorite instead).
    fireEvent.click(rowButtons[0])
    expect(cbs.onVmAction).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ //
// 5. Favorites
// ------------------------------------------------------------------ //

describe('VmsTable - favorites', () => {
  it('marks a vm as favorite (gold star fill) when its id is in favorites set', () => {
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        favorites={new Set(['conn1:100'])}
        onToggleFavorite={vi.fn()}
      />,
    )
    // The favorite column renders ri-star-fill when the vm is in favorites
    expect(container.querySelector('.ri-star-fill')).toBeInTheDocument()
  })

  it('shows empty star (ri-star-line) when vm is not in favorites', () => {
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        favorites={new Set()}
        onToggleFavorite={vi.fn()}
      />,
    )
    // The header also has ri-star-line; look in the row
    const rowStars = container.querySelectorAll('.MuiDataGrid-row .ri-star-line')
    expect(rowStars.length).toBeGreaterThan(0)
  })

  it('clicking the favorite star button fires onToggleFavorite with the correct vm', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        favorites={new Set()}
        onToggleFavorite={cbs.onToggleFavorite}
      />,
    )
    const starBtn = container.querySelector<HTMLButtonElement>('.MuiDataGrid-row button')
    expect(starBtn).not.toBeNull()
    fireEvent.click(starBtn!)
    expect(cbs.onToggleFavorite).toHaveBeenCalledOnce()
    expect(cbs.onToggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn1:100', name: 'web-01' }),
    )
  })
})

// ------------------------------------------------------------------ //
// 6. Node click
// ------------------------------------------------------------------ //

describe('VmsTable - node click', () => {
  it('fires onNodeClick with connId and node when the node cell box is clicked', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        showNode
        onNodeClick={cbs.onNodeClick}
      />,
    )
    // Click the node cell wrapper box
    const nodeEl = container.querySelector('.node-name')
    expect(nodeEl).not.toBeNull()
    fireEvent.click(nodeEl!)
    expect(cbs.onNodeClick).toHaveBeenCalledWith('conn1', 'pve1')
  })
})

// ------------------------------------------------------------------ //
// 7. Migration state
// ------------------------------------------------------------------ //

describe('VmsTable - migrating vm state', () => {
  it('adds migrating-row class to a vm whose id is in migratingVmIds', () => {
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        migratingVmIds={new Set(['conn1:100'])}
      />,
    )
    expect(container.querySelector('.migrating-row')).toBeInTheDocument()
  })

  it('does not add migrating-row class when migratingVmIds is empty', () => {
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        migratingVmIds={new Set()}
      />,
    )
    expect(container.querySelector('.migrating-row')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 8. Highlighted row
// ------------------------------------------------------------------ //

describe('VmsTable - highlighted row', () => {
  it('adds highlighted-row class to the vm whose id matches highlightedId', () => {
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        highlightedId="conn1:100"
      />,
    )
    expect(container.querySelector('.highlighted-row')).toBeInTheDocument()
  })

  it('does not add highlighted-row when highlightedId does not match', () => {
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        highlightedId="conn1:999"
      />,
    )
    expect(container.querySelector('.highlighted-row')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 9. IP/Snapshot columns visible when showIpSnap=true
// ------------------------------------------------------------------ //

describe('VmsTable - IP and snapshot columns', () => {
  it('renders ip text when showIpSnap=true', () => {
    renderWithProviders(
      <VmsTable vms={[vmRowsFixture[0]]} showIpSnap />,
    )
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument()
  })

  it('does not render ip text when showIpSnap=false', () => {
    renderWithProviders(
      <VmsTable vms={[vmRowsFixture[0]]} showIpSnap={false} />,
    )
    expect(screen.queryByText('192.168.1.10')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 10. Migrate button fires onMigrate
// ------------------------------------------------------------------ //

describe('VmsTable - migrate button', () => {
  it('clicking Migrate fires onMigrate for running vm', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        showActions
        onVmAction={cbs.onVmAction}
        onMigrate={cbs.onMigrate}
      />,
    )
    const rowButtons = container.querySelectorAll<HTMLButtonElement>('.MuiDataGrid-row button')
    // Button layout: [0]=favorite, [1]=Start(disabled), [2]=Shutdown, [3]=Stop, [4]=Pause,
    //                [5]=Console, [6]=Migrate, [7]=Details
    // Migrate is second-to-last (index length-2)
    expect(rowButtons.length).toBeGreaterThan(2)
    const migrateBtn = rowButtons[rowButtons.length - 2]
    fireEvent.click(migrateBtn)
    expect(cbs.onMigrate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web-01' }),
    )
  })
})

// ------------------------------------------------------------------ //
// 11. defaultHiddenColumns
// ------------------------------------------------------------------ //

describe('VmsTable - defaultHiddenColumns', () => {
  it('renders without crashing when defaultHiddenColumns is provided', () => {
    renderWithProviders(
      <VmsTable vms={vmRowsFixture} defaultHiddenColumns={['tags', 'ip']} />,
    )
    expect(screen.getByText('web-01')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 12. showTrends=false (default) does not crash
// ------------------------------------------------------------------ //

describe('VmsTable - trend column absent by default', () => {
  it('renders without showTrends prop without crashing', () => {
    renderWithProviders(<VmsTable vms={vmRowsFixture} />)
    expect(screen.getByText('web-01')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 13. Context menu
// ------------------------------------------------------------------ //

describe('VmsTable - context menu', () => {
  it('opens the internal context menu on contextmenu event on a row', () => {
    const { container } = renderWithProviders(
      <VmsTable
        vms={[vmRowsFixture[0]]}
        onVmAction={vi.fn()}
        onMigrate={vi.fn()}
      />,
    )
    // Capture baseline: 'web-01' appears once in the DataGrid cell before the menu opens.
    const before = screen.getAllByText('web-01').length
    const row = container.querySelector('.MuiDataGrid-row')
    expect(row).not.toBeNull()
    fireEvent.contextMenu(row!)
    // After contextmenu, VmsTable opens an internal MUI Menu whose header renders the
    // vm name (contextMenu?.vm.name). The count must increase because the menu header
    // adds a second occurrence -- proving the menu actually opened, not just the grid cell.
    const after = screen.getAllByText('web-01').length
    expect(after).toBeGreaterThan(before)
  })
})

// ------------------------------------------------------------------ //
// 14. Locked vm indicator
// ------------------------------------------------------------------ //

describe('VmsTable - locked vm', () => {
  it('renders locked vm name without crashing', () => {
    renderWithProviders(
      <VmsTable vms={[vmRowsFixture[3]]} />,
    )
    expect(screen.getByText('locked-vm')).toBeInTheDocument()
  })

  it('shows lock icon on a locked vm row', () => {
    const { container } = renderWithProviders(
      <VmsTable vms={[vmRowsFixture[3]]} />,
    )
    // The name cell renders a lock badge when vm.lock is set
    expect(container.querySelector('.ri-lock-fill')).toBeInTheDocument()
  })
})
