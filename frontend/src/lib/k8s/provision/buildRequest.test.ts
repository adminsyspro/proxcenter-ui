import { describe, it, expect } from 'vitest'
import { buildProvisionRequest } from './buildRequest'
import type { WizardState } from './types'

function baseState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    clusterName: 'demo',
    connectionId: 'conn-1',
    pveNode: 'pve1',
    imageDatastore: 'local',
    vmDatastore: 'local-lvm',
    bridge: 'vmbr0',
    vlan: 10,
    subnetPrefix: 24,
    gateway: '10.0.0.1',
    dns: ['1.1.1.1', '8.8.8.8'],
    talosVersion: 'v1.13.5',
    kubernetesVersion: '1.36.2',
    schematicId: 'schema-abc',
    distro: 'talos',
    k3sVersion: 'v1.36.2+k3s1',
    osImageUrl: 'https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img',
    osImageChecksum: '5fa5b05e5ec239858c4531485d6023b0896448c2df7c63b34f8dae6ea6051a44',
    snippetDatastore: 'local',
    rke2Version: 'v1.35.6+rke2r1',
    kubeadmVersion: '1.34.9',
    cni: 'calico',
    controlPlaneVip: '',
    podCIDR: '',
    serviceCIDR: '',
    controlPlane: [
      { ip: '10.0.0.10', vmid: 100 },
      { ip: '10.0.0.11', vmid: 101 },
      { ip: '10.0.0.12', vmid: 102 },
    ],
    workers: [
      { ip: '10.0.0.20', vmid: 200 },
      { ip: '10.0.0.21', vmid: 201 },
    ],
    cpCores: 2,
    cpMemory: 4096,
    cpDisk: 20,
    workerCores: 4,
    workerMemory: 8192,
    workerDisk: 40,
    ...overrides,
  }
}

