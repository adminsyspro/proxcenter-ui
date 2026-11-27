import { describe, it, expect } from 'vitest'
import { distroLogo } from './distros'

describe('distroLogo', () => {
  it('maps known deploy distros to their dedicated logo', () => {
    expect(distroLogo('talos')).toBe('/images/talos-logo.webp')
    expect(distroLogo('k3s')).toBe('/images/k3s-logo.png')
    expect(distroLogo('rke2')).toBe('/images/rke2-logo.svg')
  })

  it('falls back to the vanilla Kubernetes mark for kubeadm/generic/unknown/unset', () => {
    expect(distroLogo('kubeadm')).toBe('/images/kubernetes-logo.svg')
    expect(distroLogo('generic')).toBe('/images/kubernetes-logo.svg')
    expect(distroLogo('other')).toBe('/images/kubernetes-logo.svg')
    expect(distroLogo(undefined)).toBe('/images/kubernetes-logo.svg')
    expect(distroLogo(null)).toBe('/images/kubernetes-logo.svg')
  })
})
