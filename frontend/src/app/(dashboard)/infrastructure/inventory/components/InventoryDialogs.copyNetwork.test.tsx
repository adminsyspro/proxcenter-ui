/**
 * roadmap#53: bulk concurrency cap and the VMkernel adapter of the warm copy,
 * in the single-VM and the bulk migration dialogs. Same harness as
 * InventoryDialogs.test.tsx (MSW for the API, real option hook), kept in its
 * own file because these options cut across both dialogs.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent, within } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import { connections, nodes, pools, networkChoices, vmStorage, vdcs } from '@/__tests__/fixtures/pveProvisioning'

import InventoryDialogs, { type InventoryDialogsProps } from './InventoryDialogs'
import { useMigrationOptions } from '../hooks/useMigrationOptions'

vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({ addTask: vi.fn(), updateTask: vi.fn(), removeTask: vi.fn(), tasks: [] }),
}))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn() }),
}))
vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ hasPermission: () => true, permissions: [], roles: [], loading: false, isSuperAdmin: true }),
}))
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: null, loading: false, isFullClusterView: true }),
}))

const CONN_ID = connections[0].id
const NODE_NAME = nodes[0].node
const VC_CONN = 'vc-1'
const THICK_LVM = { storage: 'san-lvm', type: 'lvm', content: 'images', total: 1099511627776, avail: 879609302220 }

const IFACES = {
  hostName: '10.42.0.21', source: 'vcenter', defaultDevice: 'vmk0',
  vnics: [
    { device: 'vmk0', address: '10.42.0.21', subnetMask: '255.255.255.0', portgroup: 'Management Network', mtu: 1500, services: ['management'] },
    { device: 'vmk1', address: '192.168.1.103', portgroup: 'vSAN', services: ['vsan'] },
    { device: 'vmk2', address: '10.42.53.21', portgroup: 'r53-backup', services: [] },
  ],
}

function seed(preflightBodies: any[], ifaces: any = IFACES) {
  server.use(
    http.get('*/api/v1/connections', () => HttpResponse.json({ data: connections })),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes`, () => HttpResponse.json({ data: nodes })),
    http.get('*/api/v1/vdcs', () => HttpResponse.json({ data: vdcs })),
    http.get(`*/api/v1/connections/${CONN_ID}/pools`, () => HttpResponse.json({ data: pools })),
    http.get(`*/api/v1/connections/${CONN_ID}/storage`, () => HttpResponse.json({ data: vmStorage })),
    http.get(`*/api/v1/connections/${CONN_ID}/network-choices`, () => HttpResponse.json({ data: networkChoices })),
    http.get(`*/api/v1/vmware/${VC_CONN}/vms/:vmid`, () => HttpResponse.json({ data: { disks: [] } })),
    http.get(`*/api/v1/vmware/${VC_CONN}/vms/:vmid/copy-interfaces`, () => HttpResponse.json({ data: ifaces })),
    http.get('*/api/v1/settings/migration', () => HttpResponse.json({ data: { warmZeroRateLimitMBps: 0 } })),
    http.post('*/api/v1/migrations/preflight', async ({ request }) => {
      const body: any = await request.json()
      preflightBodies.push(body)
      // The server resolves the adapter's address from vSphere (the browser never sends one).
      const address = IFACES.vnics.find((v: any) => v.device === body.copyVmk)?.address
      const reachable = address !== '10.42.53.21'
      const copy = address ? { address, ports: { 902: reachable }, ok: reachable } : undefined
      return HttpResponse.json({ ok: true, missing: [], kind: 'vddk', vddkSetupAvailable: false, space: { sufficient: true, availableBytes: 1e12, requiredBytes: 1e9, storage: 'san-lvm' }, ...(copy && { copy }) })
    }),
  )
}

