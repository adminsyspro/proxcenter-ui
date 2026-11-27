// src/lib/k8s/provision/types.ts
// WizardState is the deploy wizard's form model (FT6 owns the JSX; this
// module owns the shape + defaults so the wizard and buildRequest/validate
// stay in sync). Node names are DERIVED in buildRequest from clusterName +
// role + index, so they are intentionally not part of this shape.

export interface WizardNodeAddr {
  ip: string
  vmid: number
}

export interface WizardState {
  clusterName: string
  connectionId: string
  pveNode: string
  imageDatastore: string
  vmDatastore: string
  bridge: string
  vlan: number
  subnetPrefix: number
  gateway: string
  dns: string[]
  talosVersion: string
  kubernetesVersion: string
  schematicId: string
  // Distro selector. A plain string plus flat per-distro fields: the repo
  // tsconfig has strict:false, where discriminated-union narrowing is
  // unreliable, so we deliberately do NOT model this as a union.
  distro: string
  // k3s-only fields (ignored when distro === 'talos')
  k3sVersion: string
  osImageUrl: string
  osImageChecksum: string
  snippetDatastore: string
  // rke2-only field (ignored unless distro === 'rke2'); reuses the k3s
  // osImageUrl/osImageChecksum/snippetDatastore fields.
  rke2Version: string
  // kubeadm-only fields (ignored unless distro === 'kubeadm'); reuses the
  // k3s osImageUrl/osImageChecksum/snippetDatastore fields. controlPlaneVip
  // is a dedicated free IP in the node subnet, advertised by kube-vip as
  // the HA API endpoint; cni selects the explicitly installed CNI (kubeadm
  // ships none).
  kubeadmVersion: string
  cni: string
  controlPlaneVip: string
  // Pod and service ranges; empty means the distribution's default
  // (see ./networks). Not sent for Talos, which keeps its own.
  podCIDR: string
  serviceCIDR: string
  controlPlane: WizardNodeAddr[]
  workers: WizardNodeAddr[]
  cpCores: number
  cpMemory: number
  cpDisk: number
  workerCores: number
  workerMemory: number
  workerDisk: number
}

// Defaults mirrored from wire-contract.md ("DEFAULTS the FRONTEND must
// supply"). The backend requires these non-empty but does not default them.
export const DEFAULT_TALOS_VERSION = 'v1.13.5'
export const DEFAULT_KUBERNETES_VERSION = '1.36.2'
export const DEFAULT_SCHEMATIC_ID = '376567988ad370138ad8b2698212367b8edcb69b5fd68c80be1f2ec7d603b4ba'

export const DEFAULT_DISTRO = 'talos'

// Ubuntu 24.04 cloud image of the cloud-init distributions, with its sha256.
// The URL names a DATED release: `release/` and `current/` are aliases Ubuntu
// repoints at every new build, so a checksum pinned next to them stops
// matching and every deployment with the defaults fails at the download.
// Update the two together.
export const DEFAULT_K3S_VERSION = 'v1.37.2+k3s1'
export const DEFAULT_K3S_OS_IMAGE_URL =
  'https://cloud-images.ubuntu.com/releases/noble/release-20261017/ubuntu-24.04-server-cloudimg-amd64.img'
export const DEFAULT_K3S_OS_IMAGE_CHECKSUM =
  '04e8f2461a16a44e78a370284471f29616cdd9baf1893df25807b71f985b6c94'

// rke2 default pinned by the 2026-07-04 acceptance spike (stable channel).
export const DEFAULT_RKE2_VERSION = 'v1.36.6+rke2r1'

// kubeadm defaults. Version pinned by the kubeadm acceptance spike (see the
// k8s-kubeadm-spike plan RESULTS); image = same noble pin as k3s/rke2.
// CNI and pod CIDR are locked product defaults (spec section 2).
export const DEFAULT_KUBEADM_VERSION = '1.34.9'
export const DEFAULT_CNI = 'calico'

// Sizing defaults (wizard slider initial values). CP defaults double as the
// backfill values validateProvision uses to mirror the backend's
// orDefault(v, def) rule for control-plane sizing.
export const DEFAULT_CP_CORES = 2
export const DEFAULT_CP_MEMORY = 4096
export const DEFAULT_CP_DISK = 20
export const DEFAULT_WORKER_CORES = 2
export const DEFAULT_WORKER_MEMORY = 4096
export const DEFAULT_WORKER_DISK = 40

// Sizing floors (both roles) from wire-contract.md. Shared by validate.ts
// (backend Validate() mirror) and the wizard's sliders (SizeSlider min prop).
export const MIN_CORES = 1
export const MIN_MEMORY = 2048 // MiB
export const MIN_DISK = 10 // GiB

export function defaultWizardState(): WizardState {
  return {
    clusterName: '',
    connectionId: '',
    pveNode: '',
    imageDatastore: '',
    vmDatastore: '',
    bridge: '',
    vlan: 0,
    subnetPrefix: 24,
    gateway: '',
    dns: [],
    talosVersion: DEFAULT_TALOS_VERSION,
    kubernetesVersion: DEFAULT_KUBERNETES_VERSION,
    schematicId: DEFAULT_SCHEMATIC_ID,
    distro: DEFAULT_DISTRO,
    k3sVersion: DEFAULT_K3S_VERSION,
    osImageUrl: DEFAULT_K3S_OS_IMAGE_URL,
    osImageChecksum: DEFAULT_K3S_OS_IMAGE_CHECKSUM,
    snippetDatastore: '',
    rke2Version: DEFAULT_RKE2_VERSION,
    kubeadmVersion: DEFAULT_KUBEADM_VERSION,
    cni: DEFAULT_CNI,
    controlPlaneVip: '',
    podCIDR: '',
    serviceCIDR: '',
    controlPlane: [{ ip: '', vmid: 0 }],
    workers: [],
    cpCores: DEFAULT_CP_CORES,
    cpMemory: DEFAULT_CP_MEMORY,
    cpDisk: DEFAULT_CP_DISK,
    workerCores: DEFAULT_WORKER_CORES,
    workerMemory: DEFAULT_WORKER_MEMORY,
    workerDisk: DEFAULT_WORKER_DISK,
  }
}
