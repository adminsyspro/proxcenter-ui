import { describe, it, expect } from 'vitest'
import { createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import { validateProvision as validateIssues } from './validate'

// The wizard shows each issue through the English messages; the assertions
// below read the same text.
const tr = createTranslator({ locale: 'en', messages: en, namespace: 'kubernetes.provision.validation' })
const validateProvision = (state: Parameters<typeof validateIssues>[0]): string[] =>
  validateIssues(state).map(i => tr(i.key as any, i.values as any))
import { defaultWizardState } from './types'
import type { WizardState, WizardNodeAddr } from './types'

function validState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    clusterName: 'demo-cluster',
    connectionId: 'conn-1',
    pveNode: 'pve1',
    imageDatastore: 'local',
    vmDatastore: 'local-lvm',
    bridge: 'vmbr0',
    vlan: 10,
    subnetPrefix: 24,
    gateway: '10.0.0.1',
    dns: ['1.1.1.1'],
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
    workerCores: 2,
    workerMemory: 4096,
    workerDisk: 40,
    ...overrides,
  }
}

function k3sState(overrides: Partial<WizardState> = {}): WizardState {
  // Valid k3s state: talos-only fields empty ON PURPOSE (they must not be
  // required when distro === 'k3s').
  return validState({
    distro: 'k3s',
    talosVersion: '',
    kubernetesVersion: '',
    schematicId: '',
    ...overrides,
  })
}

function nodes(...pairs: Array<[string, number]>): WizardNodeAddr[] {
  return pairs.map(([ip, vmid]) => ({ ip, vmid }))
}

describe('validateProvision: happy path', () => {
  it('returns [] for a valid 3-CP + 2-worker request', () => {
    expect(validateProvision(validState())).toEqual([])
  })

  it('returns [] for a valid single control-plane node with no workers', () => {
    const state = validState({ controlPlane: nodes(['10.0.0.10', 100]), workers: [] })
    expect(validateProvision(state)).toEqual([])
  })
})

describe('validateProvision: required fields', () => {
  const requiredStringFields: Array<[keyof WizardState, RegExp]> = [
    ['clusterName', /cluster name/i],
    ['connectionId', /connection/i],
    ['pveNode', /node/i],
    ['imageDatastore', /image datastore/i],
    ['vmDatastore', /vm datastore/i],
    ['bridge', /bridge/i],
    ['gateway', /gateway/i],
    ['talosVersion', /talos/i],
    ['kubernetesVersion', /kubernetes/i],
    ['schematicId', /schematic/i],
  ]

  it.each(requiredStringFields)('rejects an empty %s with a matching message', (field, re) => {
    const errors = validateProvision(validState({ [field]: '' } as Partial<WizardState>))
    expect(errors.some(e => re.test(e) && /required/i.test(e))).toBe(true)
  })

  it('rejects an empty dns list', () => {
    const errors = validateProvision(validState({ dns: [] }))
    expect(errors.some(e => /dns/i.test(e))).toBe(true)
  })
})

describe('validateProvision: cluster name (DNS-1123)', () => {
  it.each(['', 'UPPER', '-bad-start', 'bad-end-', 'has_underscore', 'a'.repeat(64)])(
    'rejects invalid clusterName %j with a cluster-name message',
    bad => {
      const errors = validateProvision(validState({ clusterName: bad }))
      expect(errors.some(e => /cluster name/i.test(e))).toBe(true)
    },
  )

  it.each(['demo', 'demo-cluster', 'a', 'a1-b2', 'x'.repeat(63)])(
    'accepts valid clusterName %j',
    good => {
      const errors = validateProvision(validState({ clusterName: good }))
      expect(errors.some(e => /cluster name/i.test(e))).toBe(false)
    },
  )
})