/** Same defaults as InventoryDialogs.test.tsx, plus the review-step (#317) and roadmap#53 fields. */
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
    setMigTargetConn: vi.fn(),
    setMigTargetNode: vi.fn(),
    setMigTargetStorage: vi.fn(),
    migTargetVmid: '',
    setMigTargetVmid: vi.fn(),
    migTargetVmidStatus: 'idle',
    setMigTargetVmidStatus: vi.fn(),
    setMigNetworkBridge: vi.fn(),
    migVlanTag: '',
    setMigVlanTag: vi.fn(),
    migBridges: [],
    migStartAfter: false,
    setMigStartAfter: vi.fn(),
    migConvertToQcow2: false,
    migManualCutover: false,
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
    setMigNfcConcurrency: vi.fn(),
    migType: 'cold',
    setMigType: vi.fn(),
    migTransferMode: 'auto',
    setMigTransferMode: vi.fn(),
    migNodes: [],
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

    migZeroRateLimit: '',
    setMigZeroRateLimit: vi.fn(),
    migCpuType: 'x86-64-v2-AES',
    setMigCpuType: vi.fn(),
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
    // Target already chosen, like a dialog a few clicks in.
    migTargetConn: CONN_ID,
    migTargetNode: NODE_NAME,
    migTargetStorage: 'san-lvm',
    migStorages: [THICK_LVM],
    migNetworkBridge: 'vmbr0',
    migPveConnections: [{ id: CONN_ID, name: 'pve-lab', sshEnabled: true }],
    migNodeOptions: [{ connId: CONN_ID, node: NODE_NAME, status: 'online' }],
    ...overrides,
  } as InventoryDialogsProps
}

/** Owns the open state like InventoryDetails, with the real option hook. */
function Harness({ vm, bulk, overrides = {} }: { vm?: any; bulk?: boolean; overrides?: Partial<InventoryDialogsProps> }) {
  const [esxiMigrateVm, setEsxiMigrateVm] = React.useState<any>(vm ?? null)
  const [bulkMigOpen, setBulkMigOpen] = React.useState(!!bulk)
  const options = useMigrationOptions({ esxiMigrateVm, bulkMigOpen })
  return <InventoryDialogs {...makeProps({ esxiMigrateVm, setEsxiMigrateVm, bulkMigOpen, setBulkMigOpen, ...options, ...overrides })} />
}

const warmVm = (vmid: string) => ({ vmid, name: 'r53-src-1', connId: VC_CONN, connName: 'vCenter', hostType: 'vcenter', status: 'poweredOn', committed: 4 * 1024 ** 3 })
const DEFAULT_RE = /Host default: vmk0\s+10\.42\.0\.21\s+\(management\)/

async function pickWarm() {
  fireEvent.click(await screen.findByText('Warm Migration', { exact: true }))
}

