import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

// Firmware, machine, TPM, disk bus, display and HA of a deployment (#181).
const rbac = vi.hoisted(() => ({ canManageHa: true }))
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ currentTenant: { id: 'default', name: 'Provider' }, loading: false, isFullClusterView: true }) }))
vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ hasPermission: () => true, hasPermissionOn: (perm: string) => perm !== 'node.manage' || rbac.canManageHa, isAdmin: true, permissions: [] }),
}))
vi.mock('./DeploymentProgress', () => ({ default: () => <div>Deployment started</div> }))
import DeployWizard from './DeployWizard'

const baseImage = {
  name: 'Image', vendor: 'microsoft', version: '2025', arch: 'amd64', downloadUrl: '', checksumUrl: null,
  defaultDiskSize: '60G', minMemory: 128, recommendedMemory: 4096, minCores: 1, recommendedCores: 2, tags: [],
}
const templateDisk = { ...baseImage, slug: 'custom-default-win-template', format: 'qcow2', ostype: 'win11' } as any
const linuxImage = { ...baseImage, slug: 'debian-13', vendor: 'debian', format: 'qcow2', ostype: 'l26' } as any
const windowsIso = { ...baseImage, slug: 'custom-default-win-iso', format: 'iso', ostype: 'win11' } as any

let posted: any = null
let hintRequests: string[] = []
function seed(options: { storages?: any[]; hints?: any } = {}) {
  const storages = options.storages ?? [{ storage: 'ceph', type: 'rbd', content: 'images', active: 1, enabled: 1, shared: 1, avail: 0, total: 0 }]
  server.use(
    http.get('*/api/v1/connections', () => HttpResponse.json({ data: [{ id: 'conn-a', name: 'PVE-A' }] })),
    http.get('*/api/v1/admin/vdcs', () => HttpResponse.json({ data: [] })),
    http.get('*/api/v1/vdcs', () => HttpResponse.json({ data: [] })),
    http.get('*/api/v1/connections/:id/nodes', () => HttpResponse.json({ data: [{ node: 'pve1', status: 'online', cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 10 }] })),
    http.get('*/api/v1/connections/:id/cluster/nextid', () => HttpResponse.json({ data: 4200 })),
    http.get('*/api/v1/connections/:id/network-choices', () => HttpResponse.json({ data: [{ name: 'vmbr0', kind: 'bridge', displayName: 'vmbr0' }] })),
    http.get('*/api/v1/connections/:id/nodes/:node/storages', ({ request }) => {
      if (new URL(request.url).searchParams.get('content') === 'iso') return HttpResponse.json({ data: [{ storage: 'iso-store', type: 'dir', content: 'iso', active: 1, enabled: 1 }] })
      return HttpResponse.json({ data: storages })
    }),
    http.get('*/api/v1/templates/hardware-hints', ({ request }) => {
      hintRequests.push(new URL(request.url).search)
      return HttpResponse.json({ data: options.hints ?? null })
    }),
    http.post('*/api/v1/templates/deploy', async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ data: { deploymentId: 'dep-181', vmid: 4200 } })
    }),
  )
}

async function next() {
  const button = screen.getByRole('button', { name: 'Next' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}
/** Image → Target → Hardware. */
async function toHardware() {
  await next()
  await screen.findByText('Connection')
  await userEvent.type(screen.getByLabelText('VM Name'), 'vm-181')
  await next()
  return screen.findByRole('combobox', { name: 'Disk bus' })
}
async function nextTimes(count: number): Promise<void> {
  if (count === 0) return
  await next()
  return nextTimes(count - 1)
}
async function deploy(stepsToReview: number) {
  await nextTimes(stepsToReview)
  await userEvent.click(screen.getByRole('button', { name: 'Deploy Now' }))
  await waitFor(() => expect(posted).not.toBeNull())
}
const combo = (name: string | RegExp) => screen.getByRole('combobox', { name })
async function choose(name: string | RegExp, option: string | RegExp) {
  await userEvent.click(combo(name))
  await userEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }))
}

beforeEach(() => { posted = null; hintRequests = []; rbac.canManageHa = true })
afterEach(cleanup)

