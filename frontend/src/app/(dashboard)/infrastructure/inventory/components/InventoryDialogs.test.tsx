/**
 * Component tests for InventoryDialogs.tsx
 *
 * Strategy: build a makeProps() factory covering the full ~80-field
 * InventoryDialogsProps interface with safe defaults (all open-flags false,
 * handlers vi.fn(), nullable state null). Each test flips the one
 * prop/state under test and asserts real rendered output.
 *
 * Dialogs covered:
 *   - nodeActionDialog (reboot + shutdown variants)
 *   - editOptionDialog (text / boolean / select / hotplug / vga)
 *   - createVmDialogOpen / createLxcDialogOpen (embedded static imports)
 *   - createBackupDialogOpen / deleteVmDialogOpen / convertTemplateDialogOpen
 *   - unlockErrorDialog / bulkActionDialog / upgradeDialogOpen
 *   - confirmAction / deleteHaGroupDialog / deleteHaRuleDialog
 *
 * Not covered:
 *   - esxiMigrateVm (driven by internal state + complex cascade)
 *   - bulkMigOpen (internal state driven)
 *   - migrateDialogOpen / cloneDialogOpen (require selection.type === 'vm' + parseVmId)
 *   - haGroupDialog / haRuleDialog (require selection.type === 'cluster')
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import {
  connections,
  nodes,
  pools,
  networkChoices,
  vmStorage,
  vdcs,
  templates,
} from '@/__tests__/fixtures/pveProvisioning'

import InventoryDialogs, { type InventoryDialogsProps } from './InventoryDialogs'

// ------------------------------------------------------------------ //
// Context mocks
// ------------------------------------------------------------------ //

vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({ addTask: vi.fn(), registerOnRestore: vi.fn() }),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ isAdmin: true }),
}))

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: null, loading: false, isFullClusterView: true }),
}))

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

const CONN_ID = connections[0].id  // 'conn-1'
const NODE_NAME = nodes[0].node    // 'pve1'

// ------------------------------------------------------------------ //
// MSW handler seeding
// ------------------------------------------------------------------ //

function seedAllHandlers() {
  server.use(
    http.get('*/api/v1/connections', ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.get('type') === 'pve') {
        return HttpResponse.json({ data: connections })
      }
      return HttpResponse.json({ data: connections })
    }),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes`, () =>
      HttpResponse.json({ data: nodes }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
      HttpResponse.json({ data: 101 }),
    ),
    http.get('*/api/v1/vdcs', () =>
      HttpResponse.json({ data: vdcs }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/pools`, () =>
      HttpResponse.json({ data: pools }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/storage`, () =>
      HttpResponse.json({ data: vmStorage }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/network-choices`, () =>
      HttpResponse.json({ data: networkChoices }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storage/local-vm/content`, () =>
      HttpResponse.json({ data: [] }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storage/local/content`, () =>
      HttpResponse.json({ data: templates }),
    ),
  )
}

// ------------------------------------------------------------------ //
// makeProps factory -- all fields with safe defaults
// ------------------------------------------------------------------ //