describe('warm copy network (roadmap#53)', () => {
  const preflights: any[] = []
  beforeEach(() => { preflights.length = 0; seed(preflights) })
  afterEach(() => cleanup())

  it('lists the VMkernel adapters of the source host with their tags and preselects the host default', async () => {
    renderWithProviders(<Harness vm={warmVm('vm-1')} />)
    await pickWarm()
    const select = await screen.findByTestId('warm-copy-vmk')
    await waitFor(() => expect(select).toHaveValue(''))
    expect(await screen.findByText(DEFAULT_RE)).toBeInTheDocument()
    // The preflight was asked to probe the default adapter from the node (vCenter source: 902 only).
    await waitFor(() => expect(preflights.some(b => b.copyVmk === 'vmk0' && b.sourceVmId === 'vm-1' && b.copyAddress === undefined)).toBe(true))
    expect(await screen.findByText(/Port 902 reachable from pve1/)).toBeInTheDocument()
  })

  it('re-probes the chosen adapter, shows the unreachable verdict and blocks the launch', async () => {
    renderWithProviders(<Harness vm={warmVm('vm-2')} />)
    await pickWarm()
    const select = await screen.findByTestId('warm-copy-vmk')
    await screen.findByText(DEFAULT_RE)
    fireEvent.mouseDown(within(select.parentElement as HTMLElement).getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: /vmk2\s+10\.42\.53\.21/ }))
    await waitFor(() => expect(preflights.some(b => b.copyVmk === 'vmk2')).toBe(true))
    expect(await screen.findByText(/cannot reach 10\.42\.53\.21 on port 902/)).toBeInTheDocument()
    // VMware single-VM dialog: the config step's button leads to the review step (#317) and carries the gate.
    await waitFor(() => expect(screen.getByTestId('migration-launch')).toBeDisabled())
  })

  it('probes 443 too for a direct ESXi source and keeps the config step open while the adapter answers', async () => {
    server.use(http.get(`*/api/v1/vmware/${VC_CONN}/vms/vm-3/copy-interfaces`, () => HttpResponse.json({ data: { ...IFACES, source: 'esxi' } })))
    renderWithProviders(<Harness vm={warmVm('vm-3')} />)
    await pickWarm()
    const select = await screen.findByTestId('warm-copy-vmk')
    await screen.findByText(DEFAULT_RE)
    expect(await screen.findByText(/reads the source disks from 10\.42\.0\.21/)).toBeInTheDocument()
    fireEvent.mouseDown(within(select.parentElement as HTMLElement).getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: /vmk1\s+192\.168\.1\.103/ }))
    await waitFor(() => expect(preflights.some(b => b.copyVmk === 'vmk1' && b.sourceVmId === 'vm-3')).toBe(true))
    expect(await screen.findByText(/Port 902 reachable from pve1/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('migration-launch')).toBeEnabled())
  })

  it('forwards the chosen adapter and its address in the batch request of a direct-ESXi warm batch', async () => {
    const bodies: any[] = []
    server.use(
      http.get(`*/api/v1/vmware/esxi-1/vms/468/copy-interfaces`, () => HttpResponse.json({ data: { ...IFACES, source: 'esxi' } })),
      http.post('*/api/v1/migrations/batches', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ data: { batchId: 'b1', jobIds: ['job-1', 'job-2'] } }) }),
    )
    renderWithProviders(<Harness bulk overrides={{
      bulkMigHostInfo: { hostType: 'vmware', connectionId: 'esxi-1', connectionName: 'ESXi1', vms: [{ vmid: '468', name: 'r53-src-1', status: 'poweredOn' }, { vmid: '469', name: 'r53-src-2', status: 'poweredOn' }] },
      bulkMigSelected: new Set(['468', '469']),
    }} />)
    await pickWarm()
    const select = await screen.findByTestId('warm-copy-vmk')
    await screen.findByText(DEFAULT_RE)
    fireEvent.mouseDown(within(select.parentElement as HTMLElement).getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: /vmk2\s+10\.42\.53\.21/ }))
    const slider = screen.getByTestId('bulk-concurrency-slider').querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    // Shared by the batch: the server copies them into the job of every VM.
    expect(bodies[0]).toMatchObject({ migrationType: 'warm', copyVmk: 'vmk2', concurrency: 2 })
    // The server reads the adapter's address from vSphere: the browser never sends one.
    expect(bodies[0]).not.toHaveProperty('copyAddress')
    expect(bodies[0].vms.map((v: any) => v.sourceVmId)).toEqual(['468', '469'])
  })

  it('says so when the adapters cannot be read and keeps the launch possible', async () => {
    server.use(http.get(`*/api/v1/vmware/${VC_CONN}/vms/vm-4/copy-interfaces`, () => HttpResponse.json({ error: 'NoPermission' }, { status: 500 })))
    renderWithProviders(<Harness vm={warmVm('vm-4')} />)
    await pickWarm()
    expect(await screen.findByText(/could not be read \(NoPermission\)/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('migration-launch')).toBeEnabled())
    expect(preflights.every(b => b.copyVmk === undefined)).toBe(true)
  })

  it('is hidden for a cold migration and for a vCenter batch', async () => {
    renderWithProviders(<Harness vm={warmVm('vm-5')} />)
    await screen.findByText('Warm Migration', { exact: true })
    expect(screen.queryByTestId('warm-copy-vmk')).toBeNull()
    cleanup()
    renderWithProviders(<Harness bulk overrides={{ bulkMigHostInfo: { hostType: 'vcenter', connectionId: VC_CONN, connectionName: 'vCenter', vms: [{ vmid: 'vm-5', name: 'r53-src-1', status: 'poweredOn' }] }, bulkMigSelected: new Set(['vm-5']), migType: 'warm' }} />)
    await screen.findByTestId('bulk-concurrency-slider')
    expect(screen.queryByTestId('warm-copy-vmk')).toBeNull()
  })
})