describe('buildProvisionRequest', () => {
  it('derives control-plane and worker names from clusterName + role + 1-based index', () => {
    const req = buildProvisionRequest(baseState())
    expect(req.controlPlane.map(n => n.name)).toEqual(['demo-cp-1', 'demo-cp-2', 'demo-cp-3'])
    expect(req.workers.map(n => n.name)).toEqual(['demo-worker-1', 'demo-worker-2'])
  })

  it('carries ip and vmid from the state arrays through unchanged, in order', () => {
    const req = buildProvisionRequest(baseState())
    expect(req.controlPlane).toEqual([
      { name: 'demo-cp-1', ip: '10.0.0.10', vmid: 100 },
      { name: 'demo-cp-2', ip: '10.0.0.11', vmid: 101 },
      { name: 'demo-cp-3', ip: '10.0.0.12', vmid: 102 },
    ])
    expect(req.workers).toEqual([
      { name: 'demo-worker-1', ip: '10.0.0.20', vmid: 200 },
      { name: 'demo-worker-2', ip: '10.0.0.21', vmid: 201 },
    ])
  })

  it('maps every scalar field with camelCase wire-contract keys', () => {
    const req = buildProvisionRequest(baseState())
    expect(req).toMatchObject({
      clusterName: 'demo',
      connectionId: 'conn-1',
      pveNode: 'pve1',
      imageDatastore: 'local',
      vmDatastore: 'local-lvm',
      bridge: 'vmbr0',
      vlan: 10,
      subnetPrefix: 24,
      gateway: '10.0.0.1',
      dns: ['1.1.1.1', '8.8.8.8'],
      talosVersion: 'v1.13.5',
      kubernetesVersion: '1.36.2',
      schematicId: 'schema-abc',
      cpCores: 2,
      cpMemory: 4096,
      cpDisk: 20,
      workerCores: 4,
      workerMemory: 8192,
      workerDisk: 40,
    })
  })

  it('re-derives names when clusterName changes (names are never read from state)', () => {
    const req = buildProvisionRequest(
      baseState({ clusterName: 'other', controlPlane: [{ ip: '10.0.0.10', vmid: 100 }] }),
    )
    expect(req.controlPlane[0].name).toBe('other-cp-1')
  })

  it('handles an empty workers array', () => {
    const req = buildProvisionRequest(baseState({ workers: [] }))
    expect(req.workers).toEqual([])
  })

  it('handles a single control-plane node', () => {
    const req = buildProvisionRequest(baseState({ controlPlane: [{ ip: '10.0.0.10', vmid: 100 }] }))
    expect(req.controlPlane).toEqual([{ name: 'demo-cp-1', ip: '10.0.0.10', vmid: 100 }])
  })

  it('talos: carries distro and the talos fields, and omits every k3s field', () => {
    const req = buildProvisionRequest(baseState())
    expect(req.distro).toBe('talos')
    expect(req.talosVersion).toBe('v1.13.5')
    expect(req.kubernetesVersion).toBe('1.36.2')
    expect(req.schematicId).toBe('schema-abc')
    expect(req.k3sVersion).toBeUndefined()
    expect(req.osImageUrl).toBeUndefined()
    expect(req.osImageChecksum).toBeUndefined()
    expect(req.snippetDatastore).toBeUndefined()
  })

  it('k3s: carries distro and the k3s fields, and omits every talos field', () => {
    const req = buildProvisionRequest(baseState({ distro: 'k3s' }))
    expect(req.distro).toBe('k3s')
    expect(req.k3sVersion).toBe('v1.36.2+k3s1')
    expect(req.osImageUrl).toBe(
      'https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img',
    )
    expect(req.osImageChecksum).toBe(
      '5fa5b05e5ec239858c4531485d6023b0896448c2df7c63b34f8dae6ea6051a44',
    )
    expect(req.snippetDatastore).toBe('local')
    expect(req.talosVersion).toBeUndefined()
    expect(req.kubernetesVersion).toBeUndefined()
    expect(req.schematicId).toBeUndefined()
  })

  it('sends only rke2 fields when distro is rke2', () => {
    const req = buildProvisionRequest(baseState({
      distro: 'rke2',
      clusterName: 'r',
      rke2Version: 'v1.35.6+rke2r1',
      snippetDatastore: 'local',
      controlPlane: [{ ip: '10.0.0.5', vmid: 9001 }],
    }))
    expect(req.distro).toBe('rke2')
    expect(req.rke2Version).toBe('v1.35.6+rke2r1')
    expect(req.snippetDatastore).toBe('local')
    expect(req.talosVersion).toBeUndefined()
    expect(req.k3sVersion).toBeUndefined()
  })

  it('k3s: shared fields and derived node names are identical to the talos mapping', () => {
    const req = buildProvisionRequest(baseState({ distro: 'k3s' }))
    expect(req.controlPlane.map(n => n.name)).toEqual(['demo-cp-1', 'demo-cp-2', 'demo-cp-3'])
    expect(req).toMatchObject({ clusterName: 'demo', vlan: 10, gateway: '10.0.0.1' })
  })

  it('sends only kubeadm fields when distro is kubeadm', () => {
    const req = buildProvisionRequest({
      ...baseState(),
      distro: 'kubeadm',
      clusterName: 'vanilla',
      kubeadmVersion: '1.36.2',
      cni: 'cilium',
      controlPlaneVip: '10.0.0.100',
      podCIDR: '10.245.0.0/16',
      snippetDatastore: 'local',
      controlPlane: [{ ip: '10.0.0.5', vmid: 9001 }],
    })
    expect(req.distro).toBe('kubeadm')
    expect(req.kubeadmVersion).toBe('1.36.2')
    expect(req.cni).toBe('cilium')
    expect(req.controlPlaneVip).toBe('10.0.0.100')
    expect(req.podCIDR).toBe('10.245.0.0/16')
    expect(req.snippetDatastore).toBe('local')
    expect(req.osImageUrl).toBeTruthy()
    expect(req.talosVersion).toBeUndefined()
    expect(req.k3sVersion).toBeUndefined()
    expect(req.rke2Version).toBeUndefined()
  })

  it('sends the pod and service ranges that were typed, for the distributions that take them', () => {
    const k3s = buildProvisionRequest({ ...baseState(), distro: 'k3s', podCIDR: ' 10.244.0.0/16 ', serviceCIDR: '10.96.0.0/16' })
    expect([k3s.podCIDR, k3s.serviceCIDR]).toEqual(['10.244.0.0/16', '10.96.0.0/16'])

    const defaults = buildProvisionRequest({ ...baseState(), distro: 'rke2', podCIDR: '', serviceCIDR: '' })
    expect('podCIDR' in defaults || 'serviceCIDR' in defaults).toBe(false)

    const talos = buildProvisionRequest({ ...baseState(), distro: 'talos', podCIDR: '10.50.0.0/16', serviceCIDR: '10.60.0.0/16' })
    expect('podCIDR' in talos || 'serviceCIDR' in talos).toBe(false)
  })
})