function makeProps(overrides: Partial<InventoryDialogsProps> = {}): InventoryDialogsProps {
  return {
    // Core data
    selection: null,
    data: {},
    allVms: [],
    hosts: [],

    // Node action
    nodeActionDialog: null,
    setNodeActionDialog: vi.fn(),
    nodeActionBusy: false,
    setNodeActionBusy: vi.fn(),
    nodeActionStep: null,
    setNodeActionStep: vi.fn(),
    nodeActionMigrateTarget: '',
    setNodeActionMigrateTarget: vi.fn(),
    nodeActionFailedVms: [],
    setNodeActionFailedVms: vi.fn(),
    nodeActionShutdownFailed: false,
    setNodeActionShutdownFailed: vi.fn(),
    nodeActionLocalVms: new Set(),
    nodeActionStorageLoading: false,
    nodeActionShutdownLocal: false,
    setNodeActionShutdownLocal: vi.fn(),

    // Create VM/LXC
    createVmDialogOpen: false,
    setCreateVmDialogOpen: vi.fn(),
    createLxcDialogOpen: false,
    setCreateLxcDialogOpen: vi.fn(),
    effectiveCreateDefaults: {},
    handleVmCreated: vi.fn(),
    handleLxcCreated: vi.fn(),

    // Hardware dialogs
    addDiskDialogOpen: false,
    setAddDiskDialogOpen: vi.fn(),
    addNetworkDialogOpen: false,
    setAddNetworkDialogOpen: vi.fn(),
    editScsiControllerDialogOpen: false,
    setEditScsiControllerDialogOpen: vi.fn(),
    editDiskDialogOpen: false,
    setEditDiskDialogOpen: vi.fn(),
    editNetworkDialogOpen: false,
    setEditNetworkDialogOpen: vi.fn(),
    addOtherHardwareDialogOpen: false,
    setAddOtherHardwareDialogOpen: vi.fn(),
    editOtherHardwareDialogOpen: false,
    setEditOtherHardwareDialogOpen: vi.fn(),
    selectedOtherHardware: null,
    setSelectedOtherHardware: vi.fn(),
    selectedDisk: null,
    setSelectedDisk: vi.fn(),
    editDiskInitialTab: 0,
    setEditDiskInitialTab: vi.fn(),
    selectedNetwork: null,
    setSelectedNetwork: vi.fn(),
    handleSaveDisk: vi.fn(),
    handleSaveNetwork: vi.fn(),
    handleSaveScsiController: vi.fn(),
    handleEditDisk: vi.fn(),
    handleDetachDisk: vi.fn(),
    handleResizeDisk: vi.fn(),
    handleMoveDisk: vi.fn(),
    handleDeleteNetwork: vi.fn(),

    // Migrate/Clone from VM detail
    migrateDialogOpen: false,
    setMigrateDialogOpen: vi.fn(),
    cloneDialogOpen: false,
    setCloneDialogOpen: vi.fn(),
    handleMigrateVm: vi.fn(),
    handleCrossClusterMigrate: vi.fn(),
    handleCloneVm: vi.fn(),
    selectedVmIsCluster: false,

    // Migrate/Clone from table
    tableMigrateVm: null,
    setTableMigrateVm: vi.fn(),
    tableCloneVm: null,
    setTableCloneVm: vi.fn(),
    handleTableMigrateVm: vi.fn(),
    handleTableCrossClusterMigrate: vi.fn(),
    handleTableCloneVm: vi.fn(),

    // Edit option
    editOptionDialog: null,
    setEditOptionDialog: vi.fn(),
    editOptionValue: '',
    setEditOptionValue: vi.fn(),
    editOptionSaving: false,
    handleSaveOption: vi.fn().mockResolvedValue(undefined),

    // HA dialogs
    haGroupDialogOpen: false,
    setHaGroupDialogOpen: vi.fn(),
    editingHaGroup: null,
    setEditingHaGroup: vi.fn(),
    deleteHaGroupDialog: null,
    setDeleteHaGroupDialog: vi.fn(),
    haRuleDialogOpen: false,
    setHaRuleDialogOpen: vi.fn(),
    editingHaRule: null,
    setEditingHaRule: vi.fn(),
    deleteHaRuleDialog: null,
    setDeleteHaRuleDialog: vi.fn(),
    haRuleType: 'node-affinity',
    clusterHaResources: [],
    clusterPveMajorVersion: 8,
    loadClusterHa: vi.fn(),

    // Confirm action
    confirmAction: null,
    setConfirmAction: vi.fn(),
    confirmActionLoading: false,

    // Backup
    createBackupDialogOpen: false,
    setCreateBackupDialogOpen: vi.fn(),
    backupStorage: '',
    setBackupStorage: vi.fn(),
    backupMode: 'snapshot',
    setBackupMode: vi.fn(),
    backupCompress: 'zstd',
    setBackupCompress: vi.fn(),
    backupNote: '',
    setBackupNote: vi.fn(),
    creatingBackup: false,
    setCreatingBackup: vi.fn(),
    backupStorages: [],
    loadBackups: vi.fn(),

    // Delete VM
    deleteVmDialogOpen: false,
    setDeleteVmDialogOpen: vi.fn(),
    deleteVmConfirmText: '',
    setDeleteVmConfirmText: vi.fn(),
    deletingVm: false,
    deleteVmPurge: false,
    setDeleteVmPurge: vi.fn(),
    handleDeleteVm: vi.fn().mockResolvedValue(undefined),

    // Convert to template
    convertTemplateDialogOpen: false,
    setConvertTemplateDialogOpen: vi.fn(),
    convertingTemplate: false,
    handleConvertTemplate: vi.fn().mockResolvedValue(undefined),

    // Unlock error
    unlockErrorDialog: { open: false, error: '' },
    setUnlockErrorDialog: vi.fn(),

    // Bulk action
    bulkActionDialog: { open: false, action: null, node: null, targetNode: '' },
    setBulkActionDialog: vi.fn(),
    executeBulkAction: vi.fn(),

    // ESXi migration
    esxiMigrateVm: null,
    setEsxiMigrateVm: vi.fn(),
    migTargetConn: '',
    setMigTargetConn: vi.fn(),
    migTargetNode: '',
    setMigTargetNode: vi.fn(),
    migTargetStorage: '',
    setMigTargetStorage: vi.fn(),
    migTargetVmid: '',
    setMigTargetVmid: vi.fn(),
    migTargetVmidStatus: 'idle',
    setMigTargetVmidStatus: vi.fn(),
    migNetworkBridge: '',
    setMigNetworkBridge: vi.fn(),
    migVlanTag: '',
    setMigVlanTag: vi.fn(),
    migBridges: [],
    migStartAfter: false,
    setMigStartAfter: vi.fn(),
    migDiskPaths: '',
    setMigDiskPaths: vi.fn(),
    migTempStorage: '',
    setMigTempStorage: vi.fn(),
    migType: 'cold',
    setMigType: vi.fn(),
    migTransferMode: 'auto',
    setMigTransferMode: vi.fn(),
    migPveConnections: [],
    migNodes: [],
    migStorages: [],
    migSshfsAvailable: null,
    vcenterPreflight: null,
    setVcenterPreflight: vi.fn(),
    migStarting: false,
    setMigStarting: vi.fn(),
    migJobId: null,
    setMigJobId: vi.fn(),
    migJob: null,
    setMigJob: vi.fn(),
    migNodeOptions: [],

    // Bulk migration
    bulkMigSelected: new Set(),
    setBulkMigSelected: vi.fn(),
    bulkMigOpen: false,
    setBulkMigOpen: vi.fn(),
    bulkMigStarting: false,
    setBulkMigStarting: vi.fn(),
    bulkMigJobs: [],
    setBulkMigJobs: vi.fn(),
    bulkMigProgressExpanded: false,
    setBulkMigProgressExpanded: vi.fn(),
    bulkMigLogsExpanded: false,
    setBulkMigLogsExpanded: vi.fn(),
    bulkMigLogsFilter: null,
    setBulkMigLogsFilter: vi.fn(),
    bulkMigConfigRef: { current: null } as React.MutableRefObject<any>,
    bulkMigHostInfo: null,

    // Upgrade
    upgradeDialogOpen: false,
    setUpgradeDialogOpen: vi.fn(),

    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

// ------------------------------------------------------------------ //
// Tests
// ------------------------------------------------------------------ //

describe('InventoryDialogs', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  // 1. Baseline smoke test
  it('renders without crashing when all dialogs are closed', () => {
    renderWithProviders(<InventoryDialogs {...makeProps()} />)
    expect(document.body).toBeDefined()
  })

  // 2. nodeActionDialog - reboot
  it('nodeActionDialog reboot: shows reboot title and cancel fires setter', () => {
    const setNodeActionDialog = vi.fn()
    const props = makeProps({
      nodeActionDialog: { action: 'reboot', nodeName: 'pve1' },
      setNodeActionDialog,
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Reboot node')).toBeInTheDocument()
    expect(screen.getByText('pve1')).toBeInTheDocument()

    // Click Cancel button (there may be multiple buttons; pick the Cancel one)
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)
    expect(setNodeActionDialog).toHaveBeenCalledWith(null)
  })

  // 3. nodeActionDialog - shutdown
  it('nodeActionDialog shutdown: shows shutdown title', () => {
    const props = makeProps({
      nodeActionDialog: { action: 'shutdown', nodeName: 'pve2' },
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Shutdown node')).toBeInTheDocument()
    expect(screen.getByText('pve2')).toBeInTheDocument()
  })

  // 4. editOptionDialog - text
  it('editOptionDialog text: renders TextField and typing fires setEditOptionValue', () => {
    const setEditOptionValue = vi.fn()
    const props = makeProps({
      editOptionDialog: { key: 'name', label: 'VM Name', value: 'old', type: 'text' },
      editOptionValue: 'old',
      setEditOptionValue,
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'new-name' } })
    expect(setEditOptionValue).toHaveBeenCalledWith('new-name')
  })

  // 5. editOptionDialog - boolean
  it('editOptionDialog boolean: Switch checked when value=1, toggling fires setEditOptionValue', () => {
    const setEditOptionValue = vi.fn()
    const props = makeProps({
      editOptionDialog: { key: 'onboot', label: 'Start at boot', value: 1, type: 'boolean' },
      editOptionValue: 1,
      setEditOptionValue,
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    // The Switch renders a checkbox input
    const label = screen.getByText('Start at boot')
    const formControlLabel = label.closest('.MuiFormControlLabel-root') as HTMLElement
    expect(formControlLabel).not.toBeNull()
    const switchInput = formControlLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(switchInput).not.toBeNull()
    // With editOptionValue=1, the Switch should be checked
    expect(switchInput.checked).toBe(true)

    // Click to toggle off -> onChange fires setEditOptionValue(0)
    fireEvent.click(switchInput)
    expect(setEditOptionValue).toHaveBeenCalledWith(0)
  })

  // 6. editOptionDialog - select
  it('editOptionDialog select: opening the Select and clicking an option fires setEditOptionValue', () => {
    const setEditOptionValue = vi.fn()
    const props = makeProps({
      editOptionDialog: {
        key: 'ostype',
        label: 'OS Type',
        value: 'l26',
        type: 'select',
        options: [
          { value: 'l26', label: 'Linux 6.x' },
          { value: 'win11', label: 'Windows 11' },
        ],
      },
      editOptionValue: 'l26',
      setEditOptionValue,
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    const combobox = screen.getByRole('combobox')
    fireEvent.mouseDown(combobox)

    const option = screen.getByRole('option', { name: 'Windows 11' })
    fireEvent.click(option)
    expect(setEditOptionValue).toHaveBeenCalledWith('win11')
  })

  // 7. editOptionDialog - hotplug
  it('editOptionDialog hotplug: checkboxes reflect current value; toggling fires setEditOptionValue', () => {
    const setEditOptionValue = vi.fn()
    const props = makeProps({
      editOptionDialog: {
        key: 'hotplug',
        label: 'Hotplug',
        value: 'disk,network',
        type: 'hotplug',
      },
      editOptionValue: 'disk,network',
      setEditOptionValue,
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    // There should be 5 checkboxes: disk, network, usb, memory, cpu
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(5)

    // Disk checkbox (index 0) should be checked; USB (index 2) should not be checked
    const diskLabel = screen.getByText('Disk')
    const diskFormLabel = diskLabel.closest('.MuiFormControlLabel-root') as HTMLElement
    const diskCheckbox = diskFormLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(diskCheckbox.checked).toBe(true)

    const usbLabel = screen.getByText('USB')
    const usbFormLabel = usbLabel.closest('.MuiFormControlLabel-root') as HTMLElement
    const usbCheckbox = usbFormLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(usbCheckbox.checked).toBe(false)

    // Toggle USB on
    fireEvent.click(usbCheckbox)
    expect(setEditOptionValue).toHaveBeenCalled()
    const calledWith = setEditOptionValue.mock.calls[0][0] as string
    expect(calledWith).toContain('usb')
  })

  // 8. editOptionDialog - vga
  it('editOptionDialog vga: VGA select renders with options; changing type fires setEditOptionValue', () => {
    const setEditOptionValue = vi.fn()
    const props = makeProps({
      editOptionDialog: {
        key: 'vga',
        label: 'Display',
        value: 'std',
        type: 'vga',
        options: [
          { value: 'std', label: 'Standard (std)' },
          { value: 'vmware', label: 'VMware (vmware)' },
          { value: 'none', label: 'None' },
        ],
      },
      editOptionValue: 'std',
      setEditOptionValue,
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    // The VGA select: first combobox in the dialog is the VGA type selector
    const comboboxes = screen.getAllByRole('combobox')
    // With value='std' (a MEMORY_CAPABLE type), both the VGA-type Select ([0])
    // and the clipboard Select ([1]) render, so we expect at least 2 comboboxes.
    expect(comboboxes.length).toBeGreaterThanOrEqual(2)
    // Open first combobox (VGA type selector); [1] is the clipboard Select
    fireEvent.mouseDown(comboboxes[0])

    const noneOption = screen.getByRole('option', { name: 'None' })
    fireEvent.click(noneOption)
    // 'none' is not in MEMORY_CAPABLE, so buildValue('none', undefined, '') = 'none'
    expect(setEditOptionValue).toHaveBeenCalledWith('none')
  })

  // 9. createBackupDialog
  it('createBackupDialog: shows Backup title when open', () => {
    const props = makeProps({ createBackupDialogOpen: true })
    renderWithProviders(<InventoryDialogs {...props} />)

    const dialog = screen.getByRole('dialog')
    // The backup dialog heading ("Backup") is an <h2> scoped to this dialog.
    // Asserting via getByRole('heading') confirms the backup dialog opened, not
    // just that the word "Backup" appeared somewhere on the page.
    expect(within(dialog).getByRole('heading', { name: /^backup$/i })).toBeInTheDocument()
    // The "Note (optional)" textarea is unique to the backup dialog; its <label>
    // is linked via for/id so getByRole resolves it as a named textbox.
    expect(within(dialog).getByRole('textbox', { name: 'Note (optional)' })).toBeInTheDocument()
  })

  // 10. deleteVmDialog
  it('deleteVmDialog: shows Delete VM title when open', () => {
    const props = makeProps({ deleteVmDialogOpen: true })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Delete VM')).toBeInTheDocument()
  })

  // 11. convertTemplateDialog
  it('convertTemplateDialog: shows Convert to Template title when open', () => {
    const props = makeProps({ convertTemplateDialogOpen: true })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Convert to Template')).toBeInTheDocument()
  })

  // 12. unlockErrorDialog
  it('unlockErrorDialog: shows error text when open', () => {
    const props = makeProps({
      unlockErrorDialog: { open: true, error: 'VM is locked' },
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Cannot unlock VM')).toBeInTheDocument()
    expect(screen.getByText('VM is locked')).toBeInTheDocument()
  })

  // 13. bulkActionDialog - start-all
  it('bulkActionDialog start-all: shows Start all VMs title when open', () => {
    const props = makeProps({
      bulkActionDialog: { open: true, action: 'start-all', node: null, targetNode: '' },
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Start all VMs')).toBeInTheDocument()
  })

  // 14. upgradeDialogOpen
  it('upgradeDialog: shows Enterprise Plan Required title when open', () => {
    const props = makeProps({ upgradeDialogOpen: true })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Enterprise Plan Required')).toBeInTheDocument()
    expect(screen.getByText('Upgrade Plan')).toBeInTheDocument()
  })

  // 15. confirmAction
  it('confirmAction dialog: shows title and message; OK button fires onConfirm', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const props = makeProps({
      confirmAction: {
        action: 'info',
        title: 'Test Title',
        message: 'Test message',
        onConfirm,
      },
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test message')).toBeInTheDocument()

    // For 'info' action the button label is "OK"
    const okBtn = screen.getByRole('button', { name: 'OK' })
    fireEvent.click(okBtn)
    expect(onConfirm).toHaveBeenCalled()
  })

  // 16. deleteHaGroupDialog
  it('deleteHaGroupDialog: shows HA group name when open', () => {
    const props = makeProps({
      deleteHaGroupDialog: { group: 'ha-group-1' },
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Delete HA group')).toBeInTheDocument()
    expect(screen.getByText('ha-group-1')).toBeInTheDocument()
  })

  // 17. deleteHaRuleDialog
  // en.json: drs.deleteAffinityRule = "Delete affinity rule"
  it('deleteHaRuleDialog: shows HA rule name when open', () => {
    const props = makeProps({
      deleteHaRuleDialog: { rule: 'affinity-rule-1' },
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByText('Delete affinity rule')).toBeInTheDocument()
    expect(screen.getByText('affinity-rule-1')).toBeInTheDocument()
  })

  // 18. createVmDialogOpen (embedded static dialog)
  it('createVmDialog: dialog mounts when createVmDialogOpen is true', async () => {
    const props = makeProps({
      createVmDialogOpen: true,
      effectiveCreateDefaults: { connId: CONN_ID },
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  // 19. createLxcDialogOpen (embedded static dialog)
  it('createLxcDialog: dialog mounts when createLxcDialogOpen is true', async () => {
    const props = makeProps({
      createLxcDialogOpen: true,
      effectiveCreateDefaults: { connId: CONN_ID },
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