describe('bulk concurrency (roadmap#53)', () => {
  const preflights: any[] = []
  beforeEach(() => { preflights.length = 0; seed(preflights) })
  afterEach(() => cleanup())

  const HOST = { hostType: 'esxi', connectionId: 'esxi-1', connectionName: 'esxi-lab', vms: [
    { vmid: '1', name: 'a', status: 'poweredOff', committed: 10 * 1024 ** 3 },
    { vmid: '2', name: 'b', status: 'poweredOff', committed: 20 * 1024 ** 3 },
    { vmid: '3', name: 'c', status: 'poweredOff', committed: 30 * 1024 ** 3 },
  ] }

  it('starts sequential, and the slider sets the concurrency of the batch sent to the server', async () => {
    const bodies: any[] = []
    server.use(http.post('*/api/v1/migrations/batches', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ data: { batchId: 'b1', jobIds: ['job-1', 'job-2', 'job-3'] } }) }))
    const setBulkMigJobs = vi.fn()
    renderWithProviders(<Harness bulk overrides={{ bulkMigHostInfo: HOST, bulkMigSelected: new Set(['1', '2', '3']), setBulkMigJobs }} />)
    expect((await screen.findByTestId('bulk-concurrency-value')).textContent).toBe('1 at a time')
    const slider = screen.getByTestId('bulk-concurrency-slider').querySelector('input[type="range"]') as HTMLInputElement
    expect(slider.min).toBe('1')
    expect(slider.max).toBe('5')
    fireEvent.change(slider, { target: { value: '2' } })
    await waitFor(() => expect(screen.getByTestId('bulk-concurrency-value').textContent).toBe('2 at a time'))
    fireEvent.click(screen.getByRole('button', { name: /migrate to proxmox/i }))
    await waitFor(() => expect(setBulkMigJobs).toHaveBeenCalled())
    expect(bodies).toHaveLength(1)
    expect(bodies[0].concurrency).toBe(2)
    expect(bodies[0].vms.map((v: any) => v.sourceVmId)).toEqual(['1', '2', '3'])
    // Every VM starts queued: the server starts them two at a time.
    const jobs = setBulkMigJobs.mock.calls.at(-1)?.[0]
    expect(jobs.map((j: any) => j.status)).toEqual(['queued', 'queued', 'queued'])
  })

  it('sizes the temporary storage need to the N biggest VMs running at once', async () => {
    renderWithProviders(<Harness bulk overrides={{
      bulkMigHostInfo: { ...HOST, hostType: 'vcenter' }, bulkMigSelected: new Set(['1', '2', '3']), migTempStorage: '/mnt/tmp',
      vcenterPreflight: { checked: true, tempStorages: [{ path: '/mnt/tmp', availableBytes: 70 * 1024 ** 3, totalBytes: 200 * 1024 ** 3, filesystem: 'ext4' }] } as any,
    }} />)
    expect(await screen.findByText(/~60\.0 GB peak needed for 1 VM\(s\) at once/)).toBeInTheDocument()
    const slider = screen.getByTestId('bulk-concurrency-slider').querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '2' } })
    expect(await screen.findByText(/Insufficient space: 70\.0 GB available, ~100\.0 GB required for the 2 largest VM\(s\) running at once/)).toBeInTheDocument()
  })
})
