import { describe, it, expect } from 'vitest'
import { defaultWizardState, DEFAULT_K3S_OS_IMAGE_URL, DEFAULT_K3S_VERSION, DEFAULT_RKE2_VERSION } from './types'

describe('defaultWizardState', () => {
  it('seeds the wire-contract version and schematic defaults', () => {
    const s = defaultWizardState()
    expect(s.talosVersion).toBe('v1.13.5')
    expect(s.kubernetesVersion).toBe('1.36.2')
    expect(s.schematicId).toBe('376567988ad370138ad8b2698212367b8edcb69b5fd68c80be1f2ec7d603b4ba')
  })

  it('seeds control-plane sizing defaults (2 cores / 4096 MiB / 20 GiB)', () => {
    const s = defaultWizardState()
    expect(s.cpCores).toBe(2)
    expect(s.cpMemory).toBe(4096)
    expect(s.cpDisk).toBe(20)
  })

  it('seeds worker sizing defaults (2 cores / 4096 MiB / 40 GiB)', () => {
    const s = defaultWizardState()
    expect(s.workerCores).toBe(2)
    expect(s.workerMemory).toBe(4096)
    expect(s.workerDisk).toBe(40)
  })

  it('seeds one empty control-plane entry and no workers', () => {
    const s = defaultWizardState()
    expect(s.controlPlane).toEqual([{ ip: '', vmid: 0 }])
    expect(s.workers).toEqual([])
  })

  it('returns a fresh object graph each call (no shared mutable arrays)', () => {
    const a = defaultWizardState()
    const b = defaultWizardState()
    a.controlPlane.push({ ip: '10.0.0.5', vmid: 200 })
    a.dns.push('1.1.1.1')
    expect(b.controlPlane).toHaveLength(1)
    expect(b.dns).toHaveLength(0)
  })

  it('seeds the distro selector with talos and the pinned k3s defaults (spike O6 pins)', () => {
    const s = defaultWizardState()
    expect(s.distro).toBe('talos')
    expect(s.k3sVersion).toBe(DEFAULT_K3S_VERSION)
    expect(s.k3sVersion).toMatch(/^v\d+\.\d+\.\d+\+k3s\d+$/)
    // A dated release, never the `release/` or `current/` alias Ubuntu
    // repoints: the checksum pinned beside it would stop matching.
    expect(s.osImageUrl).toMatch(/\/releases\/noble\/release-\d{8}\/ubuntu-24\.04-server-cloudimg-amd64\.img$/)
    expect(s.osImageChecksum).toMatch(/^[0-9a-f]{64}$/)
    expect(s.snippetDatastore).toBe('')
  })

  it('defaultWizardState pins the rke2 version and reuses the noble image', () => {
    const s = defaultWizardState()
    expect(s.rke2Version).toBe(DEFAULT_RKE2_VERSION)
    expect(s.rke2Version).toMatch(/^v\d+\.\d+\.\d+\+rke2r\d+$/)
    expect(s.osImageUrl).toBe(DEFAULT_K3S_OS_IMAGE_URL)
  })

  it('defaultWizardState pins the kubeadm defaults and reuses the noble image', () => {
    const s = defaultWizardState()
    expect(s.kubeadmVersion).toBe('1.34.9')
    expect(s.cni).toBe('calico')
    // Empty ranges mean the distribution's default.
    expect(s.podCIDR).toBe('')
    expect(s.serviceCIDR).toBe('')
    expect(s.controlPlaneVip).toBe('')
    expect(s.osImageUrl).toBe(DEFAULT_K3S_OS_IMAGE_URL)
  })
})
