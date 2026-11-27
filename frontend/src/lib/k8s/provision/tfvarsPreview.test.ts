import { describe, it, expect } from 'vitest'
import { tfvarsPreview } from './tfvarsPreview'
import type { ProvisionRequest } from '@/lib/k8s/provisionOrchestrator'

const req: ProvisionRequest = {
  distro: 'talos',
  clusterName: 'demo',
  connectionId: 'conn-1',
  pveNode: 'pve1',
  imageDatastore: 'local',
  vmDatastore: 'local-lvm',
  bridge: 'vmbr0',
  vlan: 0,
  subnetPrefix: 24,
  gateway: '10.0.0.1',
  dns: ['1.1.1.1'],
  talosVersion: 'v1.13.5',
  kubernetesVersion: '1.36.2',
  schematicId: '376567988ad370138ad8b2698212367b8edcb69b5fd68c80be1f2ec7d603b4ba',
  controlPlane: [{ name: 'demo-cp-1', ip: '10.0.0.10', vmid: 100 }],
  workers: [],
  cpCores: 2,
  cpMemory: 4096,
  cpDisk: 20,
  workerCores: 2,
  workerMemory: 4096,
  workerDisk: 40,
}

describe('tfvarsPreview', () => {
  it('renders stable, pretty-printed JSON matching the request field order', () => {
    const out = tfvarsPreview(req)
    expect(out).toBe(JSON.stringify(req, null, 2))
    expect(out.split('\n')[0]).toBe('{')
    expect(out).toContain('"clusterName": "demo"')
  })

  it('is deterministic across repeated calls', () => {
    expect(tfvarsPreview(req)).toBe(tfvarsPreview(req))
  })

  it('never emits HCL-style tokens', () => {
    const out = tfvarsPreview(req)
    expect(out).not.toMatch(/=\s*{/)
    expect(out).not.toContain('resource "')
  })

  it('renders the distro and k3s fields of a k3s request', () => {
    const preview = tfvarsPreview({
      distro: 'k3s',
      clusterName: 'demo',
      connectionId: 'conn-1',
      pveNode: 'pve1',
      imageDatastore: 'local',
      vmDatastore: 'local-lvm',
      bridge: 'vmbr0',
      vlan: 0,
      subnetPrefix: 24,
      gateway: '10.0.0.1',
      dns: ['1.1.1.1'],
      k3sVersion: 'v1.36.2+k3s1',
      osImageUrl: 'https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img',
      osImageChecksum: '5fa5b05e5ec239858c4531485d6023b0896448c2df7c63b34f8dae6ea6051a44',
      snippetDatastore: 'local',
      controlPlane: [{ name: 'demo-cp-1', ip: '10.0.0.10', vmid: 100 }],
      workers: [],
      cpCores: 2,
      cpMemory: 4096,
      cpDisk: 20,
      workerCores: 2,
      workerMemory: 4096,
      workerDisk: 40,
    })
    expect(preview).toContain('"distro": "k3s"')
    expect(preview).toContain('"snippetDatastore": "local"')
    expect(preview).not.toContain('talosVersion')
  })
})
