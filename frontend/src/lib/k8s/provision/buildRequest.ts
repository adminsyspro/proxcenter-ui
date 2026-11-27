// src/lib/k8s/provision/buildRequest.ts
// Maps the wizard's WizardState to the exact multi-distro ProvisionRequest wire shape
// (see @/lib/k8s/provisionOrchestrator). Node names are derived here, not
// stored in WizardState, so they always track the current clusterName.

import type { ProvisionRequest, ProvisionNodeSpec } from '@/lib/k8s/provisionOrchestrator'
import type { WizardState, WizardNodeAddr } from './types'
import { rangesConfigurable } from './networks'

function toNodeSpecs(nodesIn: WizardNodeAddr[], clusterName: string, role: 'cp' | 'worker'): ProvisionNodeSpec[] {
  return nodesIn.map((n, i) => ({
    name: `${clusterName}-${role}-${i + 1}`,
    ip: n.ip,
    vmid: n.vmid,
  }))
}

export function buildProvisionRequest(state: WizardState): ProvisionRequest {
  const req: ProvisionRequest = {
    distro: state.distro,
    clusterName: state.clusterName,
    connectionId: state.connectionId,
    pveNode: state.pveNode,
    imageDatastore: state.imageDatastore,
    vmDatastore: state.vmDatastore,
    bridge: state.bridge,
    vlan: state.vlan,
    subnetPrefix: state.subnetPrefix,
    gateway: state.gateway,
    dns: state.dns,
    controlPlane: toNodeSpecs(state.controlPlane, state.clusterName, 'cp'),
    workers: toNodeSpecs(state.workers, state.clusterName, 'worker'),
    cpCores: state.cpCores,
    cpMemory: state.cpMemory,
    cpDisk: state.cpDisk,
    workerCores: state.workerCores,
    workerMemory: state.workerMemory,
    workerDisk: state.workerDisk,
  }

  // Only the ACTIVE distro's flat fields go on the wire; the inactive
  // distro's wizard fields (kept in state so switching back is lossless)
  // are never sent. Unknown distro values fall through to the talos shape;
  // validateProvision blocks submission before that can matter.
  if (state.distro === 'k3s') {
    req.k3sVersion = state.k3sVersion
    req.osImageUrl = state.osImageUrl
    req.osImageChecksum = state.osImageChecksum
    req.snippetDatastore = state.snippetDatastore
  } else if (state.distro === 'rke2') {
    req.rke2Version = state.rke2Version
    req.osImageUrl = state.osImageUrl
    req.osImageChecksum = state.osImageChecksum
    req.snippetDatastore = state.snippetDatastore
  } else if (state.distro === 'kubeadm') {
    req.kubeadmVersion = state.kubeadmVersion
    req.cni = state.cni
    req.controlPlaneVip = state.controlPlaneVip
    req.osImageUrl = state.osImageUrl
    req.osImageChecksum = state.osImageChecksum
    req.snippetDatastore = state.snippetDatastore
  } else {
    req.talosVersion = state.talosVersion
    req.kubernetesVersion = state.kubernetesVersion
    req.schematicId = state.schematicId
  }

  if (rangesConfigurable(state.distro)) {
    if (state.podCIDR.trim()) req.podCIDR = state.podCIDR.trim()
    if (state.serviceCIDR.trim()) req.serviceCIDR = state.serviceCIDR.trim()
  }

  return req
}