describe('validateProvision: control-plane count', () => {
  it.each([2, 4])('rejects an even control-plane count of %i', count => {
    const cp = Array.from({ length: count }, (_, i) => ({ ip: `10.0.0.${10 + i}`, vmid: 100 + i }))
    const errors = validateProvision(validState({ controlPlane: cp }))
    expect(errors.some(e => /control-plane/i.test(e) && /odd/i.test(e))).toBe(true)
  })

  it.each([1, 3, 5])('accepts a control-plane count of %i', count => {
    const cp = Array.from({ length: count }, (_, i) => ({ ip: `10.0.0.${10 + i}`, vmid: 100 + i }))
    const errors = validateProvision(validState({ controlPlane: cp, workers: [] }))
    expect(errors).toEqual([])
  })

  it('rejects zero control-plane nodes', () => {
    const errors = validateProvision(validState({ controlPlane: [] }))
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('validateProvision: sizing floors', () => {
  // Backend backfills omitted (zero) CP fields with the CP DEFAULTS before the
  // floor check, so a zero CP field is ACCEPTED (the default is substituted).
  it.each([
    ['cpCores', 0],
    ['cpMemory', 0],
    ['cpDisk', 0],
  ] as const)('accepts a zero control-plane %s (backfilled with the CP default)', (field, value) => {
    const errors = validateProvision(validState({ [field]: value } as Partial<WizardState>))
    expect(errors).toEqual([])
  })

  // An explicit POSITIVE value below the floor is still rejected (no backfill).
  it.each([
    ['cpMemory', 1000, /control-plane/i, /memory/i],
    ['cpMemory', 2047, /control-plane/i, /memory/i],
    ['cpDisk', 5, /control-plane/i, /disk/i],
    ['cpDisk', 9, /control-plane/i, /disk/i],
  ] as const)(
    'rejects an explicit positive control-plane %s below the floor (%i)',
    (field, value, roleRe, resourceRe) => {
      const errors = validateProvision(validState({ [field]: value } as Partial<WizardState>))
      expect(errors.some(e => roleRe.test(e) && resourceRe.test(e))).toBe(true)
    },
  )

  it.each([
    ['workerCores', 0, /worker/i, /cores/i],
    ['workerMemory', 1024, /worker/i, /memory/i],
    ['workerDisk', 5, /worker/i, /disk/i],
  ] as const)(
    'rejects worker %s below the floor when workers are present',
    (field, value, roleRe, resourceRe) => {
      const errors = validateProvision(validState({ [field]: value } as Partial<WizardState>))
      expect(errors.some(e => roleRe.test(e) && resourceRe.test(e))).toBe(true)
    },
  )

  it('rejects a zero worker cores value when workers are present (raw, no backfill)', () => {
    const errors = validateProvision(validState({ workerCores: 0 }))
    expect(errors.some(e => /worker/i.test(e) && /cores/i.test(e))).toBe(true)
  })

  it('does NOT check worker sizing floors when there are no workers', () => {
    const errors = validateProvision(
      validState({ workers: [], workerCores: 0, workerMemory: 0, workerDisk: 0 }),
    )
    expect(errors).toEqual([])
  })

  it('accepts sizing exactly at the floor', () => {
    const errors = validateProvision(
      validState({ cpCores: 1, cpMemory: 2048, cpDisk: 10, workerCores: 1, workerMemory: 2048, workerDisk: 10 }),
    )
    expect(errors).toEqual([])
  })
})

describe('validateProvision: node addressing', () => {
  it('rejects a duplicate IP across control-plane and worker nodes', () => {
    const errors = validateProvision(
      validState({
        controlPlane: nodes(['10.0.0.10', 100], ['10.0.0.20', 101]),
        workers: nodes(['10.0.0.20', 200]),
      }),
    )
    expect(errors.some(e => /ip/i.test(e) && /unique|duplicate/i.test(e))).toBe(true)
  })

  it('rejects a duplicate vmid across control-plane and worker nodes', () => {
    const errors = validateProvision(
      validState({
        controlPlane: nodes(['10.0.0.10', 100], ['10.0.0.11', 101]),
        workers: nodes(['10.0.0.20', 100]),
      }),
    )
    expect(errors.some(e => /vmid/i.test(e) && /unique|duplicate/i.test(e))).toBe(true)
  })

  it('rejects a node IP equal to the gateway', () => {
    const errors = validateProvision(
      validState({ controlPlane: nodes(['10.0.0.1', 100]), workers: [] }),
    )
    expect(errors.some(e => /gateway/i.test(e))).toBe(true)
  })

  it('rejects a missing (empty) node IP', () => {
    const errors = validateProvision(validState({ controlPlane: nodes(['', 100]), workers: [] }))
    expect(errors.length).toBeGreaterThan(0)
  })

  it.each(['not-an-ip', '999.1.1.1', '1.2.3', '1.2.3.4.5', '10.0.0.01'])(
    'rejects a syntactically invalid IPv4 address %j',
    bad => {
      const errors = validateProvision(validState({ controlPlane: nodes([bad, 100]), workers: [] }))
      expect(errors.some(e => /ip/i.test(e))).toBe(true)
    },
  )
})

describe('validateProvision: distro dispatch', () => {
  it('returns [] for a valid k3s state with empty talos fields', () => {
    expect(validateProvision(k3sState())).toEqual([])
  })

  it('does not require k3s fields for a talos state', () => {
    const errors = validateProvision(
      validState({ k3sVersion: '', osImageUrl: '', osImageChecksum: '', snippetDatastore: '' }),
    )
    expect(errors).toEqual([])
  })

  it.each([
    ['k3sVersion', /k3s version/i],
    ['snippetDatastore', /snippet datastore/i],
    ['osImageUrl', /image url/i],
    ['osImageChecksum', /image checksum/i],
  ] as const)('k3s: rejects an empty %s', (field, re) => {
    const errors = validateProvision(k3sState({ [field]: '' } as Partial<WizardState>))
    expect(errors.some(e => re.test(e) && /required/i.test(e))).toBe(true)
  })

  it.each(['not-hex', 'abc123', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])(
    'k3s: rejects a malformed sha256 checksum %j',
    bad => {
      const errors = validateProvision(k3sState({ osImageChecksum: bad }))
      expect(errors.some(e => /checksum/i.test(e) && /sha-256/i.test(e))).toBe(true)
    },
  )

  it('k3s: accepts an uppercase sha256 checksum', () => {
    const errors = validateProvision(k3sState({ osImageChecksum: 'A'.repeat(64) }))
    expect(errors.some(e => /checksum/i.test(e))).toBe(false)
  })

  it('accepts a valid rke2 state', () => {
    const s = {
      ...defaultWizardState(),
      distro: 'rke2',
      clusterName: 'r',
      connectionId: 'c',
      pveNode: 'n',
      imageDatastore: 'l',
      vmDatastore: 'd',
      bridge: 'vmbr1',
      gateway: '10.0.0.1',
      dns: ['1.1.1.1'],
      snippetDatastore: 'local',
      controlPlane: [{ ip: '10.0.0.5', vmid: 9001 }],
    }
    expect(validateProvision(s)).toEqual([])
  })

  it('rejects rke2 without a version or snippet datastore', () => {
    const s = {
      ...defaultWizardState(),
      distro: 'rke2',
      clusterName: 'r',
      connectionId: 'c',
      pveNode: 'n',
      imageDatastore: 'l',
      vmDatastore: 'd',
      bridge: 'vmbr1',
      gateway: '10.0.0.1',
      dns: ['1.1.1.1'],
      rke2Version: '',
      snippetDatastore: '',
      controlPlane: [{ ip: '10.0.0.5', vmid: 9001 }],
    }
    const errs = validateProvision(s)
    expect(errs).toContain('rke2 version is required')
    expect(errs).toContain('Snippet datastore is required')
  })

  it.each(['', 'nonsense'])(
    'rejects distro %j with a distribution-selection message',
    bad => {
      const errors = validateProvision(validState({ distro: bad }))
      expect(errors.some(e => /distribution/i.test(e))).toBe(true)
    },
  )

  it('k3s: shared checks still apply (duplicate IP still rejected)', () => {
    const errors = validateProvision(
      k3sState({
        controlPlane: nodes(['10.0.0.10', 100], ['10.0.0.10', 101], ['10.0.0.12', 102]),
      }),
    )
    expect(errors.some(e => /ip/i.test(e) && /unique/i.test(e))).toBe(true)
  })
})

describe('validateProvision: kubeadm', () => {
  function validKubeadmState(): WizardState {
    return {
      ...defaultWizardState(),
      distro: 'kubeadm',
      clusterName: 'vanilla',
      connectionId: 'c',
      pveNode: 'n',
      imageDatastore: 'l',
      vmDatastore: 'd',
      bridge: 'vmbr1',
      gateway: '10.0.0.1',
      dns: ['1.1.1.1'],
      snippetDatastore: 'local',
      controlPlaneVip: '10.0.0.100',
      controlPlane: [
        { ip: '10.0.0.5', vmid: 9001 },
        { ip: '10.0.0.6', vmid: 9002 },
        { ip: '10.0.0.7', vmid: 9003 },
      ],
    }
  }

  it('accepts a valid kubeadm state (calico default)', () => {
    expect(validateProvision(validKubeadmState())).toEqual([])
  })

  it('accepts cilium', () => {
    expect(validateProvision({ ...validKubeadmState(), cni: 'cilium' })).toEqual([])
  })

  it('accepts an empty cni (the backend defaults it to calico)', () => {
    expect(validateProvision({ ...validKubeadmState(), cni: '' })).toEqual([])
  })

  it('rejects kubeadm without a version, an unknown cni, and a missing vip', () => {
    const errs = validateProvision({ ...validKubeadmState(), kubeadmVersion: '', cni: 'flannel', controlPlaneVip: '' })
    expect(errs).toContain('Kubernetes version is required')
    expect(errs).toContain('CNI must be Calico or Cilium')
    expect(errs).toContain('Control-plane VIP is required')
  })

  it.each(['v1.34.9', 'V1.34.9'])('rejects a v-prefixed kubeadm version %j', bad => {
    const errs = validateProvision({ ...validKubeadmState(), kubeadmVersion: bad })
    expect(errs).toContain('Kubernetes version must not start with "v" (e.g. 1.34.9)')
  })

  it('rejects a malformed vip and a malformed pod CIDR', () => {
    const errs = validateProvision({ ...validKubeadmState(), controlPlaneVip: '10.0.0.999', podCIDR: '10.244.0.0' })
    expect(errs).toContain('Control-plane VIP must be a valid IPv4 address')
    expect(errs).toContain('Pod network CIDR must be a valid IPv4 CIDR (e.g. 10.244.0.0/16)')
  })

  it('accepts an empty pod CIDR: the distribution default applies', () => {
    expect(validateProvision({ ...validKubeadmState(), podCIDR: '' })).toEqual([])
  })

  it('rejects a pod range that covers the node network, and one that overlaps the service range', () => {
    const state = validKubeadmState()
    const nodeIp = state.controlPlane[0].ip
    const nodeNet = nodeIp.split('.').slice(0, 3).join('.') + '.0/24'
    expect(validateProvision({ ...state, subnetPrefix: 24, podCIDR: nodeNet })).toContain(`Pod network ${nodeNet} overlaps the node network ${nodeNet}`)
    expect(validateProvision({ ...state, podCIDR: '10.96.0.0/9' })).toContain('Pod and service networks overlap')
  })

  it('rejects a malformed service CIDR', () => {
    expect(validateProvision({ ...validKubeadmState(), serviceCIDR: '10.96.0.0' })).toContain('Service network CIDR must be a valid IPv4 CIDR (e.g. 10.244.0.0/16)')
  })

  it.each(['10.244.0.0/33', '10.244.0.0/333', '10.244.0.0/x', '10.244.0.0/08', '10.244.0.999/16', '10.244.0.0/16/24'])(
    'rejects a malformed pod CIDR %j',
    bad => {
      const errs = validateProvision({ ...validKubeadmState(), podCIDR: bad })
      expect(errs).toContain('Pod network CIDR must be a valid IPv4 CIDR (e.g. 10.244.0.0/16)')
    },
  )

  it.each(['10.244.0.0/16', '172.20.0.0/14', '192.168.128.0/24', '100.64.0.0/10'])(
    'accepts a well-formed pod CIDR %j',
    good => {
      expect(validateProvision({ ...validKubeadmState(), podCIDR: good })).toEqual([])
    },
  )

  it('rejects a vip that collides with the gateway or a node IP', () => {
    expect(validateProvision({ ...validKubeadmState(), controlPlaneVip: '10.0.0.1' })).toContain(
      'Control-plane VIP cannot be the same as the gateway',
    )
    expect(validateProvision({ ...validKubeadmState(), controlPlaneVip: '10.0.0.6' })).toContain(
      'Control-plane VIP cannot be one of the node IP addresses',
    )
  })

  it('rejects a vip that collides with a worker IP', () => {
    const errs = validateProvision({
      ...validKubeadmState(),
      workers: [{ ip: '10.0.0.50', vmid: 9050 }],
      controlPlaneVip: '10.0.0.50',
    })
    expect(errs).toContain('Control-plane VIP cannot be one of the node IP addresses')
  })

  it('kubeadm still requires the shared cloud-image fields', () => {
    const errs = validateProvision({ ...validKubeadmState(), snippetDatastore: '', osImageChecksum: 'nope' })
    expect(errs).toContain('Snippet datastore is required')
    expect(errs).toContain('OS image checksum must be a 64-character SHA-256 hex string')
  })

  it('kubeadm still requires the OS image URL', () => {
    const errs = validateProvision({ ...validKubeadmState(), osImageUrl: '', osImageChecksum: '' })
    expect(errs).toContain('OS image URL is required')
    expect(errs).toContain('OS image checksum is required')
  })

  it('kubeadm still rejects an even control-plane count (shared rule)', () => {
    const errs = validateProvision({
      ...validKubeadmState(),
      controlPlane: nodes(['10.0.0.5', 9001], ['10.0.0.6', 9002]),
    })
    expect(errs.some(e => /control-plane/i.test(e) && /odd/i.test(e))).toBe(true)
  })
})