describe('DeployWizard firmware and display (#181)', () => {
  it('prefills a template-derived image from its template and sends those settings', async () => {
    seed({ hints: { bios: 'ovmf', machine: 'q35', tpm: true, diskBus: 'sata', vga: 'std', scsihw: 'virtio-scsi-pci' } })
    renderWithProviders(<DeployWizard open image={templateDisk} onClose={() => {}} />)
    await toHardware()

    expect(await screen.findByText('Read from the template this image was taken from.')).toBeInTheDocument()
    expect(combo('Disk bus')).toHaveTextContent('SATA')
    expect(combo('Machine')).toHaveTextContent('q35')
    expect(combo('BIOS')).toHaveTextContent(/UEFI/)
    expect(hintRequests[0]).toContain('imageSlug=custom-default-win-template')
    expect(hintRequests[0]).toContain('connectionId=conn-a')

    await deploy(2)
    expect(posted.hardware).toMatchObject({ bios: 'ovmf', machine: 'q35', tpm: true, diskBus: 'sata', vga: 'std', scsihw: 'virtio-scsi-pci' })
    expect(posted.ha).toBeUndefined()
  })

  it('keeps SeaBIOS, i440fx, SCSI and a standard display for a Linux cloud image, without asking for hints', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={linuxImage} onClose={() => {}} />)
    await toHardware()
    expect(combo('Disk bus')).toHaveTextContent('SCSI')
    expect(combo('Display')).toHaveTextContent('Standard VGA')
    expect(screen.queryByText(/Windows boots in UEFI/)).toBeNull()

    await deploy(2)
    expect(posted.hardware).toMatchObject({ bios: 'seabios', machine: 'i440fx', tpm: false, diskBus: 'scsi', vga: 'std' })
    expect(hintRequests).toEqual([])
  })

  it('warns that a serial display leaves the console black, and sends the user choices', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={linuxImage} onClose={() => {}} />)
    await toHardware()
    await choose('Display', 'Serial console')
    expect(screen.getByText('A serial display leaves the ProxCenter console black.')).toBeInTheDocument()
    await choose('Disk bus', 'VirtIO Block')
    await choose('Machine', 'q35')
    await choose('BIOS', /UEFI/)
    await userEvent.click(screen.getByRole('switch', { name: 'TPM 2.0' }))

    await deploy(2)
    expect(posted.hardware).toMatchObject({ bios: 'ovmf', machine: 'q35', tpm: true, diskBus: 'virtio', vga: 'serial0' })
  })

  it('an ISO Windows installer gets UEFI, a TPM and a SATA disk, on q35 with a standard display', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={windowsIso} onClose={() => {}} />)
    await toHardware()
    expect(combo('Disk bus')).toHaveTextContent('SATA')
    expect(screen.getByRole('switch', { name: 'TPM 2.0' })).toBeChecked()
    expect(screen.queryByRole('combobox', { name: 'Machine' })).toBeNull()

    await deploy(1)
    expect(posted.hardware).toMatchObject({ bios: 'ovmf', machine: 'q35', tpm: true, diskBus: 'sata', vga: 'std', ostype: 'win11' })
  })

  it('a blueprint is the recipe: its firmware wins and no template hints are asked', async () => {
    seed({ hints: { bios: 'seabios', diskBus: 'ide' } })
    const blueprint = { hardware: { cores: 2, memory: 4096, diskSize: '60G', bios: 'ovmf', machine: 'q35', tpm: true, diskBus: 'virtio', vga: 'qxl' }, cloudInit: null }
    renderWithProviders(<DeployWizard open image={templateDisk} prefillBlueprint={blueprint} onClose={() => {}} />)
    await toHardware()
    expect(combo('Disk bus')).toHaveTextContent('VirtIO Block')
    expect(combo('Display')).toHaveTextContent('SPICE (qxl)')
    expect(hintRequests).toEqual([])
    expect(screen.queryByText('Read from the template this image was taken from.')).toBeNull()
  })
})

describe('DeployWizard high availability (#181)', () => {
  it('on shared storage, enabling HA sends ha: true', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={linuxImage} onClose={() => {}} />)
    await toHardware()
    const ha = screen.getByRole('switch', { name: /Enable high availability/ })
    expect(ha).toBeEnabled()
    expect(screen.getByText('The VM is added to the HA manager, which starts it.')).toBeInTheDocument()
    await userEvent.click(ha)

    await deploy(2)
    expect(posted.ha).toBe(true)
    expect(screen.queryByText(/high availability could not/)).toBeNull()
  })

  it('on local storage the switch is off and explains why', async () => {
    seed({ storages: [{ storage: 'local-lvm', type: 'lvmthin', content: 'images', active: 1, enabled: 1, shared: 0, avail: 0, total: 0 }] })
    renderWithProviders(<DeployWizard open image={linuxImage} onClose={() => {}} />)
    await toHardware()
    expect(screen.getByRole('switch', { name: /Enable high availability/ })).toBeDisabled()
    expect(screen.getByText('Needs shared storage: the selected storage is local to its node.')).toBeInTheDocument()

    await deploy(2)
    expect(posted.ha).toBeUndefined()
  })

  it('an ISO install says the VM stays stopped', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={windowsIso} onClose={() => {}} />)
    await toHardware()
    expect(screen.getByText('The VM is added to the HA manager and stays stopped until you start the installer.')).toBeInTheDocument()
  })

  it('is hidden without node.manage on the connection', async () => {
    rbac.canManageHa = false
    seed()
    renderWithProviders(<DeployWizard open image={linuxImage} onClose={() => {}} />)
    await toHardware()
    expect(screen.queryByRole('switch', { name: /Enable high availability/ })).toBeNull()
  })
})
