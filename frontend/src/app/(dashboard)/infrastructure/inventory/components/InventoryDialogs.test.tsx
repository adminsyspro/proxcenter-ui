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
  userEvent,
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

import InventoryDialogs, { requestedMigrationType, type InventoryDialogsProps } from './InventoryDialogs'
import { useMigrationOptions } from '../hooks/useMigrationOptions'
import type { AllVmItem, HostItem } from '../InventoryTree'

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
  useRBAC: () => ({ isAdmin: true, hasPermission: () => true, hasPermissionOn: () => true }),
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
    migConvertToQcow2: false,
    migManualCutover: false,
    migConvertGuest: true,
    setMigConvertGuest: vi.fn(),
    migEfiPreEnrolledKeys: true,
    setMigEfiPreEnrolledKeys: vi.fn(),
    setMigManualCutover: () => {},
    migDowntimeBudget: '',
    setMigDowntimeBudget: () => {},
    setMigConvertToQcow2: vi.fn(),
    migDiskPaths: '',
    setMigDiskPaths: vi.fn(),
    migTempStorage: '',
    setMigTempStorage: vi.fn(),
    migV2vRoot: '',
    setMigV2vRoot: vi.fn(),
    migNfcConcurrency: 2,
    migZeroRateLimit: '',
    setMigZeroRateLimit: vi.fn(),
    setMigNfcConcurrency: vi.fn(),
    migType: 'cold',
    setMigType: vi.fn(),
    migTransferMode: 'auto',
    setMigTransferMode: vi.fn(),
    migPveConnections: [],
    migNodes: [],
    migStorages: [],
    migStoragesLoading: false,
    migStoragesError: null,
    retryMigStorages: () => {},
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
    bulkMigBatch: null,
    setBulkMigBatch: vi.fn(),
    bulkMigHostInfo: null,

    // Upgrade
    upgradeDialogOpen: false,
    setUpgradeDialogOpen: vi.fn(),

    // Two-step VMware dialog (#317): the review step and its state.
    migStep: 'config',
    setMigStep: vi.fn(),
    migHardware: { cores: '', sockets: '', memoryMB: '' },
    setMigHardware: vi.fn(),
    migNics: [],
    setMigNics: vi.fn(),
    migBulkConcurrency: 1,
    setMigBulkConcurrency: vi.fn(),
    migCopyVmk: '',
    setMigCopyVmk: vi.fn(),

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

  // 3b. nodeActionDialog - the guests are left to PVE (#1001): ProxCenter may run
  // inside one of them, and stopping it first kills the call that powers the node off.
  describe('nodeActionDialog execution', () => {
    const runningVm = (vmid: string): AllVmItem => ({
      connId: CONN_ID, connName: 'Cluster', node: NODE_NAME, vmid, name: `vm${vmid}`, type: 'qemu', status: 'running', template: false,
    })
    const host = (node: string): HostItem => ({ key: `${CONN_ID}:${node}`, connId: CONN_ID, connName: 'Cluster', node, vms: [] })

    function recordRequests() {
      const guestShutdowns: string[] = []
      const nodeCommands: string[] = []
      server.use(
        http.post('*/api/v1/connections/:id/guests/:type/:node/:vmid/shutdown', ({ params }) => {
          guestShutdowns.push(String(params.vmid))
          return HttpResponse.json({ data: 'UPID' })
        }),
        http.post('*/api/v1/connections/:id/nodes/:node/status', async ({ request }) => {
          const body = await request.json() as { command: string }
          nodeCommands.push(body.command)
          return HttpResponse.json({ data: null })
        }),
        http.post('*/api/v1/connections/:id/nodes/:node/maintenance', () => HttpResponse.json({ data: null })),
        http.post('*/api/v1/inventory/poll', () => HttpResponse.json({ data: null })),
      )
      return { guestShutdowns, nodeCommands }
    }

    const SELF_HOSTED = /if ProxCenter runs in one of these guests/i

    it('warns that ProxCenter goes down with the guests of a standalone node', () => {
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'shutdown', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME)],
      })} />)

      expect(screen.getByText(SELF_HOSTED)).toBeInTheDocument()
    })

    it('lists the guests as tree rows (status dot, name, vmid), not as chips', () => {
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'shutdown', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME)],
      })} />)

      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('vm100')).toBeInTheDocument()
      expect(within(dialog).getByText('100')).toBeInTheDocument()
      expect(dialog.querySelector('.MuiChip-root')).toBeNull()
      expect(dialog.textContent).not.toContain('—')
    })

    it('warns about the local-storage guests of a cluster node', () => {
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'reboot', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME), host('pve2')],
        nodeActionLocalVms: new Set([`${CONN_ID}:100`]),
      })} />)

      expect(screen.getByText(SELF_HOSTED)).toBeInTheDocument()
    })

    it('does not warn when every guest of a cluster node is live-migrated away', () => {
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'reboot', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME), host('pve2')],
      })} />)

      expect(screen.queryByText(SELF_HOSTED)).not.toBeInTheDocument()
    })

    it('standalone shutdown sends the node command without stopping the guests itself', async () => {
      const calls = recordRequests()
      const setNodeActionDialog = vi.fn()
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'shutdown', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        setNodeActionDialog,
        allVms: [runningVm('100'), runningVm('101')],
        hosts: [host(NODE_NAME)],
      })} />)

      fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

      await waitFor(() => expect(setNodeActionDialog).toHaveBeenCalledWith(null))
      expect(calls.nodeCommands).toEqual(['shutdown'])
      expect(calls.guestShutdowns).toEqual([])
    })

    it('cluster shutdown leaves the local-storage guests to PVE once the user agreed to stop them', async () => {
      const calls = recordRequests()
      const setNodeActionDialog = vi.fn()
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'shutdown', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        setNodeActionDialog,
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME), host('pve2')],
        nodeActionLocalVms: new Set([`${CONN_ID}:100`]),
        nodeActionShutdownLocal: true,
      })} />)

      fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

      await waitFor(() => expect(setNodeActionDialog).toHaveBeenCalledWith(null))
      expect(calls.nodeCommands).toEqual(['shutdown'])
      expect(calls.guestShutdowns).toEqual([])
    })

    // #248: the evacuation is a host drain run by the orchestrator. The dialog
    // starts it, polls it, and acts on its verdict.
    function drainOutcome(final: Record<string, unknown>) {
      const requests: any[] = []
      server.use(
        http.post('*/api/v1/orchestrator/host-drains', async ({ request }) => {
          requests.push(await request.json())
          return HttpResponse.json({ data: { id: 'd-1', node: NODE_NAME, status: 'running', guests: [] } })
        }),
        http.get('*/api/v1/orchestrator/host-drains/:id', () => HttpResponse.json({ data: { id: 'd-1', node: NODE_NAME, ...final } })),
        http.get('*/api/v1/connections/:id/guests/:type/:node/:vmid/migrate/pending-check', () => HttpResponse.json({ data: { changes: [] } })),
      )
      return requests
    }

    it('does not reboot when the drain is partial, and keeps the reason and the task of each leftover', async () => {
      const calls = recordRequests()
      const upid = `UPID:${NODE_NAME}:0000ABCD:00001234:6A000000:qmigrate:100:root@pam:`
      const requests = drainOutcome({
        status: 'partial', maintenance_enabled: true,
        guests: [
          { vmid: 100, name: 'vm100', type: 'qemu', running: true, status: 'failed', error: 'task failed: migration aborted', failure_reason: "can't migrate VM which uses local devices: hostpci0", task_id: upid },
          { vmid: 101, name: 'vm101', type: 'qemu', running: true, status: 'completed', target_node: 'pve2' },
        ],
      })
      const setNodeActionFailedVms = vi.fn()
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'reboot', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        allVms: [runningVm('100'), runningVm('101')],
        hosts: [host(NODE_NAME), host('pve2')],
        setNodeActionFailedVms,
      })} />)

      fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

      await waitFor(() => expect(setNodeActionFailedVms).toHaveBeenCalled(), { timeout: 10000 })
      expect(setNodeActionFailedVms).toHaveBeenCalledWith([expect.objectContaining({
        vmid: '100',
        error: "can't migrate VM which uses local devices: hostpci0",
        upid,
        taskNode: NODE_NAME,
      })])
      expect(requests[0]).toEqual({
        connection_id: CONN_ID, node: NODE_NAME,
        config: { target_node: '', max_concurrent_migrations: 2, include_stopped: false, enter_maintenance: true },
      })
      expect(calls.nodeCommands).toEqual([])
    })

    it('reboots once the drain completed, without entering maintenance twice', async () => {
      const calls = recordRequests()
      let maintenanceCalls = 0
      server.use(http.post('*/api/v1/connections/:id/nodes/:node/maintenance', () => { maintenanceCalls++; return HttpResponse.json({ data: null }) }))
      drainOutcome({ status: 'completed', maintenance_enabled: true, guests: [{ vmid: 100, name: 'vm100', type: 'qemu', running: true, status: 'completed', target_node: 'pve2' }] })
      const setNodeActionDialog = vi.fn()
      const setNodeActionFailedVms = vi.fn()
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'reboot', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        setNodeActionDialog,
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME), host('pve2')],
        setNodeActionFailedVms,
      })} />)

      fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

      await waitFor(() => expect(setNodeActionDialog).toHaveBeenCalledWith(null), { timeout: 10000 })
      expect(calls.nodeCommands).toEqual(['reboot'])
      expect(maintenanceCalls).toBe(0)
      expect(setNodeActionFailedVms).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]))
    })

    it('sends a manual target to the drain when the operator insists on one', async () => {
      recordRequests()
      const requests = drainOutcome({ status: 'completed', maintenance_enabled: true, guests: [] })
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'reboot', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME), host('pve2')],
        nodeActionMigrateTarget: 'pve2',
      })} />)

      fireEvent.mouseDown(screen.getByLabelText('Placement'))
      fireEvent.click(await screen.findByRole('option', { name: 'Single target node' }))
      fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

      await waitFor(() => expect(requests).toHaveLength(1), { timeout: 10000 })
      expect(requests[0].config.target_node).toBe('pve2')
    })

    it('shows why a guest could not be moved, with its task log, on the leftover row', () => {
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'reboot', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME), host('pve2')],
        nodeActionFailedVms: [{
          vmid: '100', name: 'vm100', connId: CONN_ID, type: 'qemu', node: NODE_NAME,
          error: 'CT is locked (backup)', upid: `UPID:${NODE_NAME}:1:2:3:qmigrate:100:root@pam:`, taskNode: NODE_NAME,
        }],
      })} />)

      expect(screen.getByText('CT is locked (backup)')).toBeInTheDocument()
      expect(screen.getByText('1 guest(s) are still on the node after the drain')).toBeInTheDocument()
      expect(screen.getByLabelText('Force the reboot anyway, these guests will be stopped')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /tasks\.viewLog|view log/i })).toBeInTheDocument()
    })

    it('cluster reboot forced past a partial drain leaves the leftover guests to PVE and starts no new drain', async () => {
      const calls = recordRequests()
      const requests = drainOutcome({ status: 'completed', guests: [] })
      const setNodeActionDialog = vi.fn()
      renderWithProviders(<InventoryDialogs {...makeProps({
        nodeActionDialog: { action: 'reboot', nodeName: NODE_NAME, connId: CONN_ID, node: NODE_NAME },
        setNodeActionDialog,
        allVms: [runningVm('100')],
        hosts: [host(NODE_NAME), host('pve2')],
        nodeActionMigrateTarget: 'pve2',
        nodeActionFailedVms: [{ vmid: '100', name: 'vm100', connId: CONN_ID, type: 'qemu', node: NODE_NAME, error: 'boom' }],
        nodeActionShutdownFailed: true,
      })} />)

      fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

      await waitFor(() => expect(setNodeActionDialog).toHaveBeenCalledWith(null))
      expect(calls.nodeCommands).toEqual(['reboot'])
      expect(calls.guestShutdowns).toEqual([])
      expect(requests).toEqual([])
    })
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

  // 7b. editOptionDialog - LXC features (#566)
  const checkboxOf = (label: string) => {
    const formLabel = screen.getByText(label).closest('.MuiFormControlLabel-root') as HTMLElement
    return formLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
  }

  it('editOptionDialog features: only nesting is editable on an unprivileged container; toggling rebuilds the PVE string', () => {
    const setEditOptionValue = vi.fn()
    const props = makeProps({
      editOptionDialog: {
        key: 'features',
        label: 'Features',
        value: 'nesting=1,mount=nfs',
        type: 'features',
        unprivileged: true,
      },
      editOptionValue: 'nesting=1,mount=nfs',
      setEditOptionValue,
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    // One checkbox per toggle: nesting, keyctl, fuse, mknod, nfs, cifs
    expect(screen.getAllByRole('checkbox')).toHaveLength(6)

    expect(checkboxOf('Nesting').checked).toBe(true)
    expect(checkboxOf('Nesting').disabled).toBe(false)
    expect(checkboxOf('NFS').checked).toBe(true)
    // PVE reserves every other flag to root@pam, which an API token never is
    for (const label of ['keyctl', 'FUSE', 'Create device nodes', 'NFS', 'SMB/CIFS']) {
      expect(checkboxOf(label).disabled).toBe(true)
    }

    // A locked toggle does nothing
    fireEvent.click(checkboxOf('keyctl'))
    expect(setEditOptionValue).not.toHaveBeenCalled()

    // Disabling nesting keeps the mount segment intact
    fireEvent.click(checkboxOf('Nesting'))
    expect(setEditOptionValue).toHaveBeenCalledWith('mount=nfs')
  })

  it('editOptionDialog features: every toggle is locked on a privileged container', () => {
    const props = makeProps({
      editOptionDialog: { key: 'features', label: 'Features', value: '', type: 'features', unprivileged: false },
      editOptionValue: '',
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    for (const label of ['Nesting', 'keyctl', 'FUSE', 'Create device nodes', 'NFS', 'SMB/CIFS']) {
      expect(checkboxOf(label).disabled).toBe(true)
    }
  })

  it('editOptionDialog: a save failure is shown inline as a themed alert, not a native popup', () => {
    const props = makeProps({
      editOptionDialog: { key: 'hostname', label: 'Hostname', value: 'web-01', type: 'text' },
      editOptionValue: 'web 01',
      editOptionError: 'Permission check failed (changing feature flags (except nesting) is only allowed for root@pam)',
    })
    renderWithProviders(<InventoryDialogs {...props} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Permission check failed')
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

  // 8b. editOptionDialog - vga display memory can be emptied
  it('editOptionDialog vga: display memory can be cleared and retyped without the old digits sticking', async () => {
    // The field is controlled by editOptionValue (a VGA string), so the retype
    // path only exercises the bug when the parent really owns that string: a
    // vi.fn() spy would freeze the value and hide the buffer's behaviour.
    const baseProps = makeProps({
      editOptionDialog: {
        key: 'vga',
        label: 'Display',
        value: 'std,memory=32',
        type: 'vga',
        options: [{ value: 'std', label: 'Standard (std)' }],
      },
    })

    function Harness() {
      const [editOptionValue, setEditOptionValue] = React.useState('std,memory=32')

      return (
        <InventoryDialogs
          {...baseProps}
          editOptionValue={editOptionValue}
          setEditOptionValue={setEditOptionValue}
        />
      )
    }

    renderWithProviders(<Harness />)

    const input = screen.getByRole('spinbutton', { name: 'Memory' }) as HTMLInputElement
    expect(input.value).toBe('32')

    await userEvent.clear(input)
    // Before the fix the controlled value snapped straight back to '32'.
    expect(input.value).toBe('')

    await userEvent.type(input, '64')
    expect(input.value).toBe('64')

    fireEvent.blur(input)
    expect(input.value).toBe('64')

    // Emptying it again and leaving the field commits the 16 MB PVE default,
    // and buildValue drops the redundant `memory=16` segment.
    await userEvent.clear(input)
    fireEvent.blur(input)
    expect(input.value).toBe('16')
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

// ------------------------------------------------------------------ //
// Migration dialog options: sticky-state reset (#443) and post-migration
// qcow2 conversion (#595)
// ------------------------------------------------------------------ //

describe('migration dialog options', () => {
  const ESXI_VM = {
    vmid: '42',
    name: 'web01',
    connId: CONN_ID,
    connName: 'esxi-lab',
    hostType: 'esxi',
    status: 'poweredOff',
    guestOS: 'Ubuntu Linux (64-bit)',
  }
  // Warm is only offered for vmware/vcenter sources (warmAllowedFor); ESXI_VM's
  // hostType 'esxi' is a cold-only fixture, so the warm tests use this one.
  const WARM_VM = { ...ESXI_VM, hostType: 'vmware', committed: 20 * 1024 ** 3 }
  const THICK_LVM = { storage: 'san-lvm', type: 'lvm', content: 'images', total: 1099511627776, avail: 879609302220 }
  const ZFS = { storage: 'tank', type: 'zfspool', content: 'images', total: 1099511627776, avail: 879609302220 }
  const START_AFTER_LABEL = 'Start VM after migration'
  const QCOW2_LABEL = 'Convert disks to qcow2 after migration (enables Proxmox snapshots)'
  const AUTO_CUTOVER_LABEL = 'Automatic cutover'
  const BUDGET_LABEL = 'Downtime budget'

  function getSwitch(label: string): HTMLInputElement {
    const labelEl = screen.getByText(label)
    const fcl = labelEl.closest('.MuiFormControlLabel-root') as HTMLElement
    expect(fcl).not.toBeNull()
    return fcl.querySelector('input[type="checkbox"]') as HTMLInputElement
  }

  beforeEach(() => {
    seedAllHandlers()
    server.use(
      // Source-datastore probe fired when the single-VM dialog opens for a
      // direct-ESXi source (vSAN gate). No disks = no vSAN = nothing blocked.
      http.get(`*/api/v1/vmware/${CONN_ID}/vms/42`, () =>
        HttpResponse.json({ data: { disks: [] } }),
      ),
    )
  })

  afterEach(() => {
    cleanup()
  })

  // Harness owning the dialog-open state the same way InventoryDetails does:
  // the option family comes from the real useMigrationOptions hook, so this
  // exercises the production reset path rather than a test-local copy.
  function OptionsHarness({ dialogOverrides = {}, vm = ESXI_VM }: {
    dialogOverrides?: Partial<InventoryDialogsProps>
    vm?: InventoryDialogsProps['esxiMigrateVm']
  }) {
    const [esxiMigrateVm, setEsxiMigrateVm] = React.useState<any>(null)
    const [bulkMigOpen, setBulkMigOpen] = React.useState(false)
    const options = useMigrationOptions({ esxiMigrateVm, bulkMigOpen })
    return (
      <>
        <button onClick={() => setEsxiMigrateVm(vm)}>harness-open-single</button>
        <button onClick={() => setEsxiMigrateVm(null)}>harness-close-single</button>
        <InventoryDialogs
          {...makeProps({
            esxiMigrateVm,
            setEsxiMigrateVm,
            bulkMigOpen,
            setBulkMigOpen,
            ...options,
            ...dialogOverrides,
          })}
        />
      </>
    )
  }

  // Regression proof for the customer report inside #443: an option toggled
  // for an earlier migration must not silently apply to the next one started
  // in the same page session.
  it('resets toggled options to their defaults when the dialog is closed and reopened', async () => {
    renderWithProviders(
      <OptionsHarness dialogOverrides={{ migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS] }} />,
    )

    fireEvent.click(screen.getByText('harness-open-single'))
    expect(getSwitch(START_AFTER_LABEL).checked).toBe(false)
    expect(getSwitch(QCOW2_LABEL).checked).toBe(false)

    fireEvent.click(getSwitch(START_AFTER_LABEL))
    fireEvent.click(getSwitch(QCOW2_LABEL))
    expect(getSwitch(START_AFTER_LABEL).checked).toBe(true)
    expect(getSwitch(QCOW2_LABEL).checked).toBe(true)

    fireEvent.click(screen.getByText('harness-close-single'))
    await waitFor(() => expect(screen.queryByText(START_AFTER_LABEL)).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('harness-open-single'))
    expect(getSwitch(START_AFTER_LABEL).checked).toBe(false)
    expect(getSwitch(QCOW2_LABEL).checked).toBe(false)
  })

  // #443: the hold is an option like any other, so it inherits the reset. A
  // manual cutover left on from an earlier run would park a migration nobody
  // is watching until someone notices it never finished.
  it('resets the automatic-cutover switch to ON when the dialog is closed and reopened', async () => {
    renderWithProviders(
      <OptionsHarness dialogOverrides={{ migType: 'warm', migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS] }} />,
    )

    fireEvent.click(screen.getByText('harness-open-single'))
    expect(getSwitch(AUTO_CUTOVER_LABEL).checked).toBe(true)

    fireEvent.click(getSwitch(AUTO_CUTOVER_LABEL))
    expect(getSwitch(AUTO_CUTOVER_LABEL).checked).toBe(false)

    fireEvent.click(screen.getByText('harness-close-single'))
    await waitFor(() => expect(screen.queryByText(AUTO_CUTOVER_LABEL)).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('harness-open-single'))
    expect(getSwitch(AUTO_CUTOVER_LABEL).checked).toBe(true)
  })

  it('blocks the launch when the target storage is too small', async () => {
    const preflightBodies: any[] = []
    server.use(
      http.post('*/api/v1/migrations/preflight', async ({ request }) => {
        const body = await request.json() as any
        preflightBodies.push(body)
        return HttpResponse.json({
          ok: true, missing: [], kind: 'vddk', vddkTokenConfigured: false,
          space: { storage: body.targetStorage, availableBytes: 12 * 1024 ** 3, requiredBytes: body.requiredDiskBytes, sufficient: false },
        })
      }),
    )
    renderWithProviders(
      <OptionsHarness
        vm={WARM_VM}
        dialogOverrides={{
          migType: 'warm', migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS],
          migTargetConn: CONN_ID, migTargetNode: NODE_NAME,
        }}
      />,
    )

    fireEvent.click(screen.getByText('harness-open-single'))
    await screen.findByText(/Not enough free space on san-lvm: 12\.0 GB available, 20\.0 GB needed/)
    // VMware source: the form's launch button is "Review" (#317); the space
    // verdict holds it, so the review step and the launch stay out of reach.
    expect(screen.getByRole('button', { name: /^Review$/ })).toBeDisabled()
    expect(preflightBodies[0]).toMatchObject({
      action: 'warm-check', targetStorage: 'san-lvm', requiredDiskBytes: 20 * 1024 ** 3,
    })
  })

  it('enables the launch when the storage is large enough', async () => {
    const preflightBodies: any[] = []
    server.use(
      http.post('*/api/v1/migrations/preflight', async ({ request }) => {
        const body = await request.json() as any
        preflightBodies.push(body)
        // The review step re-checks the space per storage (#317 lot 2).
        if (body.action === 'storage-space') {
          return HttpResponse.json({ spaces: body.needs.map((n: any) => ({ storage: n.storage, availableBytes: 32 * 1024 ** 3, requiredBytes: n.requiredBytes, sufficient: true })) })
        }
        return HttpResponse.json({
          ok: true, missing: [], kind: 'vddk', vddkTokenConfigured: false,
          space: { storage: body.targetStorage, availableBytes: 32 * 1024 ** 3, requiredBytes: body.requiredDiskBytes, sufficient: true },
        })
      }),
    )
    renderWithProviders(
      <OptionsHarness
        vm={WARM_VM}
        dialogOverrides={{
          migType: 'warm', migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS],
          migTargetConn: CONN_ID, migTargetNode: NODE_NAME,
          // Warm launch also requires a running source and SSH on the target.
          esxiMigrateVm: { ...WARM_VM, status: 'poweredOn' },
          migPveConnections: [{ id: CONN_ID, name: 'pve-lab', sshEnabled: true }],
        }}
      />,
    )

    fireEvent.click(screen.getByText('harness-open-single'))
    await screen.findByText(/Target node is ready for warm migration/)
    expect(screen.queryByText(/Not enough free space/)).not.toBeInTheDocument()
    // VMware source: "Review" opens the review step (#317), where the launch
    // button is enabled once the per-storage space check answered, because
    // every form gate passed.
    const review = screen.getByRole('button', { name: /^Review$/ })
    expect(review).toBeEnabled()
    fireEvent.click(review)
    await screen.findByTestId('migration-review-step')
    await waitFor(() => expect(screen.getByRole('button', { name: /Migrate to Proxmox/ })).toBeEnabled())
    expect(preflightBodies[0]).toMatchObject({
      action: 'warm-check', targetStorage: 'san-lvm', requiredDiskBytes: 20 * 1024 ** 3,
    })
    // Without any per-disk change the review asks exactly what warm-check asked.
    expect(preflightBodies.find(b => b.action === 'storage-space')).toMatchObject({
      targetConnectionId: CONN_ID, targetNode: NODE_NAME, needs: [{ storage: 'san-lvm', requiredBytes: 20 * 1024 ** 3 }],
    })
  })

  it('shows the read error when the storage cannot be read', async () => {
    const preflightBodies: any[] = []
    server.use(
      http.post('*/api/v1/migrations/preflight', async ({ request }) => {
        const body = await request.json() as any
        preflightBodies.push(body)
        return HttpResponse.json({
          ok: true, missing: [], kind: 'vddk', vddkTokenConfigured: false,
          space: { storage: 'san-lvm', availableBytes: 0, requiredBytes: 0, sufficient: false, error: 'No such storage.' },
        })
      }),
    )
    renderWithProviders(
      <OptionsHarness vm={WARM_VM} dialogOverrides={{
        migType: 'warm', migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS],
        migTargetConn: CONN_ID, migTargetNode: NODE_NAME,
      }} />,
    )

    fireEvent.click(screen.getByText('harness-open-single'))
    await screen.findByText(/Could not read the free space of san-lvm on the target node: No such storage\./)
    // VMware source: the form's launch button is "Review" (#317) and the read error holds it.
    expect(screen.getByRole('button', { name: /^Review$/ })).toBeDisabled()
    expect(preflightBodies[0]).toMatchObject({ action: 'warm-check', targetStorage: 'san-lvm' })
  })

  it('sends no targetStorage when none is selected', async () => {
    const preflightBodies: any[] = []
    server.use(
      http.post('*/api/v1/migrations/preflight', async ({ request }) => {
        const body = await request.json() as any
        preflightBodies.push(body)
        return HttpResponse.json({
          ok: true, missing: [], kind: 'vddk', vddkTokenConfigured: false,
          space: { storage: body.targetStorage, availableBytes: 12 * 1024 ** 3, requiredBytes: body.requiredDiskBytes, sufficient: true },
        })
      }),
    )
    renderWithProviders(
      <OptionsHarness vm={{ ...WARM_VM, committed: undefined }} dialogOverrides={{
        migType: 'warm', migTargetStorage: '', migStorages: [THICK_LVM, ZFS],
        migTargetConn: CONN_ID, migTargetNode: NODE_NAME,
      }} />,
    )

    fireEvent.click(screen.getByText('harness-open-single'))
    await waitFor(() => expect(preflightBodies.length).toBeGreaterThan(0))
    expect(preflightBodies[0].targetStorage).toBeUndefined()
    expect(preflightBodies[0].requiredDiskBytes).toBe(0)
  })

  // #663: the budget only governs the automatic decision, so it follows the
  // switch instead of sitting there inert next to a hold.
  it('shows the downtime budget only while the cutover stays automatic', async () => {
    renderWithProviders(
      <OptionsHarness dialogOverrides={{ migType: 'warm' }} />,
    )

    fireEvent.click(screen.getByText('harness-open-single'))
    expect(screen.getByRole('slider', { name: BUDGET_LABEL })).toBeInTheDocument()

    fireEvent.click(getSwitch(AUTO_CUTOVER_LABEL))
    await waitFor(() => expect(screen.queryByRole('slider', { name: BUDGET_LABEL })).not.toBeInTheDocument())
  })

  it('hides the downtime budget outside a warm migration', () => {
    renderWithProviders(
      <InventoryDialogs {...makeProps({ esxiMigrateVm: ESXI_VM, migTargetConn: CONN_ID, migTargetNode: NODE_NAME, migType: 'cold' })} />,
    )
    expect(screen.queryByRole('slider', { name: BUDGET_LABEL })).not.toBeInTheDocument()
  })

  it('opens the budget on the pipeline default and spells the value out', () => {
    renderWithProviders(
      <OptionsHarness dialogOverrides={{ migType: 'warm' }} />,
    )
    fireEvent.click(screen.getByText('harness-open-single'))

    // "5 min" also labels one of the marks, so assert on the thumb's own value.
    expect(screen.getByRole('slider', { name: BUDGET_LABEL })).toHaveAttribute('aria-valuetext', '5 min')
  })

  it('resets a moved downtime budget when the dialog is closed and reopened', async () => {
    renderWithProviders(
      <OptionsHarness dialogOverrides={{ migType: 'warm' }} />,
    )

    fireEvent.click(screen.getByText('harness-open-single'))
    const slider = screen.getByRole('slider', { name: BUDGET_LABEL })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('slider', { name: BUDGET_LABEL })).toHaveAttribute('aria-valuetext', '10 min'))

    fireEvent.click(screen.getByText('harness-close-single'))
    await waitFor(() => expect(screen.queryByRole('slider', { name: BUDGET_LABEL })).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('harness-open-single'))
    expect(screen.getByRole('slider', { name: BUDGET_LABEL })).toHaveAttribute('aria-valuetext', '5 min')
  })

  it('takes a precise budget from the field, off the slider scale', async () => {
    // The scale stops at round values; a maintenance window does not.
    renderWithProviders(
      <OptionsHarness dialogOverrides={{ migType: 'warm' }} />,
    )
    fireEvent.click(screen.getByText('harness-open-single'))

    fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '500' } })

    // the slider follows, snapped to the nearest stop it can show
    await waitFor(() => expect(screen.getByRole('slider', { name: BUDGET_LABEL })).toHaveAttribute('aria-valuetext', '10 min'))
    expect((screen.getByLabelText('Seconds') as HTMLInputElement).value).toBe('500')
  })

  it('moves the field when the slider moves', async () => {
    renderWithProviders(
      <OptionsHarness dialogOverrides={{ migType: 'warm' }} />,
    )
    fireEvent.click(screen.getByText('harness-open-single'))

    fireEvent.keyDown(screen.getByRole('slider', { name: BUDGET_LABEL }), { key: 'ArrowRight' })

    await waitFor(() => expect((screen.getByLabelText('Seconds') as HTMLInputElement).value).toBe('600'))
  })

  it('shows the automatic-cutover switch only for a warm migration', () => {
    const { unmount } = renderWithProviders(
      <InventoryDialogs {...makeProps({ esxiMigrateVm: ESXI_VM, migTargetConn: CONN_ID, migTargetNode: NODE_NAME, migType: 'warm' })} />,
    )
    expect(screen.getByText(AUTO_CUTOVER_LABEL)).toBeInTheDocument()
    unmount()

    renderWithProviders(
      <InventoryDialogs {...makeProps({ esxiMigrateVm: ESXI_VM, migTargetConn: CONN_ID, migTargetNode: NODE_NAME, migType: 'cold' })} />,
    )
    expect(screen.queryByText(AUTO_CUTOVER_LABEL)).not.toBeInTheDocument()
  })

  it('shows the qcow2 switch only when the selected target storage is thick LVM', () => {
    const { unmount } = renderWithProviders(
      <InventoryDialogs
        {...makeProps({
          esxiMigrateVm: ESXI_VM,
          migTargetConn: CONN_ID,
          migTargetNode: NODE_NAME,
          migTargetStorage: 'san-lvm',
          migStorages: [THICK_LVM, ZFS],
        })}
      />,
    )
    expect(screen.getByText(QCOW2_LABEL)).toBeInTheDocument()
    unmount()

    renderWithProviders(
      <InventoryDialogs
        {...makeProps({
          esxiMigrateVm: ESXI_VM,
          migTargetConn: CONN_ID,
          migTargetNode: NODE_NAME,
          migTargetStorage: 'tank',
          migStorages: [THICK_LVM, ZFS],
        })}
      />,
    )
    expect(screen.queryByText(QCOW2_LABEL)).not.toBeInTheDocument()
  })

  // Warm migration streams via nbdkit straight into the target block device and
  // never stages the disk locally, so the virt-v2v temp-storage selector and its
  // "2x the VM disk" space requirement must not be shown in warm mode (a partner
  // read the false space error as warm needing ~192 GB of /tmp it does not use).
  const GIB = 1073741824
  const VCENTER_VM = { ...ESXI_VM, hostType: 'vcenter', committed: 100 * GIB }
  const PREFLIGHT_TEMP_TOO_SMALL = {
    checked: true, ok: true, installing: false, errors: [] as string[],
    virtV2vInstalled: true, virtioWinInstalled: true, nbdkitInstalled: true,
    nbdcopyInstalled: true, guestfsToolsInstalled: true, ovmfInstalled: true, ntfsCompressionPluginInstalled: true,
    detectedDisks: [] as string[],
    tempStorages: [{ path: '/tmp', availableBytes: 150 * GIB, totalBytes: 200 * GIB, filesystem: 'ext4' }],
  }

  it('hides the Temporary Storage selector and its space error in warm mode (single VM)', () => {
    const { unmount } = renderWithProviders(
      <InventoryDialogs
        {...makeProps({
          esxiMigrateVm: VCENTER_VM,
          migType: 'cold',
          migTempStorage: '/tmp',
          vcenterPreflight: PREFLIGHT_TEMP_TOO_SMALL,
        })}
      />,
    )
    expect(screen.getAllByText('Temporary Storage').length).toBeGreaterThan(0)
    expect(screen.getByText(/Insufficient space/)).toBeInTheDocument()
    unmount()

    renderWithProviders(
      <InventoryDialogs
        {...makeProps({
          esxiMigrateVm: VCENTER_VM,
          migType: 'warm',
          migTempStorage: '/tmp',
          vcenterPreflight: PREFLIGHT_TEMP_TOO_SMALL,
        })}
      />,
    )
    expect(screen.queryByText('Temporary Storage')).not.toBeInTheDocument()
    expect(screen.queryByText(/Insufficient space/)).not.toBeInTheDocument()
  })

  it('hides the Temporary Storage selector and its space error in warm mode (bulk)', () => {
    const bulkProps = (migType: 'cold' | 'warm') =>
      makeProps({
        bulkMigOpen: true,
        bulkMigHostInfo: {
          hostType: 'vcenter',
          connectionId: 'vc-1',
          connectionName: 'vcenter-lab',
          vms: [{ vmid: '42', name: 'web01', status: 'poweredOff', committed: 100 * GIB }],
        },
        bulkMigSelected: new Set(['42']),
        migType,
        migTempStorage: '/tmp',
        vcenterPreflight: PREFLIGHT_TEMP_TOO_SMALL,
      })
    const { unmount } = renderWithProviders(<InventoryDialogs {...bulkProps('cold')} />)
    expect(screen.getAllByText('Temporary Storage').length).toBeGreaterThan(0)
    expect(screen.getByText(/Insufficient space/)).toBeInTheDocument()
    unmount()

    renderWithProviders(<InventoryDialogs {...bulkProps('warm')} />)
    expect(screen.queryByText('Temporary Storage')).not.toBeInTheDocument()
    expect(screen.queryByText(/Insufficient space/)).not.toBeInTheDocument()
  })

  it('forwards convertDisksToQcow2=true in the single-VM migration request', async () => {
    const bodies: any[] = []
    server.use(
      http.post('*/api/v1/migrations', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { jobId: 'job-1' } })
      }),
    )
    renderWithProviders(
      <InventoryDialogs
        {...makeProps({
          esxiMigrateVm: ESXI_VM,
          migTargetConn: CONN_ID,
          migTargetNode: NODE_NAME,
          migTargetStorage: 'san-lvm',
          migStorages: [THICK_LVM, ZFS],
          migConvertToQcow2: true,
          migNetworkBridge: 'vmbr0',
          migPveConnections: [{ id: CONN_ID, name: 'pve-lab', sshEnabled: true }],
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].convertDisksToQcow2).toBe(true)
    // The neighbouring option keeps its wiring: default off means false.
    expect(bodies[0].startAfterMigration).toBe(false)
  })

  // A toggle left on for a previously selected LVM storage must not leak when
  // the user switches to a storage the option does not apply to.
  it('sends convertDisksToQcow2=false when the toggle is stale for a non-LVM storage', async () => {
    const bodies: any[] = []
    server.use(
      http.post('*/api/v1/migrations', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { jobId: 'job-2' } })
      }),
    )
    renderWithProviders(
      <InventoryDialogs
        {...makeProps({
          esxiMigrateVm: ESXI_VM,
          migTargetConn: CONN_ID,
          migTargetNode: NODE_NAME,
          migTargetStorage: 'tank',
          migStorages: [THICK_LVM, ZFS],
          migConvertToQcow2: true,
          migNetworkBridge: 'vmbr0',
          migPveConnections: [{ id: CONN_ID, name: 'pve-lab', sshEnabled: true }],
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].convertDisksToQcow2).toBe(false)
  })

  it('bulk dialog forwards convertDisksToQcow2 in the batch request', async () => {
    const bodies: any[] = []
    server.use(
      http.post('*/api/v1/migrations/batches', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { batchId: 'batch-1', jobIds: ['job-bulk-1'] } })
      }),
    )
    renderWithProviders(
      <InventoryDialogs
        {...makeProps({
          bulkMigOpen: true,
          bulkMigHostInfo: {
            hostType: 'esxi',
            connectionId: 'esxi-1',
            connectionName: 'esxi-lab',
            vms: [{ vmid: '42', name: 'web01', status: 'poweredOff' }],
          },
          bulkMigSelected: new Set(['42']),
          migTargetConn: CONN_ID,
          migTargetNode: NODE_NAME,
          migTargetStorage: 'san-lvm',
          migStorages: [THICK_LVM, ZFS],
          migConvertToQcow2: true,
          migNetworkBridge: 'vmbr0',
          migPveConnections: [{ id: CONN_ID, name: 'pve-lab', sshEnabled: true }],
        })}
      />,
    )
    expect(screen.getByText(QCOW2_LABEL)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    // One shared option for the whole batch: the server copies it into every job.
    expect(bodies[0].convertDisksToQcow2).toBe(true)
    expect(bodies[0].vms).toEqual([{ sourceVmId: '42', sourceVmName: 'web01', targetNode: NODE_NAME, diskBytes: expect.any(Number) }])
  })

  // The Hyper-V VHDX pre-fill moved into the reset-on-open hook (a blind reset
  // would have wiped what the open handler pre-filled): opening for a Hyper-V
  // VM with known disk paths must derive the /mnt/hyperv/ paths.
  // #317 lot 2: one target storage per disk, and disks left out, chosen in the
  // review step of a VMware migration. The source detail carries two disks of
  // equal size so the committed bytes split in halves.
  describe('per-disk target storage in the review step', () => {
    const GIB2 = 1024 ** 3
    const NFS = { storage: 'nas', type: 'nfs', content: 'images', total: 1099511627776, avail: 879609302220 }
    const COLD_VM = { ...WARM_VM, status: 'poweredOff' }
    const DETAIL = {
      snapshotCount: 0, vmxVersion: 'vmx-19', numCPU: 2, numCoresPerSocket: 1, sockets: 2, memoryMB: 2048, hasVtpm: false,
      nics: [{ label: 'Network adapter 1', type: 'Vmxnet3', macAddress: '00:50:56:aa:00:01', network: 'VM Network' }],
      disks: [
        { label: 'Hard disk 1', capacityBytes: 10 * GIB2, fileName: '[ds1] web/web.vmdk', thinProvisioned: true, diskMode: 'persistent', sharing: 'sharingNone' },
        { label: 'Hard disk 2', capacityBytes: 10 * GIB2, fileName: '[ds1] web/web_1.vmdk', thinProvisioned: true, diskMode: 'persistent', sharing: 'sharingNone' },
      ],
    }
    const targetProps = { migTargetConn: CONN_ID, migTargetNode: NODE_NAME, migNetworkBridge: 'vmbr0', migPveConnections: [{ id: CONN_ID, name: 'pve-lab', sshEnabled: true }] }

    /** warm-check answers "ready"; storage-space answers with the free bytes of each storage. */
    function seedPreflight(bodies: any[], availableOf: (storage: string) => number = () => 100 * GIB2) {
      server.use(
        http.post('*/api/v1/migrations/preflight', async ({ request }) => {
          const body = await request.json() as any
          bodies.push(body)
          if (body.action === 'storage-space') {
            return HttpResponse.json({ spaces: body.needs.map((n: any) => ({ storage: n.storage, availableBytes: availableOf(n.storage), requiredBytes: n.requiredBytes, sufficient: availableOf(n.storage) >= n.requiredBytes * 1.1 })) })
          }
          return HttpResponse.json({ ok: true, missing: [], kind: 'vddk', vddkTokenConfigured: false, space: { storage: body.targetStorage, availableBytes: 100 * GIB2, requiredBytes: body.requiredDiskBytes, sufficient: true } })
        }),
      )
    }
    function seedLaunch(bodies: any[]) {
      server.use(http.post('*/api/v1/migrations', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ data: { jobId: 'job-3' } }) }))
    }
    async function openReview() {
      fireEvent.click(screen.getByText('harness-open-single'))
      // A warm run keeps Review disabled until its preflight answers: under a
      // loaded full run the click used to land on the disabled button.
      const review = await screen.findByRole('button', { name: /^Review$/ })
      await waitFor(() => expect(review).toBeEnabled(), { timeout: 5000 })
      fireEvent.click(review)
      // the rows appear once the source answer is in, whichever came first
      await screen.findByTestId('review-disk-1')
    }
    async function pickStorage(row: number, storage: string) {
      fireEvent.mouseDown(within(screen.getByTestId(`review-disk-${row}-storage`)).getByRole('combobox'))
      fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${storage}`) }))
    }
    const launchButton = () => screen.getByRole('button', { name: /Migrate to Proxmox/ })

    beforeEach(() => {
      server.use(http.get(`*/api/v1/vmware/${CONN_ID}/vms/42`, () => HttpResponse.json({ data: DETAIL })))
    })

    it('sends one target storage per disk from the review step, the step-1 storage staying the default', async () => {
      const bodies: any[] = []
      seedLaunch(bodies)
      renderWithProviders(<OptionsHarness vm={COLD_VM} dialogOverrides={{ ...targetProps, migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS] }} />)
      await openReview()
      await pickStorage(1, 'tank')
      expect(launchButton()).toBeEnabled()
      fireEvent.click(launchButton())
      await waitFor(() => expect(bodies).toHaveLength(1))
      expect(bodies[0].targetStorage).toBe('san-lvm')
      expect(bodies[0].disks).toEqual([{ index: 0, targetStorage: 'san-lvm' }, { index: 1, targetStorage: 'tank' }])
    })

    it('marks a disk left out, and never lets the boot disk be left out', async () => {
      const bodies: any[] = []
      seedLaunch(bodies)
      renderWithProviders(<OptionsHarness vm={COLD_VM} dialogOverrides={{ ...targetProps, migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS] }} />)
      await openReview()
      expect((screen.getByTestId('review-disk-0-include') as HTMLInputElement).disabled).toBe(true)
      fireEvent.click(screen.getByTestId('review-disk-1-include'))
      fireEvent.click(launchButton())
      await waitFor(() => expect(bodies).toHaveLength(1))
      expect(bodies[0].disks).toEqual([{ index: 0, targetStorage: 'san-lvm' }, { index: 1, exclude: true }])
    })

    it('sends no disks outside the review step', async () => {
      const bodies: any[] = []
      seedLaunch(bodies)
      renderWithProviders(<InventoryDialogs {...makeProps({ esxiMigrateVm: ESXI_VM, ...targetProps, migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS] })} />)
      fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
      await waitFor(() => expect(bodies).toHaveLength(1))
      expect(bodies[0]).not.toHaveProperty('disks')
      expect(bodies[0].targetStorage).toBe('san-lvm')
    })

    it('holds a warm launch while a kept disk is bound for a file-based storage, until it is moved or left out', async () => {
      const bodies: any[] = []
      seedPreflight(bodies)
      renderWithProviders(<OptionsHarness vm={{ ...WARM_VM, status: 'poweredOn' }} dialogOverrides={{ ...targetProps, migType: 'warm', migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS, NFS] }} />)
      await openReview()
      await waitFor(() => expect(launchButton()).toBeEnabled())
      await pickStorage(1, 'nas')
      expect(screen.getByTestId('review-disks-warm-blocked').textContent).toMatch(/Hard disk 2 on nas \(nfs\)/)
      expect(launchButton()).toBeDisabled()
      fireEvent.click(screen.getByTestId('review-disk-1-include'))
      expect(screen.queryByTestId('review-disks-warm-blocked')).toBeNull()
      await waitFor(() => expect(launchButton()).toBeEnabled())
      // the share of the disk left out is no longer asked for
      expect(bodies.at(-1)).toMatchObject({ action: 'storage-space', needs: [{ storage: 'san-lvm', requiredBytes: 10 * GIB2 }] })
    })

    it('names the storage that cannot hold the disks bound to it and holds the warm launch', async () => {
      const bodies: any[] = []
      seedPreflight(bodies, storage => (storage === 'tank' ? 5 * GIB2 : 100 * GIB2))
      renderWithProviders(<OptionsHarness vm={{ ...WARM_VM, status: 'poweredOn' }} dialogOverrides={{ ...targetProps, migType: 'warm', migTargetStorage: 'san-lvm', migStorages: [THICK_LVM, ZFS] }} />)
      await openReview()
      await waitFor(() => expect(launchButton()).toBeEnabled())
      await pickStorage(1, 'tank')
      // the split changed: the check runs again and holds the launch meanwhile
      expect(screen.getByTestId('review-disks-space-pending')).toBeInTheDocument()
      expect(launchButton()).toBeDisabled()
      await screen.findByText(/Not enough free space on tank: 5\.0 GB available, 10\.0 GB needed/)
      expect(launchButton()).toBeDisabled()
      expect(bodies.at(-1)).toMatchObject({
        action: 'storage-space', targetConnectionId: CONN_ID, targetNode: NODE_NAME,
        needs: [{ storage: 'san-lvm', requiredBytes: 10 * GIB2 }, { storage: 'tank', requiredBytes: 10 * GIB2 }],
      })
    })

    it('shows the thick LVM options in the review step only while a kept disk lands on an lvm storage', async () => {
      renderWithProviders(<OptionsHarness vm={COLD_VM} dialogOverrides={{ ...targetProps, migTargetStorage: 'tank', migStorages: [THICK_LVM, ZFS] }} />)
      await openReview()
      expect(screen.queryByText(QCOW2_LABEL)).not.toBeInTheDocument()
      await pickStorage(1, 'san-lvm')
      expect(within(screen.getByTestId('review-disks-below')).getByText(QCOW2_LABEL)).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('review-disk-1-include'))
      expect(screen.queryByText(QCOW2_LABEL)).not.toBeInTheDocument()
    })
  })

  it('pre-fills migDiskPaths for Hyper-V sources with known disk paths on open', async () => {
    function HypervHarness() {
      const [esxiMigrateVm, setEsxiMigrateVm] = React.useState<any>(null)
      const [bulkMigOpen, setBulkMigOpen] = React.useState(false)
      const options = useMigrationOptions({ esxiMigrateVm, bulkMigOpen })
      return (
        <>
          <button
            onClick={() =>
              setEsxiMigrateVm({
                vmid: 'hv-1',
                name: 'win01',
                connId: CONN_ID,
                connName: 'hyperv-lab',
                hostType: 'hyperv',
                status: 'poweredOff',
                diskPaths: ['C:\\VMs\\win01.vhdx'],
              })
            }
          >
            harness-open-hyperv
          </button>
          <span data-testid="mig-disk-paths">{options.migDiskPaths}</span>
          <InventoryDialogs
            {...makeProps({ esxiMigrateVm, setEsxiMigrateVm, bulkMigOpen, setBulkMigOpen, ...options })}
          />
        </>
      )
    }
    renderWithProviders(<HypervHarness />)
    fireEvent.click(screen.getByText('harness-open-hyperv'))
    await waitFor(() =>
      expect(screen.getByTestId('mig-disk-paths')).toHaveTextContent('/mnt/hyperv/win01.vhdx'),
    )
  })
})

describe('requestedMigrationType', () => {
  it.each([
    ['hyperv', 'warm', 'cold'], ['nutanix', 'sshfs_boot', 'cold'],
    ['vcenter', 'sshfs_boot', 'cold'], ['vcenter', 'warm', 'warm'], ['vcenter', 'cold', 'cold'],
    ['vmware', 'sshfs_boot', 'sshfs_boot'], ['xcpng', 'warm', 'warm'], [undefined, 'cold', 'cold'],
  ])('source %s, choice %s -> %s', (host, choice, want) => {
    expect(requestedMigrationType(host as string | undefined, choice)).toBe(want)
  })
})

// roadmap#53: a batch of dozens of VMs stays readable in the bulk dialog.
describe('bulk migration dialog with a large selection', () => {
  const vms = Array.from({ length: 25 }, (_, i) => ({
    vmid: `vm-${i + 1}`,
    name: `bulk-${String(i + 1).padStart(2, '0')}`,
    status: i < 23 ? 'poweredOn' : 'poweredOff',
  }))
  const host = { hostType: 'vcenter', connectionId: 'src', vms }
  const base = { bulkMigOpen: true, bulkMigHostInfo: host, bulkMigSelected: new Set(vms.map(v => v.vmid)) }

  it('folds the selected VMs behind a summary, pages them, and shows VMware poweredOn as running', async () => {
    renderWithProviders(<InventoryDialogs {...makeProps(base)} />)
    const summary = await screen.findByTestId('bulk-selected-summary')
    expect(summary).toHaveTextContent('25 VMs · 23 running, 2 stopped')
    expect(screen.queryByTestId('bulk-selected-dot-vm-1')).toBeNull()

    fireEvent.click(summary)
    const dots = screen.getAllByTestId(/^bulk-selected-dot-/)
    expect(dots).toHaveLength(10)
    expect(dots[0]).toHaveAttribute('data-power', 'on')
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getAllByTestId(/^bulk-selected-dot-/).map(d => d.getAttribute('data-power'))).toEqual(['on', 'on', 'on', 'off', 'off'])
  })

  it('names five running VMs in the cold warning and counts the rest', async () => {
    renderWithProviders(<InventoryDialogs {...makeProps({ ...base, migType: 'cold' })} />)
    expect(await screen.findByText('bulk-05')).toBeInTheDocument()
    expect(screen.queryByText('bulk-06')).toBeNull()
    expect(screen.getByText('and 18 more')).toBeInTheDocument()
  })

  it('filters the logs with a list instead of one chip per VM past five VMs', async () => {
    const bulkMigJobs = Array.from({ length: 8 }, (_, i) => ({ vmid: `vm-${i + 1}`, name: `job-${i + 1}`, jobId: `j${i + 1}`, status: 'transferring', progress: 10 }))
    const setBulkMigLogsFilter = vi.fn()
    renderWithProviders(<InventoryDialogs {...makeProps({ ...base, bulkMigJobs, bulkMigLogsExpanded: true, setBulkMigLogsFilter })} />)
    const filter = await screen.findByTestId('bulk-logs-vm-filter')
    expect(screen.queryByRole('button', { name: 'job-3' })).toBeNull()
    fireEvent.change(filter, { target: { value: 'j3' } })
    expect(setBulkMigLogsFilter).toHaveBeenCalledWith('j3')
  })

  it('lists failed then running jobs first, ten per page, with the in-flight counts', async () => {
    const statuses = ['completed', 'completed', 'queued', 'queued', 'queued', 'queued', 'queued', 'queued', 'queued', 'transferring', 'failed', 'queued']
    const bulkMigJobs = statuses.map((status, i) => ({ vmid: `vm-${i + 1}`, name: `job-${i + 1}`, jobId: `j${i + 1}`, status, progress: status === 'completed' ? 100 : 0 }))
    renderWithProviders(<InventoryDialogs {...makeProps({ ...base, bulkMigJobs, bulkMigProgressExpanded: true })} />)
    expect(await screen.findByTestId('bulk-job-counts')).toHaveTextContent('1 running, 8 queued')
    const order = (names: string[]) => names.map(n => screen.queryByText(n) ? n : null)
    // job-11 (failed) and job-10 (running) on page one; the two completed ones on page two
    expect(order(['job-11', 'job-10', 'job-3'])).toEqual(['job-11', 'job-10', 'job-3'])
    expect(screen.queryByText('job-1')).toBeNull()
    fireEvent.click(within(screen.getByTestId('bulk-job-pagination')).getByRole('button', { name: /next page/i }))
    expect(screen.getByText('job-1')).toBeInTheDocument()
    expect(screen.getByText('job-2')).toBeInTheDocument()
  })
})

// roadmap#53 part B: the queue of a bulk migration lives on the server.
describe('bulk migration batch on the server', () => {
  const THICK = { storage: 'san-lvm', type: 'lvm', content: 'images', total: 1099511627776, avail: 879609302220 }
  const host = {
    hostType: 'esxi',
    connectionId: 'esxi-1',
    connectionName: 'esxi-lab',
    vms: [
      { vmid: '1', name: 'a', status: 'poweredOff' },
      { vmid: '2', name: 'b', status: 'poweredOff' },
      { vmid: '3', name: '', status: 'poweredOff' },
    ],
  }
  const launchProps = (overrides: Partial<InventoryDialogsProps> = {}) => makeProps({
    bulkMigOpen: true,
    bulkMigHostInfo: host,
    bulkMigSelected: new Set(['1', '2', '3']),
    migTargetConn: CONN_ID,
    migTargetNode: '__auto__',
    migNodeOptions: [
      { connId: CONN_ID, node: 'pve1', status: 'online' },
      { connId: CONN_ID, node: 'pve2', status: 'online' },
      { connId: CONN_ID, node: 'pve3', status: 'offline' },
    ],
    migTargetStorage: 'san-lvm',
    migStorages: [THICK],
    migNetworkBridge: 'vmbr0',
    migPveConnections: [{ id: CONN_ID, name: 'pve-lab', sshEnabled: true }],
    migBulkConcurrency: 2,
    ...overrides,
  })

  it('launches the whole selection in one request, nodes round-robined, and follows the batch', async () => {
    const bodies: any[] = []
    let perVmPosts = 0
    server.use(
      http.post('*/api/v1/migrations', () => { perVmPosts++; return HttpResponse.json({ data: { jobId: 'nope' } }) }),
      http.post('*/api/v1/migrations/batches', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { batchId: 'b1', jobIds: ['j1', 'j2', 'j3'] } })
      }),
    )
    const setBulkMigBatch = vi.fn()
    const setBulkMigJobs = vi.fn()
    renderWithProviders(<InventoryDialogs {...launchProps({ setBulkMigBatch, setBulkMigJobs })} />)
    fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
    await waitFor(() => expect(setBulkMigBatch).toHaveBeenCalled())
    expect(bodies).toHaveLength(1)
    expect(perVmPosts).toBe(0)
    expect(bodies[0]).toMatchObject({ sourceConnectionId: 'esxi-1', targetConnectionId: CONN_ID, targetStorage: 'san-lvm', networkBridge: 'vmbr0', concurrency: 2 })
    // The offline node gets nothing; a VM without a name goes by its id.
    expect(bodies[0].vms).toEqual([
      { sourceVmId: '1', sourceVmName: 'a', targetNode: 'pve1', diskBytes: 0 },
      { sourceVmId: '2', sourceVmName: 'b', targetNode: 'pve2', diskBytes: 0 },
      { sourceVmId: '3', sourceVmName: '3', targetNode: 'pve1', diskBytes: 0 },
    ])
    expect(bodies[0]).not.toHaveProperty('sourceVmId')
    expect(setBulkMigBatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', status: 'running', concurrency: 2 }))
    expect(setBulkMigJobs).toHaveBeenCalledWith([
      { vmid: '1', name: 'a', jobId: 'j1', status: 'queued', progress: 0, targetNode: 'pve1' },
      { vmid: '2', name: 'b', jobId: 'j2', status: 'queued', progress: 0, targetNode: 'pve2' },
      { vmid: '3', name: '3', jobId: 'j3', status: 'queued', progress: 0, targetNode: 'pve1' },
    ])
  })

  describe('copy network of a warm batch', () => {
    const warmHost = { ...host, vms: host.vms.map(vm => ({ ...vm, status: 'poweredOn' })) }

    it('places the VMs on Auto where the server says they reach their copy network, and says so', async () => {
      const checks: any[] = []
      const launches: any[] = []
      server.use(
        http.post('*/api/v1/migrations/batches/copy-check', async ({ request }) => {
          checks.push(await request.json())
          return HttpResponse.json({ data: { assignment: { '1': 'pve1', '2': 'pve1', '3': 'pve2' }, problems: [], unchecked: [], infos: [{ vm: 'a', nodes: ['pve1'], excluded: ['pve2'] }, { vm: 'b', nodes: ['pve1'], excluded: ['pve2'] }] } })
        }),
        http.post('*/api/v1/migrations/batches', async ({ request }) => { launches.push(await request.json()); return HttpResponse.json({ data: { batchId: 'b1', jobIds: ['j1', 'j2', 'j3'] } }) }),
      )
      renderWithProviders(<InventoryDialogs {...launchProps({ bulkMigHostInfo: warmHost, migType: 'warm' })} />)
      await waitFor(() => expect(checks).toHaveLength(1))
      expect(checks[0]).toMatchObject({ sourceConnectionId: 'esxi-1', targetConnectionId: CONN_ID, nodes: ['pve1', 'pve2'], auto: true, vms: [{ sourceVmId: '1', sourceVmName: 'a' }, { sourceVmId: '2', sourceVmName: 'b' }, { sourceVmId: '3', sourceVmName: '3' }] })
      const info = await screen.findByTestId('bulk-copy-info')
      expect(info).toHaveTextContent('a → pve1 only (pve2 cannot reach its copy network)')
      fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
      await waitFor(() => expect(launches).toHaveLength(1))
      expect(launches[0].vms.map((v: any) => v.targetNode)).toEqual(['pve1', 'pve1', 'pve2'])
    })

    it('blocks the launch when a node cannot reach a copy adapter', async () => {
      server.use(
        http.post('*/api/v1/migrations/batches/copy-check', () => HttpResponse.json({ data: { assignment: {}, infos: [], unchecked: [], problems: [
          { kind: 'unreachable', node: 'pve3', host: '10.42.0.21', device: 'vmk1', address: '192.168.1.103', ports: [902] },
          { kind: 'noNode', vm: 'b', host: '10.42.0.21', device: 'vmk1', address: '192.168.1.103' },
        ] } })),
      )
      renderWithProviders(<InventoryDialogs {...launchProps({ bulkMigHostInfo: warmHost, migType: 'warm', migTargetNode: 'pve3' })} />)
      const alert = await screen.findByTestId('bulk-copy-error')
      expect(alert).toHaveTextContent('pve3 cannot reach vmk1 192.168.1.103 (host 10.42.0.21) on port 902')
      expect(alert).toHaveTextContent('No target node can reach the copy network of b: vmk1 192.168.1.103 (host 10.42.0.21)')
      expect(screen.getByRole('button', { name: /migrate to proxmox/i })).toBeDisabled()
    })

    it('does not check a cold batch', async () => {
      let called = 0
      server.use(http.post('*/api/v1/migrations/batches/copy-check', () => { called++; return HttpResponse.json({ data: {} }) }))
      renderWithProviders(<InventoryDialogs {...launchProps({ migType: 'cold' })} />)
      await new Promise(r => setTimeout(r, 500))
      expect(called).toBe(0)
    })
  })

  describe('target space of the whole batch', () => {
    const GB = 1024 ** 3
    const sized = { ...host, vms: host.vms.map(vm => ({ ...vm, committed: 3 * GB, uncommitted: GB })) }

    it('asks the server with the round-robin nodes and each VM size, and sends the sizes with the batch', async () => {
      const checks: any[] = []
      const launches: any[] = []
      server.use(
        http.post('*/api/v1/migrations/batches/space-check', async ({ request }) => { checks.push(await request.json()); return HttpResponse.json({ data: { ok: true, problems: [] } }) }),
        http.post('*/api/v1/migrations/batches', async ({ request }) => { launches.push(await request.json()); return HttpResponse.json({ data: { batchId: 'b1', jobIds: ['j1', 'j2', 'j3'] } }) }),
      )
      renderWithProviders(<InventoryDialogs {...launchProps({ bulkMigHostInfo: sized })} />)
      await waitFor(() => expect(checks).toHaveLength(1))
      expect(checks[0]).toEqual({
        sourceConnectionId: 'esxi-1', targetConnectionId: CONN_ID, targetStorage: 'san-lvm',
        vms: [{ sourceVmId: '1', targetNode: 'pve1', diskBytes: 4 * GB }, { sourceVmId: '2', targetNode: 'pve2', diskBytes: 4 * GB }, { sourceVmId: '3', targetNode: 'pve1', diskBytes: 4 * GB }],
      })
      expect(screen.queryByTestId('bulk-space-error')).toBeNull()
      const launch = screen.getByRole('button', { name: /migrate to proxmox/i })
      expect(launch).toBeEnabled()
      fireEvent.click(launch)
      await waitFor(() => expect(launches).toHaveLength(1))
      expect(launches[0].vms.map((v: any) => v.diskBytes)).toEqual([4 * GB, 4 * GB, 4 * GB])
    })

    it('says which storage is short and keeps the launch disabled', async () => {
      server.use(
        http.post('*/api/v1/migrations/batches/space-check', () => HttpResponse.json({ data: { ok: false, problems: [
          { storage: 'ZFS-Pool', node: 'pve1', availableBytes: 6.7 * GB, requiredBytes: 9 * GB },
          { storage: 'ZFS-Pool', node: 'pve2', availableBytes: 0, requiredBytes: 4 * GB, error: 'storage is not online' },
        ] } })),
      )
      renderWithProviders(<InventoryDialogs {...launchProps({ bulkMigHostInfo: sized, migTargetStorage: 'ZFS-Pool' })} />)
      const alert = await screen.findByTestId('bulk-space-error')
      expect(alert).toHaveTextContent('Not enough space on ZFS-Pool (pve1): 6.7 GB free, this batch needs 9.0 GB plus a 10% margin')
      expect(alert).toHaveTextContent('Cannot read free space on ZFS-Pool (pve2): storage is not online')
      expect(screen.getByRole('button', { name: /migrate to proxmox/i })).toBeDisabled()
    })

    it('only warns, launch enabled, when the shortfall rests on estimated sizes', async () => {
      server.use(
        http.post('*/api/v1/migrations/batches/space-check', () => HttpResponse.json({ data: { ok: true, problems: [], warnings: [
          { storage: 'ZFS-Pool', node: 'pve1', availableBytes: 6 * GB, requiredBytes: 8 * GB, estimated: true },
        ] } })),
      )
      renderWithProviders(<InventoryDialogs {...launchProps({ bulkMigHostInfo: sized, migTargetStorage: 'ZFS-Pool' })} />)
      expect(await screen.findByTestId('bulk-space-warning')).toHaveTextContent("Maybe not enough space on ZFS-Pool (pve1): 6.0 GB free, this batch needs about 8.0 GB plus a 10% margin (estimated from the source's used space)")
      expect(screen.queryByTestId('bulk-space-error')).toBeNull()
      expect(screen.getByRole('button', { name: /migrate to proxmox/i })).toBeEnabled()
    })

    it('words a shared storage without a node', async () => {
      server.use(
        http.post('*/api/v1/migrations/batches/space-check', () => HttpResponse.json({ data: { ok: false, problems: [
          { storage: 'CephStoragePool', node: null, availableBytes: 2 * GB, requiredBytes: 12 * GB },
        ] } })),
      )
      renderWithProviders(<InventoryDialogs {...launchProps({ bulkMigHostInfo: sized })} />)
      expect(await screen.findByTestId('bulk-space-error')).toHaveTextContent('Not enough space on CephStoragePool: 2.0 GB free, this batch needs 12.0 GB plus a 10% margin')
    })
  })

  it('keeps the form and names the VM the server refused', async () => {
    server.use(
      http.post('*/api/v1/migrations/batches', () => HttpResponse.json({ error: 'VM is locked', sourceVmId: '2' }, { status: 409 })),
    )
    const setBulkMigBatch = vi.fn()
    const setBulkMigJobs = vi.fn()
    renderWithProviders(<InventoryDialogs {...launchProps({ setBulkMigBatch, setBulkMigJobs })} />)
    fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
    const alert = await screen.findByTestId('bulk-start-error')
    expect(alert).toHaveTextContent('The bulk migration could not be started')
    expect(alert).toHaveTextContent('b: VM is locked')
    expect(setBulkMigBatch).not.toHaveBeenCalled()
    expect(setBulkMigJobs).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /migrate to proxmox/i })).toBeInTheDocument()
  })

  describe('load projection on the target nodes', () => {
    const GiB = 1024 ** 3
    const sizedVms = { ...host, vms: host.vms.map(vm => ({ ...vm, cpu: 4, memory_size_MiB: 8192 })) }
    const loaded = [
      { connId: CONN_ID, node: 'pve1', status: 'online', cpu: 0.25, maxcpu: 16, mem: 40 * GiB, maxmem: 64 * GiB },
      { connId: CONN_ID, node: 'pve2', status: 'online', cpu: 0.1, maxcpu: 8, mem: 4 * GiB, maxmem: 32 * GiB },
    ]
    beforeEach(() => {
      server.use(http.post('*/api/v1/migrations/batches/space-check', () => HttpResponse.json({ data: { ok: true, problems: [] } })))
    })

    it('shows each target node now and after the batch, round-robined like the launch', async () => {
      renderWithProviders(<InventoryDialogs {...launchProps({ bulkMigHostInfo: sizedVms, migNodeOptions: loaded })} />)
      const block = await screen.findByTestId('bulk-load-projection')
      expect(within(block).getByText('Load on the target nodes')).toBeInTheDocument()
      // pve1 takes VMs 1 and 3: 40 + 16 GiB of 64; pve2 takes VM 2: 4 + 8 GiB of 32.
      expect(within(block).getByTestId('bulk-projection-node-pve1')).toHaveTextContent('pve1+2')
      expect(within(block).getByTestId('bulk-projection-mem-pve1')).toHaveTextContent('63 → 88 %')
      expect(within(block).getByTestId('bulk-projection-mem-pve2')).toHaveTextContent('13 → 38 %')
      // CPU: every vCPU booked busy over the node's cores, as the drain books busy cores.
      expect(within(block).getByTestId('bulk-projection-cpu-pve1')).toHaveTextContent('25 → 75 %')
      expect(within(block).getByTestId('bulk-projection-cpu-pve2')).toHaveTextContent('10 → 60 %')
      expect(screen.queryByTestId('bulk-projection-mem-alert')).toBeNull()
    })

    it('warns, without blocking the launch, when a node would pass 90 % of its memory', async () => {
      const tight = [{ ...loaded[0], mem: 48 * GiB }, loaded[1]]
      renderWithProviders(<InventoryDialogs {...launchProps({ bulkMigHostInfo: sizedVms, migNodeOptions: tight })} />)
      const alert = await screen.findByTestId('bulk-projection-mem-alert')
      expect(alert).toHaveTextContent('pve1: memory would reach 100 % (64.0/64.0 GB) once this batch has landed.')
      expect(alert).not.toHaveTextContent('pve2')
      await waitFor(() => expect(screen.getByRole('button', { name: /migrate to proxmox/i })).toBeEnabled())
    })
  })

  const rows = [
    { vmid: '1', name: 'a', jobId: 'j1', status: 'transferring', progress: 40 },
    { vmid: '2', name: 'b', jobId: 'j2', status: 'queued', progress: 0 },
    { vmid: '3', name: 'c', jobId: 'j3', status: 'queued', progress: 0 },
  ]
  const trackingProps = (status: string, overrides: Partial<InventoryDialogsProps> = {}) => makeProps({
    bulkMigOpen: true,
    // A batch reopened from the server: no host snapshot, no selection.
    bulkMigHostInfo: null,
    bulkMigJobs: rows,
    bulkMigBatch: { id: 'b1', status, concurrency: 1 },
    bulkMigProgressExpanded: true,
    ...overrides,
  })

  it('offers Pause while the batch runs with VMs still queued', async () => {
    renderWithProviders(<InventoryDialogs {...trackingProps('running')} />)
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel queued' })).toBeInTheDocument()
    expect(screen.getByTestId('bulk-job-counts')).toHaveTextContent('1 running, 2 queued')
    expect(screen.getAllByText('Queued')).toHaveLength(2)
    expect(screen.getByText(/Bulk Migration \(3 VMs\)/i)).toBeInTheDocument()
  })

  it('offers Resume when paused, says so and marks the queued rows Paused', async () => {
    const setBulkMigProgressExpanded = vi.fn()
    renderWithProviders(<InventoryDialogs {...trackingProps('paused', { setBulkMigProgressExpanded })} />)
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.getByTestId('bulk-job-counts')).toHaveTextContent('Paused: 1 running, 2 queued')
    expect(screen.getAllByText('Paused')).toHaveLength(2)
    expect(screen.queryByText('Queued')).toBeNull()
    // The header buttons do not fold the job list.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel queued' }))
    expect(setBulkMigProgressExpanded).not.toHaveBeenCalled()
  })

  it('shows the jobs dropped by Cancel queued as cancelled, not as failures', async () => {
    const cancelledRows = [rows[0], { ...rows[1], status: 'cancelled' }, { ...rows[2], status: 'cancelled' }]
    renderWithProviders(<InventoryDialogs {...trackingProps('cancelled', { bulkMigJobs: cancelledRows })} />)
    expect(await screen.findByTestId('bulk-cancelled-count')).toHaveTextContent('(2 cancelled)')
    expect(screen.getAllByText('Cancelled')).toHaveLength(2)
    expect(screen.queryByText('Failed')).toBeNull()
    expect(screen.queryByText(/failed/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel queued' })).toBeNull()
  })

  describe('live columns of the follow-up', () => {
    const liveRows = [
      { vmid: '1', name: 'a', jobId: 'j1', status: 'transferring', progress: 40, targetNode: 'pve1', bytesTransferred: 1024 },
      { vmid: '2', name: 'b', jobId: 'j2', status: 'queued', progress: 0, targetNode: 'pve2' },
      { vmid: '3', name: 'c', jobId: 'j3', status: 'queued', progress: 0, targetNode: 'pve1' },
    ]
    const GiB = 1024 ** 3

    it('shows the throughput and one card per target node with its live load', async () => {
      const reads: any[] = []
      server.use(
        http.post(`*/api/v1/connections/${CONN_ID}/rrd/batch`, async ({ request }) => {
          reads.push(await request.json())
          return HttpResponse.json({ data: {
            '/nodes/pve1': [
              { time: 60, cpu: 0.3, iowait: 0.02, memused: 19.8 * GiB, memtotal: 32 * GiB, netin: 12.5 * 1024 * 1024 },
              { time: 120 },
            ],
            '/nodes/pve2': [{ time: 60, cpu: 0.9, iowait: 0.97, memused: 31 * GiB, memtotal: 32 * GiB, netin: 0 }],
          } })
        }),
      )
      renderWithProviders(<InventoryDialogs {...trackingProps('running', {
        bulkMigJobs: liveRows,
        bulkMigBatch: { id: 'b1', status: 'running', concurrency: 1, targetConnectionId: CONN_ID },
      })} />)
      const throughput = await screen.findByTestId('migration-live-throughput')
      // Range picker: 1m / 5m / 1h / 24h, 5m first.
      const range = within(throughput).getByTestId('migration-live-throughput-range')
      expect(within(range).getAllByRole('button').map(b => b.textContent)).toEqual(['1m', '5m', '1h', '24h'])
      expect(within(range).getByRole('button', { name: '5m' })).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(within(range).getByRole('button', { name: '1h' }))
      expect(within(range).getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'true')
      expect(within(throughput).getByText('Throughput')).toBeInTheDocument()
      expect(screen.getByTestId('migration-live-throughput-figures')).toHaveTextContent('Now 0.0 MB/s · peak 0.0 MB/s')
      const pve1 = await screen.findByTestId('migration-live-node-pve1')
      const pve2 = screen.getByTestId('migration-live-node-pve2')
      expect(screen.getAllByTestId(/^migration-live-node-pve\d$/)).toHaveLength(2)
      expect(reads).toEqual([{ paths: ['/nodes/pve1', '/nodes/pve2'], timeframe: 'hour' }])
      expect(within(pve1).getByTestId('migration-live-node-jobs-pve1')).toHaveTextContent('2 VMs (1 running, 1 queued)')
      expect(within(pve2).getByTestId('migration-live-node-jobs-pve2')).toHaveTextContent('1 VM (0 running, 1 queued)')
      await waitFor(() => expect(within(pve1).getByText('62 % (19.8/32.0 GB)')).toBeInTheDocument())
      expect(within(pve1).getByText('30 %')).toBeInTheDocument()
      // No network figure: the node's RRD average does not reflect the copy, the chart does.
      expect(within(pve1).queryByTestId('migration-live-node-netin-pve1')).toBeNull()
      expect(within(pve2).getByText('97 %')).toBeInTheDocument()
      // The job rows stay on the left.
      expect(within(screen.getByTestId('migration-live-columns')).getAllByText('Queued')).toHaveLength(2)
    })
  })

  describe('copy of the migration logs', () => {
    const writeText = vi.fn(async (_t: string) => {})
    beforeEach(() => {
      writeText.mockClear()
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    })
    const at = (s: number) => new Date(2026, 9, 18, 7, 5, s).toISOString()
    const logRows = [
      { ...rows[0], logs: [{ ts: at(1), level: 'info', msg: 'planning' }, { ts: at(3), level: 'success', msg: 'done' }] },
      { ...rows[1], status: 'transferring', logs: [{ ts: at(2), level: 'warn', msg: 'slow' }] },
      rows[2],
    ]

    it('copies the lines shown, in time order, with the VM of each', async () => {
      renderWithProviders(<InventoryDialogs {...trackingProps('running', { bulkMigJobs: logRows, bulkMigLogsExpanded: true })} />)
      fireEvent.click(await screen.findByTestId('copy-migration-logs'))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('07:05:01 info [a] planning\n07:05:02 warn [b] slow\n07:05:03 success [a] done'))
    })

    it('honours the VM filter of the panel', async () => {
      renderWithProviders(<InventoryDialogs {...trackingProps('running', { bulkMigJobs: logRows, bulkMigLogsExpanded: true, bulkMigLogsFilter: 'j2' })} />)
      fireEvent.click(await screen.findByTestId('copy-migration-logs'))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('07:05:02 warn [b] slow'))
    })

    it('does not fold the panel when clicked', async () => {
      const setBulkMigLogsExpanded = vi.fn()
      renderWithProviders(<InventoryDialogs {...trackingProps('running', { bulkMigJobs: logRows, bulkMigLogsExpanded: true, setBulkMigLogsExpanded })} />)
      fireEvent.click(await screen.findByTestId('copy-migration-logs'))
      await waitFor(() => expect(writeText).toHaveBeenCalled())
      expect(setBulkMigLogsExpanded).not.toHaveBeenCalled()
    })

    it('is on the log panel of a single migration too, without VM names', async () => {
      renderWithProviders(<InventoryDialogs {...makeProps({
        esxiMigrateVm: { vmid: 'vm-9', name: 'web-1', status: 'poweredOff', hostType: 'vmware', connectionId: 'esxi-1' }, migJobId: 'job-1',
        migJob: { id: 'job-1', status: 'transferring', progress: 20, logs: [{ ts: at(4), level: 'info', msg: 'copying' }] },
      })} />)
      fireEvent.click(await screen.findByTestId('copy-migration-logs'))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('07:05:04 info copying'))
    })
  })

  it('posts the pause and reads the batch back', async () => {
    const posts: string[] = []
    server.use(
      http.post('*/api/v1/migrations/batches/b1/pause', () => { posts.push('pause'); return HttpResponse.json({ data: { status: 'paused' } }) }),
      http.get('*/api/v1/migrations/batches/b1', () => HttpResponse.json({ data: {
        id: 'b1', status: 'paused', concurrency: 1, sourceConnectionId: 'esxi-1', targetConnectionId: CONN_ID,
        jobs: rows.map(r => ({ id: r.jobId, sourceVmId: r.vmid, sourceVmName: r.name, status: r.status, progress: r.progress, logs: [] })),
      } })),
    )
    const setBulkMigBatch = vi.fn()
    renderWithProviders(<InventoryDialogs {...trackingProps('running', { setBulkMigBatch })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(setBulkMigBatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', status: 'paused' })))
    expect(posts).toEqual(['pause'])
  })

  it('shows the refusal of a transition that no longer applies', async () => {
    server.use(
      http.post('*/api/v1/migrations/batches/b1/resume', () => HttpResponse.json({ error: 'Batch is not paused' }, { status: 409 })),
      http.get('*/api/v1/migrations/batches/b1', () => HttpResponse.json({ error: 'gone' }, { status: 404 })),
    )
    renderWithProviders(<InventoryDialogs {...trackingProps('paused')} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    expect(await screen.findByTestId('bulk-batch-error')).toHaveTextContent('Batch is not paused')
  })

  it('asks before cancelling the queued migrations, then posts cancel-queued', async () => {
    const posts: string[] = []
    server.use(
      http.post('*/api/v1/migrations/batches/b1/cancel-queued', () => { posts.push('cancel-queued'); return HttpResponse.json({ data: { status: 'cancelled', cancelled: 2 } }) }),
      http.get('*/api/v1/migrations/batches/b1', () => HttpResponse.json({ data: {
        id: 'b1', status: 'cancelled', concurrency: 1, sourceConnectionId: 'esxi-1', targetConnectionId: CONN_ID,
        jobs: rows.map(r => ({ id: r.jobId, sourceVmId: r.vmid, sourceVmName: r.name, status: r.status === 'queued' ? 'cancelled' : r.status, progress: r.progress, logs: [] })),
      } })),
    )
    const setBulkMigBatch = vi.fn()
    const setBulkMigJobs = vi.fn()
    renderWithProviders(<InventoryDialogs {...trackingProps('running', { setBulkMigBatch, setBulkMigJobs })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel queued' }))
    const body = await screen.findByText('Cancel the 2 queued migrations? Running migrations carry on.')
    expect(posts).toEqual([])
    const confirm = body.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel queued' }))
    await waitFor(() => expect(setBulkMigBatch).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' })))
    expect(posts).toEqual(['cancel-queued'])
    expect(setBulkMigJobs.mock.calls.at(-1)?.[0].map((j: any) => j.status)).toEqual(['transferring', 'cancelled', 'cancelled'])
  })

  it('clears the batch on Close once every job is over', async () => {
    const setBulkMigBatch = vi.fn()
    const done = rows.map(r => ({ ...r, status: 'completed', progress: 100 }))
    renderWithProviders(<InventoryDialogs {...trackingProps('completed', { bulkMigJobs: done, setBulkMigBatch })} />)
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(setBulkMigBatch).toHaveBeenCalledWith(null)
  })
})
