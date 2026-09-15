'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'

import {
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

import { DataGrid, type GridColDef } from '@mui/x-data-grid'

import { useTranslations } from 'next-intl'

import StoragePoliciesSection from './StoragePoliciesSection'
import VdcPbsBindingsSection from './VdcPbsBindingsSection'
import TenantNetworksSection from './TenantNetworksSection'
import VdcHelpSection from './VdcHelpSection'
import TransportModeDiagram, { TRANSPORT_MODE_KEYS } from './TransportModeDiagram'
import QuotaDonut from '@/components/mydc/QuotaDonut'
import { NodeIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { extractCustomCpuModels, listKnownCpuTypes } from '@/lib/inventory/cpuModels'
import type { CpuModelMode } from '@/lib/vdc/computePolicy'
import {
  TRANSPORT_MODES,
  VXLAN_OVERHEAD,
  ZONE_MTU_MAX,
  ZONE_MTU_MIN,
  ipFamily,
  ipInCidr,
  nodesWithoutPeer,
  normalizeIp,
  parseCidr,
  suggestNodeAddresses,
  transportIfaceName,
  type VdcTransport,
  type VxlanTransportMode,
} from '@/lib/vdc/transport'

const KNOWN_CPU_TYPES = listKnownCpuTypes()

interface ComputePolicyForm {
  cpuModelMode: CpuModelMode
  cpuAllowedModels: string[]
  /** '' = automatic (first allowed model), matching the API's null. */
  cpuDefaultModel: string
  cpuAdvancedSettings: boolean
}

const emptyComputePolicy: ComputePolicyForm = {
  cpuModelMode: 'unrestricted',
  cpuAllowedModels: [],
  cpuDefaultModel: '',
  cpuAdvancedSettings: true,
}

const CPU_MODE_KEYS: Record<CpuModelMode, { label: string; hint: string }> = {
  unrestricted: { label: 'vdc.cpuModelModeUnrestricted', hint: 'vdc.cpuModelModeUnrestrictedHint' },
  custom: { label: 'vdc.cpuModelModeCustom', hint: 'vdc.cpuModelModeCustomHint' },
  selected: { label: 'vdc.cpuModelModeSelected', hint: 'vdc.cpuModelModeSelectedHint' },
}

/** Models the "default model" select may offer for a given policy. */
function defaultModelOptionsFor(policy: ComputePolicyForm, customModels: string[]): string[] {
  if (policy.cpuModelMode === 'selected') return policy.cpuAllowedModels
  if (policy.cpuModelMode === 'custom') return customModels
  return [...customModels, ...KNOWN_CPU_TYPES]
}

/** Drop a default model that the current mode / list no longer offers. */
function sanitizeDefaultModel(policy: ComputePolicyForm, customModels: string[]): ComputePolicyForm {
  if (!policy.cpuDefaultModel) return policy
  return defaultModelOptionsFor(policy, customModels).includes(policy.cpuDefaultModel)
    ? policy
    : { ...policy, cpuDefaultModel: '' }
}

// VXLAN transport (#899): the dialog keeps text fields, the API gets numbers.
interface TransportForm {
  mode: VxlanTransportMode
  /** `peers` mode: the whole list. `transport` mode: the additional endpoints. */
  peersText: string
  mtu: string
  vlanId: string
  device: string
  cidr: string
  nodeAddresses: Record<string, string>
}

const emptyTransport: TransportForm = {
  mode: 'cluster',
  peersText: '',
  mtu: '',
  vlanId: '',
  device: '',
  cidr: '',
  nodeAddresses: {},
}

type ProvisionAction = 'created' | 'updated' | 'unchanged' | 'error'

const PROVISION_ACTION_KEYS: Record<ProvisionAction, { label: string; color: 'success' | 'default' | 'error' }> = {
  created: { label: 'vdc.transportProvisionCreated', color: 'success' },
  updated: { label: 'vdc.transportProvisionUpdated', color: 'success' },
  unchanged: { label: 'vdc.transportProvisionUnchanged', color: 'default' },
  error: { label: 'vdc.transportProvisionError', color: 'error' },
}

interface NodeAddressEntry {
  name: string
  online: boolean
  /** Corosync link address from /cluster/status: the peer used in cluster mode. */
  clusterIp?: string | null
  addresses: string[]
  ifaces: Array<{ iface: string; type: string; mtu: number | null; cidr: string | null }>
}

// A small MUI Select renders its text on a 21px line while a small input is
// fixed at 1.4375em, so a select next to a text field is 2px taller. Align
// the selects of this dialog on the text fields.
// Two classes in the selector: with an end adornment MUI's own rule would
// otherwise win on `minHeight` and the 2px come back.
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } } as const

interface ZoneStatus {
  zoneName: string | null
  desired: { peers: string[]; mtu: number | null }
  live: { type: string; peers: string[]; mtu: number | null; state: string | null; pending: Record<string, unknown> | null } | null
  inSync: boolean
  changed?: boolean
}

interface ProvisionResult {
  node: string
  iface: string
  action: ProvisionAction
  message?: string
}

type TransportNodeState = 'provisioned' | 'missing' | 'drift' | 'unreachable'

const TRANSPORT_STATE_KEYS: Record<TransportNodeState, { label: string; color: 'success' | 'warning' | 'error' }> = {
  provisioned: { label: 'vdc.transportStatusProvisioned', color: 'success' },
  missing: { label: 'vdc.transportStatusMissing', color: 'warning' },
  drift: { label: 'vdc.transportStatusDrift', color: 'warning' },
  unreachable: { label: 'vdc.transportStatusUnreachable', color: 'error' },
}

interface TransportNodeStatus {
  node: string
  iface: string
  state: TransportNodeState
  wanted: string
  found: string | null
  message?: string
}

/** Entries of a peers textarea: one per line, or comma / space separated. */
function splitPeers(text: string): string[] {
  return text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
}

function firstInvalidAddress(entries: string[]): string | null {
  return entries.find((e) => ipFamily(e) === null) ?? null
}

function transportFormFrom(t: VdcTransport | null | undefined): TransportForm {
  if (!t) return emptyTransport
  return {
    mode: TRANSPORT_MODES.includes(t.mode) ? t.mode : 'cluster',
    peersText: Array.isArray(t.peers) ? t.peers.join('\n') : '',
    mtu: t.mtu != null ? String(t.mtu) : '',
    vlanId: t.vlanId != null ? String(t.vlanId) : '',
    device: t.device ?? '',
    cidr: t.cidr ?? '',
    nodeAddresses: t.nodeAddresses && typeof t.nodeAddresses === 'object' ? { ...t.nodeAddresses } : {},
  }
}

/** The `transport` body sent with the vDC POST / PUT. */
function transportPayloadFrom(f: TransportForm): Partial<VdcTransport> {
  const nodeAddresses: Record<string, string> = {}
  for (const [node, value] of Object.entries(f.nodeAddresses)) {
    const trimmed = String(value ?? '').trim()
    if (trimmed) nodeAddresses[node] = trimmed
  }
  return {
    mode: f.mode,
    peers: splitPeers(f.peersText),
    mtu: f.mtu.trim() ? Number(f.mtu) : null,
    vlanId: f.vlanId.trim() ? Number(f.vlanId) : null,
    device: f.device.trim() || null,
    cidr: f.cidr.trim() || null,
    nodeAddresses,
  }
}

/** Order-insensitive fingerprint, so Sync / Provision know the form is saved. */
function transportFingerprint(p: Partial<VdcTransport>): string {
  return JSON.stringify({
    mode: p.mode,
    peers: [...new Set(p.peers ?? [])].sort((a, b) => a.localeCompare(b)),
    mtu: p.mtu ?? null,
    vlanId: p.vlanId ?? null,
    device: p.device ?? null,
    cidr: p.cidr ?? null,
    nodeAddresses: Object.entries(p.nodeAddresses ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  })
}

function transportDirty(f: TransportForm, saved: VdcTransport | null | undefined): boolean {
  return transportFingerprint(transportPayloadFrom(f)) !== transportFingerprint(transportPayloadFrom(transportFormFrom(saved)))
}

interface VdcFormState {
  name: string
  slug: string
  description: string
  tenantId: string
  connectionId: string
  nodes: string[]
  /** Single shared storage (CEPH/NFS) that backs all VM disks for this
   *  vDC. Local storages and ISO/backup-only storages are filtered out
   *  by the available-resources route — the form only sees candidates
   *  that pass the `shared && content includes images` filter. */
  primaryStorage: string
  maxVcpus: string
  maxRamGb: string
  maxStorageGb: string
  maxVms: string
  maxSnapshots: string
  maxBackups: string
  maxVnets: string
  unlimitedVcpus: boolean
  unlimitedRam: boolean
  unlimitedStorage: boolean
  unlimitedVms: boolean
  unlimitedSnapshots: boolean
  unlimitedBackups: boolean
  unlimitedVnets: boolean
  sdnZoneName: string
}

const emptyForm: VdcFormState = {
  name: '',
  slug: '',
  description: '',
  tenantId: '',
  connectionId: '',
  nodes: [],
  primaryStorage: '',
  maxVcpus: '',
  maxRamGb: '',
  maxStorageGb: '',
  maxVms: '',
  maxSnapshots: '',
  maxBackups: '',
  maxVnets: '',
  unlimitedVcpus: true,
  unlimitedRam: true,
  unlimitedStorage: true,
  unlimitedVms: true,
  unlimitedSnapshots: true,
  unlimitedBackups: true,
  unlimitedVnets: true,
  sdnZoneName: '',
}

// Translates an ISO timestamp into a localized "3m ago" / "2h ago" / "5d ago"
// using the existing time.* keys, so we don't ship a new dependency.
// Dialog tab panel. Inactive panels stay MOUNTED (display: none) so the
// per-section effects keep running and unsaved edits survive a tab switch.
function TabPanel({ value, index, children }: { value: number; index: number; children: ReactNode }) {
  return (
    <Box role="tabpanel" hidden={value !== index} sx={{ display: value === index ? 'flex' : 'none', flexDirection: 'column', gap: 2 }}>
      {children}
    </Box>
  )
}

function formatRelative(iso: string | null | undefined, t: (k: string, p?: any) => string): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return t('time.justNow')
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return t('time.minutesAgo', { count: minutes })
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return t('time.hoursAgo', { count: hours })
  const days = Math.floor(diff / 86_400_000)
  return t('time.daysAgo', { count: days })
}

export default function VdcTab() {
  const t = useTranslations()

  // Data
  const [vdcs, setVdcs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogTab, setDialogTab] = useState(0)
  // Sub-tabs: the vDC list and the connection-level storage policies are
  // separate concerns; showing both stacked made the page too long.
  const [activeSection, setActiveSection] = useState<'vdcs' | 'policies' | 'networks' | 'help'>('vdcs')
  const [editingVdc, setEditingVdc] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  // Form
  const [form, setForm] = useState<VdcFormState>(emptyForm)

  // Available resources (loaded when connection selected)
  const [availableResources, setAvailableResources] = useState<any>(null)
  const [resourcesLoading, setResourcesLoading] = useState(false)

  // Dropdowns
  const [tenants, setTenants] = useState<any[]>([])
  const [connections, setConnections] = useState<any[]>([])

  // Delete confirmation
  const [deleteVdc, setDeleteVdc] = useState<any>(null)

  // Shared bridges (SDN)
  const [providerBridges, setProviderBridges] = useState<Array<{ iface: string; nodes: string[]; type: string }>>([])
  const [selectedSharedBridges, setSelectedSharedBridges] = useState<Map<string, string>>(new Map())

  // VLAN pools (tenant-VLANs, #646): provider-dedicated ranges of VLAN IDs
  // on a bridge, which the tenant can later carve VLAN networks out of.
  const [vlanPools, setVlanPools] = useState<Array<{ bridge: string; rangeStart: string; rangeEnd: string }>>([])
  const [poolBridges, setPoolBridges] = useState<Array<{ iface: string; vlanAware?: boolean }>>([])

  // Storage policy assignments (storage policies + QoS, P3): QoS-capped
  // storage policies the connection's provider defined, and the subset (with
  // a per-vDC quota override) this vDC is assigned.
  const [connPolicies, setConnPolicies] = useState<Array<{ id: string; name: string; storageId: string }>>([])
  const [vdcPolicies, setVdcPolicies] = useState<Array<{ policyId: string; quotaGb: string }>>([])

  // PBS bindings (inline in the edit dialog, below Nodes)
  const [pbsConnections, setPbsConnections] = useState<Array<{ id: string; name: string; fingerprint: string | null }>>([])

  // Draft PBS binding collected during vDC creation. When `enabled`, the
  // create flow will POST a /pbs-bindings request with these fields right
  // after the vDC POST returns its new id. Populated only in create mode;
  // edit mode uses the existing VdcPbsBindingsSection list manager.
  const [pbsDraft, setPbsDraft] = useState({
    enabled: false,
    mode: 'auto' as 'auto' | 'manual',
    pbsConnectionId: '',
    datastore: '',
    namespace: '',
  })
  const [pbsDraftDatastores, setPbsDraftDatastores] = useState<string[]>([])

  // Compute policy (#893): which CPU models the tenant may pick and whether
  // the advanced CPU controls are exposed. Custom models come from the
  // cluster's cpu-models.conf, read through the first node of the connection.
  const [computePolicy, setComputePolicy] = useState<ComputePolicyForm>(emptyComputePolicy)
  const [customCpuModels, setCustomCpuModels] = useState<string[]>([])

  // ISO library (#894): read-only ISO storages granted to the tenant, picked
  // among the cluster storages that advertise `iso` content.
  const [isoLibraries, setIsoLibraries] = useState<Array<{ storageId: string; allowUploads: boolean }>>([])
  const [isoStorageCandidates, setIsoStorageCandidates] = useState<Array<{ storage: string; type: string; shared: boolean }>>([])

  // VXLAN transport (#899): how the vDC's zone reaches its peers, the node
  // addresses / devices of the cluster that feed the section, and the zone
  // status (desired vs live on Proxmox) shown in edit mode.
  const [transport, setTransport] = useState<TransportForm>(emptyTransport)
  const [nodeAddressInfo, setNodeAddressInfo] = useState<{ nodes: NodeAddressEntry[]; devices: string[] }>({ nodes: [], devices: [] })
  const [zoneStatus, setZoneStatus] = useState<ZoneStatus | null>(null)
  // Stretched tenant networks (#901) this vDC carries, read-only here: the
  // memberships are managed from the Tenant networks tab.
  const [vdcNetworks, setVdcNetworks] = useState<Array<{ id: string; name: string; vni: number; pveName: string }>>([])
  useEffect(() => {
    if (!editingVdc?.id || !editingVdc?.tenantId) { setVdcNetworks([]); return }
    let cancelled = false
    fetch(`/api/v1/admin/tenant-networks?tenantId=${encodeURIComponent(editingVdc.tenantId)}`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(j => {
        if (cancelled) return
        const list = Array.isArray(j?.data) ? j.data : []
        setVdcNetworks(list
          .filter((n: any) => Array.isArray(n.members) && n.members.some((m: any) => m.vdcId === editingVdc.id))
          .map((n: any) => ({ id: n.id, name: n.name, vni: n.vni, pveName: n.members.find((m: any) => m.vdcId === editingVdc.id)?.pveName ?? n.pveName })))
      })
      .catch(() => { if (!cancelled) setVdcNetworks([]) })
    return () => { cancelled = true }
  }, [editingVdc?.id, editingVdc?.tenantId])
  const [zoneLoading, setZoneLoading] = useState(false)
  const [zoneMessage, setZoneMessage] = useState<{ severity: 'success' | 'info' | 'error'; text: string } | null>(null)
  const [provisioning, setProvisioning] = useState(false)
  const [provisionResults, setProvisionResults] = useState<ProvisionResult[] | null>(null)
  const [provisionError, setProvisionError] = useState('')
  // What each node carries on the transport interface, read when the dialog
  // opens in transport mode and again after a provisioning.
  const [transportStatus, setTransportStatus] = useState<TransportNodeStatus[] | null>(null)
  const [transportStatusLoading, setTransportStatusLoading] = useState(false)

  // Node statuses keyed `${connectionId}|${nodeName}` -> 'online' | 'offline' | …
  // Populated once vDCs are loaded by hitting available-resources for each
  // distinct connection. Used to render the status pastille in the Nodes cell.
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, string>>({})

  // Tenant → users map. Populated once vDCs are loaded by fetching the
  // member list for each distinct tenant. Used by the Users column.
  const [tenantUsers, setTenantUsers] = useState<Record<string, Array<{ id: string; name: string | null; email: string }>>>({})

  // Auto-clear success after 5s
  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 5000)
    return () => clearTimeout(timer)
  }, [success])

  // ------- Data loading -------

  const fetchVdcs = useCallback(async () => {
    setLoading(true)

    try {
      const res = await fetch('/api/v1/admin/vdcs')

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()

      setVdcs(data.data || [])
    } catch {
      setError(t('vdc.failedLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const fetchDropdowns = useCallback(async () => {
    try {
      const [tenantsRes, connectionsRes] = await Promise.all([
        fetch('/api/v1/tenants'),
        fetch('/api/v1/admin/connections?type=pve'),
      ])

      const tenantsData = await tenantsRes.json()
      const connectionsData = await connectionsRes.json()

      setTenants(tenantsData.data || [])
      setConnections((connectionsData.data || []).filter((c: any) => c.type === 'pve'))
    } catch {
      // Non-critical, dropdowns just won't populate
    }
  }, [])

  useEffect(() => {
    fetchVdcs()
    fetchDropdowns()
  }, [fetchVdcs, fetchDropdowns])

  // After vDCs are loaded, resolve each distinct connection's node statuses
  // so the Nodes cell can display the online/offline pastille.
  useEffect(() => {
    if (vdcs.length === 0) return
    const connIds = Array.from(new Set(vdcs.map((v: any) => v.connectionId).filter(Boolean)))
    if (connIds.length === 0) return
    let cancelled = false

    void (async () => {
      const results = await Promise.all(connIds.map(async (cid) => {
        try {
          const r = await fetch(`/api/v1/admin/connections/${encodeURIComponent(cid)}/available-resources`)
          if (!r.ok) return null
          const j = await r.json()
          const ns = j?.data?.nodes ?? []
          return { cid, nodes: Array.isArray(ns) ? ns : [] }
        } catch {
          return null
        }
      }))
      if (cancelled) return
      const statuses: Record<string, string> = {}
      for (const r of results) {
        if (!r) continue
        for (const n of r.nodes as Array<{ name: string; status?: string }>) {
          if (n?.name) statuses[`${r.cid}|${n.name}`] = n.status || 'unknown'
        }
      }
      setNodeStatuses(statuses)
    })()

    return () => { cancelled = true }
  }, [vdcs])

  // After vDCs are loaded, batch-fetch the user list for each distinct tenant
  // so the Users column can render a compact AvatarGroup without N+1 fetches.
  useEffect(() => {
    if (vdcs.length === 0) return
    const tenantIds = Array.from(new Set(vdcs.map((v: any) => v.tenantId).filter(Boolean)))
    if (tenantIds.length === 0) return
    let cancelled = false

    void (async () => {
      const results = await Promise.all(tenantIds.map(async (tid) => {
        try {
          const r = await fetch(`/api/v1/tenants/${encodeURIComponent(tid)}/users`)
          if (!r.ok) return { tid, users: [] }
          const j = await r.json()
          return { tid, users: Array.isArray(j?.data) ? j.data : [] }
        } catch {
          return { tid, users: [] }
        }
      }))
      if (cancelled) return
      const map: Record<string, any[]> = {}
      for (const r of results) map[r.tid] = r.users
      setTenantUsers(map)
    })()

    return () => { cancelled = true }
  }, [vdcs])

  useEffect(() => {
    ;(async () => {
      const r = await fetch('/api/v1/admin/connections?type=pbs')
      if (r.ok) {
        const j = await r.json()
        setPbsConnections((j.data ?? []).map((c: any) => ({ id: c.id, name: c.name, fingerprint: c.fingerprint ?? null })))
      }
    })()
  }, [])

  // Fetch available resources when connectionId changes
  useEffect(() => {
    if (!form.connectionId) {
      setAvailableResources(null)
      return
    }

    let cancelled = false

    const fetchResources = async () => {
      setResourcesLoading(true)

      try {
        // Pass vdcId when editing so the route only hides PBS storages
        // bound to OTHER vDCs and keeps the current vDC's own visible.
        const url = editingVdc
          ? `/api/v1/admin/connections/${form.connectionId}/available-resources?vdcId=${encodeURIComponent(editingVdc.id)}`
          : `/api/v1/admin/connections/${form.connectionId}/available-resources`
        const res = await fetch(url)

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const data = await res.json()

        if (!cancelled) {
          const resources = data.data || null
          setAvailableResources(resources)
          // Auto-embed all nodes (HA cluster: every node can run any VM)
          // and auto-pick a sensible default primary storage when the
          // form has none yet. Available-resources only returns shared +
          // images-capable storages, so any candidate works. We prefer
          // RBD/CEPH (largest first) for typical clusters, then fall
          // back to the largest other shared storage.
          if (!editingVdc && resources) {
            const candidates: any[] = (resources.storages || [])
            const ranked = [...candidates].sort((a, b) => {
              const aIsCeph = String(a.type || '').toLowerCase() === 'rbd' ? 1 : 0
              const bIsCeph = String(b.type || '').toLowerCase() === 'rbd' ? 1 : 0
              if (aIsCeph !== bIsCeph) return bIsCeph - aIsCeph
              return (b.maxdisk || 0) - (a.maxdisk || 0)
            })
            const autoPick = ranked[0]?.id || ''
            setForm((f) => ({
              ...f,
              nodes: (resources.nodes || []).map((n: any) => n.name).filter(Boolean),
              primaryStorage: f.primaryStorage || autoPick,
            }))
          }
        }
      } catch {
        if (!cancelled) {
          setAvailableResources(null)
        }
      } finally {
        if (!cancelled) {
          setResourcesLoading(false)
        }
      }
    }

    fetchResources()

    return () => { cancelled = true }
  }, [form.connectionId, editingVdc?.id])

  // Datastores for the create-time PBS draft. Mirrors the load done by
  // VdcPbsBindingsSection in edit mode but lives here because the draft
  // state lives here. Cleared whenever the picked PBS connection changes
  // so a stale list never carries over.
  useEffect(() => {
    if (!pbsDraft.enabled || !pbsDraft.pbsConnectionId) {
      setPbsDraftDatastores([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/v1/admin/pbs-connections/${encodeURIComponent(pbsDraft.pbsConnectionId)}/datastores`)
        const j = await r.json()
        if (!cancelled) setPbsDraftDatastores(Array.isArray(j.data) ? j.data : [])
      } catch {
        if (!cancelled) setPbsDraftDatastores([])
      }
    })()
    return () => { cancelled = true }
  }, [pbsDraft.enabled, pbsDraft.pbsConnectionId])

  // Default the PBS namespace to `tenant-<slug>/vdc-<slug>` once both are
  // known. The user can still override; we only set when empty so any
  // manual edit survives a re-render.
  useEffect(() => {
    if (!pbsDraft.enabled) return
    if (pbsDraft.namespace) return
    const tSlug = getTenantSlug(form.tenantId)
    if (!tSlug || !form.slug) return
    setPbsDraft((d) => (d.namespace ? d : { ...d, namespace: `tenant-${tSlug}/vdc-${form.slug}` }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pbsDraft.enabled, form.tenantId, form.slug])

  // Fetch provider bridges when connectionId changes
  useEffect(() => {
    if (!form.connectionId) {
      setProviderBridges([])
      setPoolBridges([])
      setConnPolicies([])
      setIsoStorageCandidates([])
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(form.connectionId)}/storage`)
        if (!res.ok) { setIsoStorageCandidates([]); return }
        const json = await res.json()
        const rows: any[] = Array.isArray(json?.data) ? json.data : []
        // Non-shared storages come back once per node: keep one row per id.
        const byId = new Map<string, { storage: string; type: string; shared: boolean }>()
        for (const r of rows) {
          const id = String(r?.storage ?? r?.id ?? '')
          const content: string[] = Array.isArray(r?.content) ? r.content.map((c: unknown) => String(c).trim()) : []
          if (!id || !content.includes('iso') || byId.has(id)) continue
          byId.set(id, { storage: id, type: String(r?.type ?? 'unknown'), shared: !!r?.shared })
        }
        setIsoStorageCandidates([...byId.values()].sort((a, b) => a.storage.localeCompare(b.storage)))
      } catch (err) {
        console.error('Failed to load ISO storages', err)
        setIsoStorageCandidates([])
      }
    })()
    void (async () => {
      try {
        const res = await fetch(`/api/v1/admin/connections/${encodeURIComponent(form.connectionId)}/provider-bridges`)
        if (res.ok) {
          const json = await res.json()
          setProviderBridges(Array.isArray(json.data) ? json.data : [])
        }
      } catch (err) {
        console.error('Failed to load provider bridges', err)
        setProviderBridges([])
      }
    })()
    void (async () => {
      try {
        const poolRes = await fetch(`/api/v1/admin/connections/${encodeURIComponent(form.connectionId)}/provider-bridges?scope=vlan-pool`)
        if (poolRes.ok) {
          const poolJson = await poolRes.json()
          setPoolBridges(Array.isArray(poolJson.data) ? poolJson.data : [])
        }
      } catch (err) {
        console.error('Failed to load VLAN-pool bridges', err)
        setPoolBridges([])
      }
    })()
    void (async () => {
      try {
        const policiesRes = await fetch(`/api/v1/admin/connections/${encodeURIComponent(form.connectionId)}/storage-policies`)
        if (policiesRes.ok) {
          const policiesJson = await policiesRes.json()
          setConnPolicies(Array.isArray(policiesJson.data) ? policiesJson.data : [])
        }
      } catch (err) {
        console.error('Failed to load storage policies', err)
        setConnPolicies([])
      }
    })()
  }, [form.connectionId])

  // Create mode: an ISO library grant belongs to the cluster it was ticked on,
  // so switching the connection drops the selection instead of carrying an
  // id such as `local` over to a cluster where it was never chosen.
  useEffect(() => {
    if (!editingVdc) setIsoLibraries([])
  }, [form.connectionId, editingVdc])

  // Custom CPU models of the cluster, for the compute policy section. The
  // cpu-models route is per node; any node of the cluster answers the same
  // cpu-models.conf, so the first one known from the resources fetch does.
  const firstNodeName: string | undefined = availableResources?.nodes?.[0]?.name
  useEffect(() => {
    if (!form.connectionId || !firstNodeName) {
      setCustomCpuModels([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(form.connectionId)}/nodes/${encodeURIComponent(firstNodeName)}/cpu-models`)
        if (!res.ok) { if (!cancelled) setCustomCpuModels([]); return }
        const json = await res.json()
        const models = extractCustomCpuModels(json?.data)
        if (cancelled) return
        setCustomCpuModels(models)
        setComputePolicy((p) => sanitizeDefaultModel(p, models))
      } catch (err) {
        console.error('Failed to load custom CPU models', err)
        if (!cancelled) setCustomCpuModels([])
      }
    })()
    return () => { cancelled = true }
  }, [form.connectionId, firstNodeName])

  // Node addresses and common devices of the cluster (#899): the peer-list
  // warning, the device suggestions and the node -> address table read them.
  useEffect(() => {
    if (!form.connectionId) {
      setNodeAddressInfo({ nodes: [], devices: [] })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/v1/admin/connections/${encodeURIComponent(form.connectionId)}/node-addresses`)
        if (!res.ok) { if (!cancelled) setNodeAddressInfo({ nodes: [], devices: [] }); return }
        const json = await res.json()
        if (cancelled) return
        setNodeAddressInfo({
          nodes: Array.isArray(json?.data?.nodes) ? json.data.nodes : [],
          devices: Array.isArray(json?.data?.devices) ? json.data.devices : [],
        })
      } catch (err) {
        console.error('Failed to load node addresses', err)
        if (!cancelled) setNodeAddressInfo({ nodes: [], devices: [] })
      }
    })()
    return () => { cancelled = true }
  }, [form.connectionId])

  // Zone status (#899): desired peers / MTU against what Proxmox runs.
  const loadZoneStatus = useCallback(async (vdcId: string) => {
    setZoneLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/vdcs/${encodeURIComponent(vdcId)}/zone`)
      if (!res.ok) { setZoneStatus(null); return }
      const json = await res.json()
      setZoneStatus(json?.data ?? null)
    } catch (err) {
      console.error('Failed to load SDN zone status', err)
      setZoneStatus(null)
    } finally {
      setZoneLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!dialogOpen || !editingVdc?.id || !editingVdc?.sdnZoneName) {
      setZoneStatus(null)
      return
    }
    void loadZoneStatus(editingVdc.id)
  }, [dialogOpen, editingVdc?.id, editingVdc?.sdnZoneName, loadZoneStatus])

  const handleSyncZone = async () => {
    if (!editingVdc?.id) return
    setZoneLoading(true)
    setZoneMessage(null)
    try {
      const res = await fetch(`/api/v1/admin/vdcs/${encodeURIComponent(editingVdc.id)}/zone`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || t('vdc.zoneSyncFailed'))
      setZoneStatus(json?.data ?? null)
      setZoneMessage({
        severity: json?.data?.changed ? 'success' : 'info',
        text: json?.data?.changed ? t('vdc.zoneSyncUpdated') : t('vdc.zoneSyncAlreadyInSync'),
      })
    } catch (e: any) {
      setZoneMessage({ severity: 'error', text: e?.message || String(e) })
    } finally {
      setZoneLoading(false)
    }
  }

  const loadTransportStatus = useCallback(async (vdcId: string) => {
    setTransportStatusLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/vdcs/${encodeURIComponent(vdcId)}/transport/provision`)
      if (!res.ok) { setTransportStatus(null); return }
      const json = await res.json()
      setTransportStatus(Array.isArray(json?.data?.nodes) ? json.data.nodes : [])
    } catch (err) {
      console.error('Failed to load transport interface status', err)
      setTransportStatus(null)
    } finally {
      setTransportStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!dialogOpen || !editingVdc?.id || editingVdc?.transport?.mode !== 'transport') {
      setTransportStatus(null)
      return
    }
    void loadTransportStatus(editingVdc.id)
  }, [dialogOpen, editingVdc?.id, editingVdc?.transport?.mode, loadTransportStatus])

  const handleProvisionTransport = async () => {
    if (!editingVdc?.id) return
    setProvisioning(true)
    setProvisionError('')
    setProvisionResults(null)
    try {
      const res = await fetch(`/api/v1/admin/vdcs/${encodeURIComponent(editingVdc.id)}/transport/provision`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || t('vdc.transportProvisionFailed'))
      setProvisionResults(Array.isArray(json?.data?.results) ? json.data.results : [])
      // The node interfaces changed: re-read them, and the live zone MTU may follow.
      void loadTransportStatus(editingVdc.id)
      void loadZoneStatus(editingVdc.id)
    } catch (e: any) {
      setProvisionError(e?.message || String(e))
    } finally {
      setProvisioning(false)
    }
  }

  // ------- Helpers -------

  const getConnectionName = (connectionId: string) => {
    const conn = connections.find((c) => c.id === connectionId)
    return conn?.name || connectionId
  }

  const getTenantSlug = (tenantId: string) => {
    const tenant = tenants.find((t) => t.id === tenantId)
    return tenant?.slug || ''
  }

  // Slug derivation. The user no longer types the slug — it's a fully
  // computed value from (tenant, connection). Including the connection
  // distinguishes a tenant's vDCs across clusters and avoids the
  // (tenant_id, slug) UNIQUE conflict that would otherwise hit on the
  // second vDC. Falls back to the tenant slug only when the connection
  // hasn't been picked yet, so the form's "Save" disabled check stays
  // meaningful before all fields are filled.
  const sluggify = (s: string): string =>
    String(s || '')
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '')

  const computeVdcSlug = (tenant: any | null, connectionId: string): string => {
    if (!tenant) return ''
    const tSlug = sluggify(tenant.slug || tenant.name || tenant.id || '')
    const conn = connections.find((c) => c.id === connectionId)
    const cSlug = conn ? sluggify(conn.name || conn.id || '') : ''
    return cSlug ? `${tSlug}-${cSlug}` : tSlug
  }

  // Display name mirrors the slug derivation: with multi-vDC tenants, a
  // bare tenant name would make the vDCs indistinguishable in every list.
  const computeVdcName = (tenant: any | null, connectionId: string): string => {
    if (!tenant) return ''
    const base = tenant.name || tenant.id || ''
    const conn = connections.find((c) => c.id === connectionId)
    return conn?.name ? `${base} — ${conn.name}` : base
  }

  // ------- Handlers -------

  const handleCreate = () => {
    setEditingVdc(null)
    setForm(emptyForm)
    setAvailableResources(null)
    setSelectedSharedBridges(new Map())
    setVlanPools([])
    setVdcPolicies([])
    setComputePolicy(emptyComputePolicy)
    setIsoLibraries([])
    setTransport(emptyTransport)
    setZoneStatus(null)
    setZoneMessage(null)
    setProvisionResults(null)
    setProvisionError('')
    setPbsDraft({ enabled: false, mode: 'auto', pbsConnectionId: '', datastore: '', namespace: '' })
    setPbsDraftDatastores([])
    setDialogTab(0)
    setDialogOpen(true)
  }

  const handleEdit = (vdc: any) => {
    setEditingVdc(vdc)
    setForm({
      name: vdc.name,
      slug: vdc.slug,
      description: vdc.description || '',
      tenantId: vdc.tenantId,
      connectionId: vdc.connectionId,
      nodes: vdc.nodes,
      primaryStorage: vdc.primaryStorage || '',
      sdnZoneName: vdc.sdnZoneName || '',
      maxVcpus: vdc.quota?.maxVcpus ? String(vdc.quota.maxVcpus) : '',
      maxRamGb: vdc.quota?.maxRamMb ? String(Math.round(vdc.quota.maxRamMb / 1024)) : '',
      maxStorageGb: vdc.quota?.maxStorageMb ? String(Math.round(vdc.quota.maxStorageMb / 1024)) : '',
      maxVms: vdc.quota?.maxVms ? String(vdc.quota.maxVms) : '',
      maxSnapshots: vdc.quota?.maxSnapshots ? String(vdc.quota.maxSnapshots) : '',
      maxBackups: vdc.quota?.maxBackups ? String(vdc.quota.maxBackups) : '',
      maxVnets: vdc.quota?.maxVnets ? String(vdc.quota.maxVnets) : '',
      unlimitedVcpus: vdc.quota?.maxVcpus == null,
      unlimitedRam: vdc.quota?.maxRamMb == null,
      unlimitedStorage: vdc.quota?.maxStorageMb == null,
      unlimitedVms: vdc.quota?.maxVms == null,
      unlimitedSnapshots: vdc.quota?.maxSnapshots == null,
      unlimitedBackups: vdc.quota?.maxBackups == null,
      unlimitedVnets: vdc.quota?.maxVnets == null,
    })

    if (vdc.sharedBridges?.length) {
      const map = new Map<string, string>()
      for (const sb of vdc.sharedBridges) {
        map.set(sb.bridge, sb.label ?? '')
      }
      setSelectedSharedBridges(map)
    } else {
      setSelectedSharedBridges(new Map())
    }

    setVlanPools((vdc.vlanPools ?? []).map((p: any) => ({
      bridge: p.bridge, rangeStart: String(p.rangeStart), rangeEnd: String(p.rangeEnd),
    })))

    setVdcPolicies((vdc.storagePolicies ?? []).map((sp: any) => ({
      policyId: sp.policyId, quotaGb: sp.quotaMb != null ? String(Math.round(sp.quotaMb / 1024)) : '',
    })))

    const cp = vdc.computePolicy
    setComputePolicy({
      cpuModelMode: cp?.cpuModelMode === 'custom' || cp?.cpuModelMode === 'selected' ? cp.cpuModelMode : 'unrestricted',
      cpuAllowedModels: Array.isArray(cp?.cpuAllowedModels) ? cp.cpuAllowedModels : [],
      cpuDefaultModel: cp?.cpuDefaultModel ?? '',
      cpuAdvancedSettings: cp?.cpuAdvancedSettings !== false,
    })
    // Older payloads carried bare storage ids (read-only grants).
    setIsoLibraries(
      Array.isArray(vdc.isoLibraries)
        ? vdc.isoLibraries
            .map((l: any) =>
              typeof l === 'string'
                ? { storageId: l, allowUploads: false }
                : { storageId: String(l?.storageId ?? ''), allowUploads: l?.allowUploads === true },
            )
            .filter((l: { storageId: string }) => l.storageId)
        : [],
    )
    setTransport(transportFormFrom(vdc.transport))
    setZoneStatus(null)
    setZoneMessage(null)
    setProvisionResults(null)
    setProvisionError('')

    setDialogTab(0)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')

    try {
      // Build quota object
      const quota: any = {}

      if (!form.unlimitedVcpus && form.maxVcpus) quota.maxVcpus = Number.parseInt(form.maxVcpus)
      if (!form.unlimitedRam && form.maxRamGb) quota.maxRamMb = Number.parseInt(form.maxRamGb) * 1024
      if (!form.unlimitedStorage && form.maxStorageGb) quota.maxStorageMb = Number.parseInt(form.maxStorageGb) * 1024
      if (!form.unlimitedVms && form.maxVms) quota.maxVms = Number.parseInt(form.maxVms)
      if (!form.unlimitedSnapshots && form.maxSnapshots) quota.maxSnapshots = Number.parseInt(form.maxSnapshots)
      if (!form.unlimitedBackups && form.maxBackups) quota.maxBackups = Number.parseInt(form.maxBackups)
      if (!form.unlimitedVnets && form.maxVnets) quota.maxVnets = Number.parseInt(form.maxVnets)

      // For unlimited fields, explicitly set null so the backend clears them
      if (form.unlimitedVcpus) quota.maxVcpus = null
      if (form.unlimitedRam) quota.maxRamMb = null
      if (form.unlimitedStorage) quota.maxStorageMb = null
      if (form.unlimitedVms) quota.maxVms = null
      if (form.unlimitedSnapshots) quota.maxSnapshots = null
      if (form.unlimitedBackups) quota.maxBackups = null
      if (form.unlimitedVnets) quota.maxVnets = null

      const sharedBridgesPayload = Array.from(selectedSharedBridges.entries()).map(([bridge, label]) => ({
        bridge,
        label: label.trim() || undefined,
      }))

      const vlanPoolsPayload = vlanPools
        .filter((p) => p.bridge && p.rangeStart && p.rangeEnd)
        .map((p) => ({
          bridge: p.bridge,
          rangeStart: Number.parseInt(p.rangeStart, 10),
          rangeEnd: Number.parseInt(p.rangeEnd, 10),
        }))

      const storagePoliciesPayload = vdcPolicies
        .filter((sp) => sp.policyId)
        .map((sp) => ({
          policyId: sp.policyId,
          quotaMb: sp.quotaGb ? Number.parseInt(sp.quotaGb, 10) * 1024 : null,
        }))

      const computePolicyPayload = {
        ...computePolicy,
        cpuDefaultModel: computePolicy.cpuDefaultModel || null,
      }

      // VXLAN transport (#899): the server validates in depth; a malformed
      // address is caught here to spare the round trip.
      const transportPayload = transportPayloadFrom(transport)
      const badPeer = firstInvalidAddress(transportPayload.peers ?? [])
      if (badPeer) throw new Error(t('vdc.transportInvalidAddress', { address: badPeer }))
      const badNodeAddress = firstInvalidAddress(Object.values(transportPayload.nodeAddresses ?? {}))
      if (badNodeAddress) throw new Error(t('vdc.transportInvalidAddress', { address: badNodeAddress }))

      // Snapshot nodes from the live resources at submit time —
      // form.nodes gets auto-filled by the resources fetch useEffect,
      // but a race (slow PVE, fetch retry, user clicking Submit right
      // after Connection select) can leave it empty. Reading straight
      // from availableResources here closes that window.
      const liveNodes = (availableResources?.nodes || [])
        .map((n: any) => n.name)
        .filter(Boolean)
      const nodesPayload = (editingVdc ? form.nodes : (form.nodes.length > 0 ? form.nodes : liveNodes))

      if (!form.primaryStorage) {
        throw new Error(t('vdc.primaryStorageRequired'))
      }

      if (!editingVdc && pbsDraft.enabled) {
        if (!pbsDraft.pbsConnectionId || !pbsDraft.datastore || !pbsDraft.namespace) {
          throw new Error(t('vdc.pbsFieldsRequired'))
        }
      }

      if (editingVdc) {
        // PUT - update. An emptied Name field falls back to the derived
        // name (renaming a vDC back to default) and — as a last resort, if
        // `tenants` wasn't loaded — to the vDC's current name so we never
        // submit an empty string.
        const resolvedName = form.name.trim() ||
          computeVdcName(tenants.find((tn) => tn.id === form.tenantId) ?? null, editingVdc.connectionId) ||
          editingVdc.name

        const body: any = {
          name: resolvedName,
          description: form.description || undefined,
          nodes: nodesPayload,
          primaryStorage: form.primaryStorage,
          sharedBridges: sharedBridgesPayload,
          vlanPools: vlanPoolsPayload,
          storagePolicies: storagePoliciesPayload,
          computePolicy: computePolicyPayload,
          isoLibraries,
          transport: transportPayload,
          quota,
        }

        const res = await fetch(`/api/v1/admin/vdcs/${editingVdc.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || t('vdc.failedSave'))
        }
      } else {
        // POST - create. An empty Name field falls back to the derived
        // "tenant — cluster" name (see computeVdcName).
        const resolvedName = form.name.trim() ||
          computeVdcName(tenants.find((tn) => tn.id === form.tenantId) ?? null, form.connectionId)

        const body = {
          tenantId: form.tenantId,
          connectionId: form.connectionId,
          name: resolvedName,
          slug: form.slug,
          description: form.description || undefined,
          sdnZoneName: form.sdnZoneName || undefined,
          nodes: nodesPayload,
          primaryStorage: form.primaryStorage,
          sharedBridges: sharedBridgesPayload,
          vlanPools: vlanPoolsPayload,
          storagePolicies: storagePoliciesPayload,
          computePolicy: computePolicyPayload,
          isoLibraries,
          transport: transportPayload,
          quota: Object.keys(quota).some((k) => quota[k] !== null) ? quota : undefined,
        }

        const res = await fetch('/api/v1/admin/vdcs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || t('vdc.failedSave'))
        }

        // Optional second step: bind a PBS datastore right after the
        // vDC is created. The vDC stays even if this fails — the admin
        // can retry from the edit dialog. We surface a partial-success
        // message rather than a hard error so they don't think the
        // create itself failed.
        if (
          pbsDraft.enabled &&
          pbsDraft.pbsConnectionId &&
          pbsDraft.datastore &&
          pbsDraft.namespace
        ) {
          const created = await res.json().catch(() => ({}))
          const newVdcId = created?.data?.id
          if (newVdcId) {
            try {
              const bindRes = await fetch(
                `/api/v1/admin/vdcs/${encodeURIComponent(newVdcId)}/pbs-bindings`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    mode: pbsDraft.mode,
                    pbsConnectionId: pbsDraft.pbsConnectionId,
                    datastore: pbsDraft.datastore,
                    namespace: pbsDraft.namespace,
                  }),
                },
              )
              if (!bindRes.ok) {
                const bindErr = await bindRes.json().catch(() => ({}))
                setError(t('vdc.pbsBindCreatedVdcFailedBind', { error: bindErr.error || `HTTP ${bindRes.status}` }))
              } else {
                const bindData = await bindRes.json().catch(() => ({}))
                const failedPve = bindData?.steps?.pveStorages?.find((s: any) => s.status === 'failed')
                if (failedPve) {
                  setError(t('vdc.pbsPveStorageCreationFailed', { error: failedPve.error || 'unknown' }))
                }
              }
            } catch (e: any) {
              setError(t('vdc.pbsBindCreatedVdcFailedBind', { error: e?.message || String(e) }))
            }
          }
        }
      }

      setSuccess(editingVdc ? t('vdc.updated') : t('vdc.created'))
      setDialogOpen(false)
      fetchVdcs()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteVdc) return

    try {
      const res = await fetch(`/api/v1/admin/vdcs/${deleteVdc.id}`, { method: 'DELETE' })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || t('vdc.failedDelete'))
      }

      setSuccess(t('vdc.deleted'))
      setDeleteVdc(null)
      fetchVdcs()
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ------- Quota donut renderer (compact, in-cell) -------

  const renderQuotaDonut = (
    icon: string,
    used: number | undefined,
    max: number | null | undefined,
    unit?: string,
    lastSyncedAt?: string | null,
  ) => {
    const donut = (
      <QuotaDonut
        size={52}
        icon={icon}
        used={used ?? 0}
        max={max}
        unit={unit}
        unlimitedLabel={t('vdc.quotaUnlimited')}
      />
    )
    if (!lastSyncedAt) return donut
    const when = formatRelative(lastSyncedAt, t)
    if (!when) return donut
    return (
      <Tooltip title={t('time.synced', { time: when })} arrow>
        <Box sx={{ display: 'inline-flex' }}>{donut}</Box>
      </Tooltip>
    )
  }

  // ------- DataGrid columns -------

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: t('common.name'),
      flex: 1,
      minWidth: 180,
      renderCell: (params) => {
        const enabled = params.row.enabled !== false
        const subtitle = params.row.description || params.row.slug || params.row.pvePoolName
        const created = formatRelative(params.row.createdAt, t)
        const tooltipTitle = created ? `${t('common.created')} ${created}` : ''

        return (
          <Tooltip title={tooltipTitle} arrow disableInteractive>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden', width: '100%' }}>
              <Box
                component="i"
                className="ri-cloud-line"
                sx={{ fontSize: 22, color: 'primary.main', flexShrink: 0 }}
              />
              <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden', minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                    {params.value}
                  </Typography>
                  {!enabled && (
                    <Tooltip title={t('common.disabled')} arrow>
                      <Box
                        component="i"
                        className="ri-pause-circle-fill"
                        sx={{ fontSize: 14, color: 'warning.main', flexShrink: 0 }}
                      />
                    </Tooltip>
                  )}
                </Stack>
                {subtitle && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ fontSize: '0.7rem', lineHeight: 1.2, opacity: 0.7 }}
                  >
                    {subtitle}
                  </Typography>
                )}
              </Box>
            </Box>
          </Tooltip>
        )
      },
    },
    {
      field: 'tenantName',
      headerName: t('vdc.tenant'),
      width: 170,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
          <Box
            component="i"
            className="ri-building-line"
            sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }}
          />
          <Typography variant="body2" noWrap>{params.value}</Typography>
        </Box>
      ),
    },
    {
      field: 'tenantUsers',
      headerName: t('vdc.tenantUsers'),
      width: 240,
      sortable: false,
      valueGetter: (_v, row) => (tenantUsers[row.tenantId] || []).length,
      renderCell: (params) => {
        const users = tenantUsers[params.row.tenantId] || []
        if (users.length === 0) {
          return <Typography variant="caption" color="text.secondary">—</Typography>
        }
        const MAX_VISIBLE = 2
        const visible = users.slice(0, MAX_VISIBLE)
        const hidden = users.slice(MAX_VISIBLE)
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden', width: '100%' }}>
            {visible.map((u) => (
              <Tooltip key={u.id} arrow title={u.name ? u.email : ''} disableInteractive>
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ overflow: 'hidden' }}>
                  <Box
                    component="i"
                    className="ri-user-line"
                    sx={{ fontSize: 13, color: 'text.secondary', flexShrink: 0 }}
                  />
                  <Typography variant="caption" noWrap sx={{ lineHeight: 1.3 }}>
                    {u.name || u.email}
                  </Typography>
                </Stack>
              </Tooltip>
            ))}
            {hidden.length > 0 && (
              <Tooltip
                arrow
                title={
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    {hidden.map((u) => (
                      <Typography key={u.id} variant="caption">
                        {u.name ? `${u.name} (${u.email})` : u.email}
                      </Typography>
                    ))}
                  </Box>
                }
              >
                <Typography variant="caption" color="primary.main" sx={{ cursor: 'default', lineHeight: 1.3, mt: 0.25 }}>
                  +{hidden.length}
                </Typography>
              </Tooltip>
            )}
          </Box>
        )
      },
    },
    {
      field: 'connectionId',
      headerName: t('vdc.connection'),
      width: 150,
      renderCell: (params) => getConnectionName(params.value),
    },
    {
      field: 'nodes',
      headerName: t('vdc.nodes'),
      minWidth: 200,
      flex: 1,
      renderCell: (params) => {
        const nodes: string[] = Array.isArray(params.value) ? params.value : []
        const connId: string = params.row.connectionId
        const MAX_VISIBLE = 3
        const visible = nodes.slice(0, MAX_VISIBLE)
        const hidden = nodes.slice(MAX_VISIBLE)

        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
            {visible.map((name) => {
              const status = nodeStatuses[`${connId}|${name}`]

              return (
                <Tooltip key={name} title={status ? `${name} (${status})` : name} arrow>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                    <NodeIcon status={status} size={16} />
                    <Typography variant="caption" noWrap>{name}</Typography>
                  </Box>
                </Tooltip>
              )
            })}
            {hidden.length > 0 && (
              <Tooltip
                arrow
                title={
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    {hidden.map((name) => {
                      const status = nodeStatuses[`${connId}|${name}`]
                      return (
                        <Stack key={name} direction="row" alignItems="center" spacing={0.5}>
                          <NodeIcon status={status} size={14} />
                          <Typography variant="caption">{name}</Typography>
                        </Stack>
                      )
                    })}
                  </Box>
                }
              >
                <Chip
                  label={`+${hidden.length}`}
                  size="small"
                  sx={{ height: 20, fontSize: '0.7rem', flexShrink: 0, cursor: 'default' }}
                />
              </Tooltip>
            )}
          </Box>
        )
      },
    },
    {
      field: 'quotaCpu',
      headerName: t('vdc.vcpus'),
      width: 110,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => renderQuotaDonut(
        'ri-cpu-line',
        params.row.usage?.usedVcpus,
        params.row.quota?.maxVcpus,
        undefined,
        params.row.usage?.lastSyncedAt,
      ),
    },
    {
      field: 'quotaRam',
      headerName: t('vdc.ram'),
      width: 120,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => {
        const usedGb = params.row.usage?.usedRamMb != null ? Math.round(params.row.usage.usedRamMb / 1024) : undefined
        const maxGb = params.row.quota?.maxRamMb != null ? Math.round(params.row.quota.maxRamMb / 1024) : null

        return renderQuotaDonut('ri-ram-2-line', usedGb, maxGb, 'GB', params.row.usage?.lastSyncedAt)
      },
    },
    {
      field: 'quotaStorage',
      headerName: t('vdc.storage'),
      width: 120,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => {
        const usedGb = params.row.usage?.usedStorageMb != null ? Math.round(params.row.usage.usedStorageMb / 1024) : undefined
        const maxGb = params.row.quota?.maxStorageMb != null ? Math.round(params.row.quota.maxStorageMb / 1024) : null

        return renderQuotaDonut('ri-hard-drive-2-line', usedGb, maxGb, 'GB', params.row.usage?.lastSyncedAt)
      },
    },
    {
      field: 'storagePolicies',
      headerName: t('vdc.storagePoliciesTitle'),
      width: 130,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => {
        const policies: any[] = Array.isArray(params.row.storagePolicies) ? params.row.storagePolicies : []
        const count = policies.length
        const tooltip = count === 0 ? t('vdc.vdcPoliciesHint') : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {policies.map((sp) => (
              <Typography key={sp.policyId} variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                {sp.name} • {sp.storageId} • {sp.quotaMb != null ? `${Math.round(sp.quotaMb / 1024)} GB` : t('vdc.quotaUnlimited')}
              </Typography>
            ))}
          </Box>
        )

        return (
          <Tooltip arrow title={tooltip}>
            <Chip
              icon={<Box component="i" className="ri-hard-drive-2-line" sx={{ fontSize: 14, ml: '6px !important' }} />}
              label={count}
              size="small"
              variant={count === 0 ? 'outlined' : 'filled'}
              sx={{ height: 24, cursor: 'default' }}
            />
          </Tooltip>
        )
      },
    },
    {
      field: 'quotaVms',
      headerName: t('vdc.vms'),
      width: 110,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => renderQuotaDonut(
        'ri-computer-line',
        params.row.usage?.usedVms,
        params.row.quota?.maxVms,
        undefined,
        params.row.usage?.lastSyncedAt,
      ),
    },
    {
      field: 'quotaVnets',
      headerName: t('sdn.subtab.vnets'),
      width: 110,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => {
        const used = Array.isArray(params.row.vnets) ? params.row.vnets.length : 0
        return renderQuotaDonut('ri-git-branch-line', used, params.row.quota?.maxVnets)
      },
    },
    {
      field: 'pbsBindings',
      headerName: t('vdc.backups'),
      width: 110,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => {
        const bindings: any[] = Array.isArray(params.row.pbsBindings) ? params.row.pbsBindings : []
        const count = bindings.length
        const hasMissingPve = bindings.some((b) => !b.pveStorages?.length)
        const tooltip = count === 0 ? t('myVdc.cockpit.noBackups') : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {bindings.map((b) => (
              <Typography key={b.id} variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                {b.pbsConnectionName} • {b.datastore}{b.namespace ? ` / ${b.namespace}` : ''}
                {!b.pveStorages?.length && ` — ${t('vdc.pbsPveStorageMissing')}`}
              </Typography>
            ))}
          </Box>
        )

        const brokenBinding = hasMissingPve ? bindings.find((b) => !b.pveStorages?.length) : null

        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip arrow title={tooltip}>
              <Chip
                icon={<Box component="i" className="ri-database-2-line" sx={{ fontSize: 14, ml: '6px !important' }} />}
                label={count}
                size="small"
                color={count === 0 ? 'error' : hasMissingPve ? 'warning' : 'default'}
                variant={count === 0 ? 'outlined' : hasMissingPve ? 'outlined' : 'filled'}
                sx={{ height: 24, cursor: 'default' }}
              />
            </Tooltip>
            {brokenBinding && (
              <Tooltip arrow title={t('vdc.pbsRetryPveStorage')}>
                <IconButton
                  size="small"
                  color="warning"
                  onClick={async () => {
                    try {
                      const res = await fetch(
                        `/api/v1/admin/vdcs/${encodeURIComponent(params.row.id)}/pbs-bindings/${encodeURIComponent(brokenBinding.id)}/retry-pve-storage`,
                        { method: 'POST' },
                      )
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}))
                        setError(err.error || `HTTP ${res.status}`)
                      } else {
                        setSuccess(t('vdc.pbsPveStorageRetried'))
                        fetchVdcs()
                      }
                    } catch (e: any) {
                      setError(e?.message || String(e))
                    }
                  }}
                >
                  <i className="ri-refresh-line" style={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )
      },
    },
    {
      field: 'actions',
      headerName: '',
      width: 100,
      sortable: false,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title={t('common.edit')}>
            <IconButton size="small" onClick={() => handleEdit(params.row)}>
              <i className="ri-pencil-line" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <IconButton
              size="small"
              color="error"
              onClick={async () => {
                // Optimistically open the dialog with the current row so
                // the user gets immediate feedback, then refresh usage in
                // the background. Without this, the delete button stays
                // blocked on stale `usedVms` values when the user has
                // just torn down their VMs in PVE.
                setDeleteVdc(params.row)
                try {
                  const res = await fetch(
                    `/api/v1/admin/vdcs/${encodeURIComponent(params.row.id)}/usage?refresh=true`,
                    { cache: 'no-store' },
                  )
                  if (!res.ok) return
                  const json = await res.json()
                  const usage = json?.data?.usage
                  if (usage) {
                    setDeleteVdc((prev: any) => (prev?.id === params.row.id ? { ...prev, usage } : prev))
                  }
                } catch { /* ignore — keep stale usage, the server-side check will still refuse the delete if VMs remain */ }
              }}
            >
              <i className="ri-delete-bin-line" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ]

  // ------- Quota field row helper -------

  const renderQuotaField = (
    label: string,
    valueKey: keyof VdcFormState,
    unlimitedKey: keyof VdcFormState,
    cluster?: { total: number; unit: string },
  ) => {
    const unlimited = form[unlimitedKey] as boolean
    const numeric = Number.parseFloat((form[valueKey] as string) || '')
    const hasValue = !unlimited && Number.isFinite(numeric) && numeric > 0
    const overCap = !!cluster && cluster.total > 0 && hasValue && numeric > cluster.total
    const pct =
      cluster && cluster.total > 0 && hasValue
        ? Math.min(100, (numeric / cluster.total) * 100)
        : 0
    const barColor = overCap || pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success'

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="body2" sx={{ minWidth: 130 }}>
          {label}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={unlimited}
              onChange={(e) => {
                const v = e.target.checked
                setForm((f) => ({
                  ...f,
                  [unlimitedKey]: v,
                  ...(v ? { [valueKey]: '' } : {}),
                }))
              }}
            />
          }
          label={
            <Typography variant="caption">{t('vdc.quotaUnlimited')}</Typography>
          }
          sx={{ minWidth: 120 }}
        />
        <TextField
          type="number"
          size="small"
          value={form[valueKey] as string}
          onChange={(e) => {
            // Hard-cap against the cluster ceiling. If the cluster total
            // is known, clamp the typed value so the user can't allocate
            // more than the cluster physically has — same guard as the
            // Save-button gate, applied per keystroke for instant
            // feedback rather than letting the error linger.
            const raw = e.target.value
            if (raw === '' || !cluster || cluster.total <= 0) {
              setForm((f) => ({ ...f, [valueKey]: raw }))
              return
            }
            const n = Number.parseFloat(raw)
            const capped = Number.isFinite(n) && n > cluster.total ? String(cluster.total) : raw
            setForm((f) => ({ ...f, [valueKey]: capped }))
          }}
          disabled={unlimited}
          error={overCap}
          helperText={overCap ? t('vdc.quotaExceedsCluster', { total: cluster!.total, unit: cluster!.unit }) : undefined}
          sx={{ width: 120 }}
          slotProps={{ htmlInput: { min: 0, max: cluster?.total } }}
        />
        {cluster && cluster.total > 0 && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ ml: 'auto', minWidth: 220 }}>
            <LinearProgress
              variant="determinate"
              value={pct}
              color={barColor}
              sx={{ flex: 1, height: 6, borderRadius: 3, opacity: hasValue ? 1 : 0.35 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', minWidth: 110, textAlign: 'right' }}>
              {hasValue
                ? `${numeric.toLocaleString()} / ${cluster.total.toLocaleString()} ${cluster.unit} (${Math.round(pct)}%)`
                : `— / ${cluster.total.toLocaleString()} ${cluster.unit}`}
            </Typography>
          </Stack>
        )}
      </Box>
    )
  }

  // ------- Render -------

  // Cluster physical capacity derived from availableResources + the
  // currently selected primary storage. Computed once per render and
  // shared between renderQuotaField (the per-row progress bars) and
  // the Save-button gate (block when an existing edited vDC carries a
  // quota that exceeds today's cluster — e.g. a node was decommissioned
  // since the vDC was created).
  const clusterVcpuTotal = (availableResources?.nodes || []).reduce(
    (acc: number, n: any) => acc + (Number(n.maxcpu) || 0),
    0,
  )
  const clusterRamGbTotal = Math.round(
    (availableResources?.nodes || []).reduce(
      (acc: number, n: any) => acc + (Number(n.maxmem) || 0),
      0,
    ) / (1024 ** 3),
  )
  const clusterStorageGbTotal = (() => {
    const primary = (availableResources?.storages || []).find(
      (s: any) => s.id === form.primaryStorage,
    )
    return primary ? Math.round((Number(primary.maxdisk) || 0) / (1024 ** 3)) : 0
  })()

  const exceeds = (raw: string, total: number) => {
    if (!total) return false
    const n = Number.parseFloat(raw || '')
    return Number.isFinite(n) && n > total
  }
  const quotaOverCapacity =
    (!form.unlimitedVcpus && exceeds(form.maxVcpus, clusterVcpuTotal)) ||
    (!form.unlimitedRam && exceeds(form.maxRamGb, clusterRamGbTotal)) ||
    (!form.unlimitedStorage && exceeds(form.maxStorageGb, clusterStorageGbTotal))

  // One vDC per (tenant, connection): the Cluster picker only offers
  // clusters the tenant doesn't cover yet. Enforced server-side by
  // createVdc + a DB unique; here we just shape the picker options.
  const existingTenantVdcs = !editingVdc && form.tenantId
    ? vdcs.filter((v: any) => v.tenantId === form.tenantId)
    : []
  const tenantHasExistingVdc = existingTenantVdcs.length > 0
  const occupiedConnectionIds = new Set(existingTenantVdcs.map((v: any) => v.connectionId))
  // vDCs may only slice provider-pool connections (IaaS/MSP exclusivity) —
  // an MSP-owned connection can appear in `connections` (it's still a `pve`
  // connection) but must never be offered as a cluster to carve a vDC from.
  const poolConnections = connections.filter((c: any) => c.inProviderPool)
  const allClustersUsed =
    tenantHasExistingVdc && poolConnections.length > 0 &&
    poolConnections.every((c) => occupiedConnectionIds.has(c.id))

  // Dialog sections that depend on the selected connection: a hint until one
  // is picked, progress while /available-resources loads, the content after.
  const connectionGated = (content: ReactNode) => {
    if (!form.connectionId) {
      return <Typography variant="body2" color="text.secondary">{t('vdc.selectConnectionFirst')}</Typography>
    }
    if (resourcesLoading) {
      return (
        <Box sx={{ py: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('vdc.loadingResources')}
          </Typography>
          <LinearProgress />
        </Box>
      )
    }
    return availableResources ? content : null
  }

  // VXLAN transport (#899): derived state of the Network section.
  const transportDirtyFlag = !!editingVdc && transportDirty(transport, editingVdc.transport)
  const peerEntries = splitPeers(transport.peersText)
  const invalidPeer = firstInvalidAddress(peerEntries)
  const validPeers = peerEntries.filter((p) => ipFamily(p) !== null)
  const missingPeerNodes = transport.mode === 'peers' ? nodesWithoutPeer(validPeers, nodeAddressInfo.nodes) : []
  const mtuNumber = transport.mtu.trim() ? Number(transport.mtu) : null
  const mtuInvalid = mtuNumber !== null && (!Number.isInteger(mtuNumber) || mtuNumber < ZONE_MTU_MIN || mtuNumber > ZONE_MTU_MAX)
  const vlanNumber = /^\d+$/.test(transport.vlanId.trim()) ? Number(transport.vlanId) : null
  const vlanInvalid = transport.vlanId.trim() !== '' && (vlanNumber === null || vlanNumber < 1 || vlanNumber > 4094)
  const transportCidr = parseCidr(transport.cidr)
  const cidrInvalid = transport.cidr.trim() !== '' && !transportCidr
  const transportIface = transportIfaceName({ device: transport.device.trim() || null, vlanId: vlanInvalid ? null : vlanNumber })
  const transportNodeNames = (() => {
    const names = nodeAddressInfo.nodes.map((n) => n.name)
    for (const name of Object.keys(transport.nodeAddresses)) if (!names.includes(name)) names.push(name)
    return names
  })()
  // Diagram of the section: what each node contributes as a zone peer in the
  // current mode, and the peers that belong to no node of the cluster.
  const sameIp = (a: string, b: string) => (normalizeIp(a) ?? a) === (normalizeIp(b) ?? b)
  const diagramNodes = nodeAddressInfo.nodes.map((n) => ({
    name: n.name,
    address:
      transport.mode === 'cluster'
        ? n.clusterIp ?? null
        : transport.mode === 'transport'
          ? transport.nodeAddresses[n.name] ?? null
          : validPeers.find((peer) => n.addresses.some((a) => sameIp(a, peer))) ?? null,
  }))
  const diagramExternalPeers = transport.mode === 'cluster'
    ? []
    : validPeers.filter((peer) => !diagramNodes.some((n) => n.address && sameIp(n.address, peer)))
  // Nothing left to provision: every listed node already carries the
  // interface with the wanted address and MTU. A node that did not answer,
  // or that differs, keeps the button active for a retry.
  const transportAllProvisioned = !!transportStatus && transportStatus.length > 0 && transportStatus.every((s) => s.state === 'provisioned')
  // Same glyph as the vDC list: Proxmox logo with the status dot. The list's
  // status map is preferred; the node-addresses answer is the fallback.
  const transportNodeStatus = (name: string): string | undefined => {
    const fromList = nodeStatuses[`${form.connectionId}|${name}`]
    if (fromList) return fromList
    const entry = nodeAddressInfo.nodes.find((n) => n.name === name)
    return entry ? (entry.online ? 'online' : 'offline') : undefined
  }
  const renderNodeGlyph = (name: string, size = 16) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <NodeIcon status={transportNodeStatus(name)} size={size} />
      <Typography variant="body2" noWrap>{name}</Typography>
    </Box>
  )

  const renderPeerChips = (label: string, peers: string[], mtu: number | null) => (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: { sm: 144 }, flexShrink: 0, pt: { sm: 0.25 } }}>{label}</Typography>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
        {peers.length === 0 ? (
          <Typography variant="caption" sx={{ fontStyle: 'italic' }}>{t('vdc.zoneNoPeers')}</Typography>
        ) : (
          peers.map((p) => <Chip key={p} size="small" variant="outlined" label={p} />)
        )}
        <Chip size="small" label={mtu != null ? t('vdc.zoneMtu', { mtu }) : t('vdc.zoneMtuDefault')} />
      </Stack>
    </Stack>
  )

  // Explanations live in tooltips (same glyph as the Storage tab); only a
  // validation error is written under a field. The icon is offset to sit on
  // the vertical centre of a small input whatever the helper text below.
  const hintIcon = (title: ReactNode, offset = true, wide = false) => (
    <Tooltip arrow placement="top" title={title} slotProps={wide ? { tooltip: { sx: { maxWidth: 460 } } } : undefined}>
      <Box component="i" className="ri-information-line" sx={{ fontSize: 14, opacity: 0.55, cursor: 'help', flexShrink: 0, ...(offset ? { mt: '11px' } : {}) }} />
    </Tooltip>
  )
  // Field help as an end adornment, so every field keeps its full width and
  // the rows of the card stay aligned on the right edge. `insideSelect`
  // leaves room for the dropdown arrow of a Select.
  const hintAdornment = (title: ReactNode, opts: { wide?: boolean; insideSelect?: boolean } = {}) => (
    <InputAdornment position="end" sx={{ mr: opts.insideSelect ? 3.5 : 0, pointerEvents: 'auto' }}>
      {hintIcon(title, false, opts.wide)}
    </InputAdornment>
  )
  const renderPeersField = (label: string, hint: string) => (
    <TextField
      multiline
      minRows={2}
      fullWidth
      size="small"
      label={label}
      value={transport.peersText}
      onChange={(e) => setTransport((p) => ({ ...p, peersText: e.target.value }))}
      error={!!invalidPeer}
      helperText={invalidPeer ? t('vdc.transportInvalidAddress', { address: invalidPeer }) : undefined}
      slotProps={{ input: { endAdornment: hintAdornment(hint) } }}
    />
  )

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Tabs
        value={activeSection}
        onChange={(_e, v) => setActiveSection(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          value="vdcs"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-cloud-line" style={{ fontSize: 18 }} />
              {t('vdc.title')}
            </Box>
          }
        />
        <Tab
          value="policies"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-hard-drive-2-line" style={{ fontSize: 18 }} />
              {t('vdc.storagePoliciesTitle')}
            </Box>
          }
        />
        <Tab
          value="networks"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-git-branch-line" style={{ fontSize: 18 }} />
              {t('vdc.tenantNetworksTitle')}
            </Box>
          }
        />
        <Tab
          value="help"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-question-line" style={{ fontSize: 18 }} />
              {t('vdc.helpTitle')}
            </Box>
          }
        />
      </Tabs>

      {activeSection === 'policies' && <StoragePoliciesSection connections={connections} />}
      {activeSection === 'networks' && <TenantNetworksSection tenants={tenants} vdcs={vdcs} connections={connections} />}
      {activeSection === 'help' && <VdcHelpSection />}

      {activeSection === 'vdcs' && (
      <Card>
        <CardContent>
          {/* A vDC always lives in a non-default tenant — the provider tenant
              owns connections directly and the create form filters `default`
              out of the picker. When no other tenant exists yet, disable the
              Create buttons so the operator doesn't open an empty-dropdown
              form they can't submit. */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6">{t('vdc.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('vdc.subtitle')}
              </Typography>
            </Box>
            <Tooltip title={tenants.filter(tn => tn.id !== 'default').length === 0 ? t('vdc.createNeedsTenant') : ''}>
              <span>
                <Button
                  variant="contained"
                  startIcon={<i className="ri-add-line" />}
                  onClick={handleCreate}
                  disabled={tenants.filter(tn => tn.id !== 'default').length === 0}
                >
                  {t('vdc.newVdc')}
                </Button>
              </span>
            </Tooltip>
          </Box>

          {loading ? (
            <LinearProgress />
          ) : vdcs.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <i className="ri-cloud-line" style={{ fontSize: 48, opacity: 0.3 }} />
              <Typography variant="h6" sx={{ mt: 2 }}>
                {t('vdc.noVdcs')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {tenants.filter(tn => tn.id !== 'default').length === 0
                  ? t('vdc.createNeedsTenant')
                  : t('vdc.noVdcsDesc')}
              </Typography>
              <Tooltip title={tenants.filter(tn => tn.id !== 'default').length === 0 ? t('vdc.createNeedsTenant') : ''}>
                <span>
                  <Button
                    variant="contained"
                    startIcon={<i className="ri-add-line" />}
                    onClick={handleCreate}
                    disabled={tenants.filter(tn => tn.id !== 'default').length === 0}
                  >
                    {t('vdc.newVdc')}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          ) : (
            <DataGrid
              rows={vdcs}
              columns={columns}
              autoHeight
              rowHeight={68}
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              getRowClassName={(p) => p.row.enabled === false ? 'vdc-row-disabled' : ''}
              sx={{
                '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' },
                '& .vdc-row-disabled': { opacity: 0.55 },
              }}
            />
          )}
        </CardContent>
      </Card>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingVdc ? t('vdc.edit') : t('vdc.create')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <Tabs
            value={dialogTab}
            onChange={(_, v) => setDialogTab(v)}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ borderBottom: 1, borderColor: 'divider', mb: 1, minHeight: 44, '& .MuiTab-root': { minHeight: 44 } }}
          >
            <Tab icon={<i className="ri-information-line" />} iconPosition="start" label={t('vdc.tabGeneral')} />
            <Tab
              icon={<i className="ri-database-2-line" />}
              iconPosition="start"
              label={
                <Badge variant="dot" color="error" invisible={!!form.primaryStorage} sx={{ '& .MuiBadge-badge': { right: -8, top: 3 } }}>
                  {t('vdc.tabStorage')}
                </Badge>
              }
            />
            <Tab icon={<i className="ri-cpu-line" />} iconPosition="start" label={t('vdc.tabCompute')} />
            <Tab icon={<i className="ri-router-line" />} iconPosition="start" label={t('vdc.tabNetwork')} />
            <Tab icon={<i className="ri-speed-up-line" />} iconPosition="start" label={t('vdc.tabQuotas')} />
          </Tabs>

          {/* General: identity, tenant, cluster */}
          <TabPanel value={dialogTab} index={0}>
          {/* Tenant — drives the vDC name and slug. Picking a tenant fills
              name (= tenant.name) and slug (= sluggified tenant + later
              the connection too). The slug field is no longer exposed —
              it's a derived identifier the user shouldn't tune. */}
          <Autocomplete
            fullWidth
            options={tenants.filter((t) => editingVdc ? true : t.id !== 'default')}
            getOptionLabel={(o) => o.name || o.slug || o.id}
            value={tenants.find((t) => t.id === form.tenantId) || null}
            onChange={(_, v) => {
              if (!v) { setForm((f) => ({ ...f, tenantId: '' })); return }
              if (editingVdc) { setForm((f) => ({ ...f, tenantId: v.id })); return }
              // If the picked tenant already occupies the currently selected
              // cluster, drop that selection — its option is hidden below.
              const occupied = !!form.connectionId &&
                vdcs.some((x: any) => x.tenantId === v.id && x.connectionId === form.connectionId)
              const connectionId = occupied ? '' : form.connectionId
              setForm((f) => ({
                ...f,
                tenantId: v.id,
                connectionId,
                ...(occupied ? { nodes: [], primaryStorage: '' } : {}),
                slug: computeVdcSlug(v, connectionId),
              }))
              if (occupied) setAvailableResources(null)
            }}
            disabled={!!editingVdc}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('vdc.tenant')}
                placeholder={t('vdc.selectTenant')}
                required
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <InputAdornment position="start">
                      <i className="ri-building-line" style={{ fontSize: 18, color: 'var(--mui-palette-primary-main)' }} />
                    </InputAdornment>
                  ),
                }}
              />
            )}
          />

          {/* Name — optional; leaving it empty falls back to the derived
              "tenant — cluster" name at submit time (see handleSave). The
              placeholder previews that derived name so an empty field reads
              as an obvious, safe default rather than a mistake. */}
          <TextField
            label={t('vdc.name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={computeVdcName(tenants.find((tn) => tn.id === form.tenantId) ?? null, form.connectionId)}
            helperText={t('vdc.nameHelper')}
            fullWidth
          />

          {/* Informational: lists the tenant's existing vDCs (with their
              clusters). Turns into a warning when every cluster is taken —
              in that state nothing is selectable below. */}
          {allClustersUsed && (
            <Alert severity="warning">
              {t('vdc.tenantAllClustersUsed')}
            </Alert>
          )}

          {/* Description */}
          <TextField
            label={t('vdc.description')}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            fullWidth
            multiline
            rows={2}
          />

          {/* Connection / Cluster */}
          <Autocomplete
            fullWidth
            options={editingVdc ? connections : poolConnections.filter((c) => !occupiedConnectionIds.has(c.id))}
            getOptionLabel={(o) => o.name || o.id}
            value={connections.find((c) => c.id === form.connectionId) || null}
            onChange={(_, v) => {
              setForm((f) => {
                if (editingVdc) {
                  return { ...f, connectionId: v?.id || '', nodes: [], primaryStorage: '' }
                }
                // Re-derive the slug now that the connection is known — see
                // computeVdcSlug. The slug must be unique per tenant (DB:
                // unique(tenant_id, slug)), which the cluster suffix provides
                // across clusters. `name` is left alone: it's user-editable
                // (see the Name field above) and only falls back to the
                // derived name at submit time (see handleSave).
                const tenant = tenants.find((tn) => tn.id === f.tenantId) || null
                return {
                  ...f,
                  connectionId: v?.id || '',
                  nodes: [],
                  primaryStorage: '',
                  slug: computeVdcSlug(tenant, v?.id || ''),
                }
              })
              setAvailableResources(null)
            }}
            disabled={!!editingVdc}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('vdc.connection')}
                placeholder={t('vdc.selectConnection')}
                required
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <InputAdornment position="start">
                      <i className="ri-cloud-line" style={{ fontSize: 18, color: 'var(--mui-palette-primary-main)' }} />
                    </InputAdornment>
                  ),
                }}
              />
            )}
          />

          {!editingVdc && form.connectionId && (
            <TextField
              size="small"
              fullWidth
              label={t('vdc.sdnZoneIdLabel')}
              value={form.sdnZoneName}
              onChange={(e) => setForm((f) => ({ ...f, sdnZoneName: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') }))}
              placeholder={t('vdc.sdnZoneIdHelper')}
              helperText={
                form.sdnZoneName && !/^[a-z][a-z0-9]{0,7}$/.test(form.sdnZoneName)
                  ? t('vdc.sdnZoneIdInvalid')
                  : t('vdc.sdnZoneIdHelper')
              }
              error={!!form.sdnZoneName && !/^[a-z][a-z0-9]{0,7}$/.test(form.sdnZoneName)}
              slotProps={{ htmlInput: { maxLength: 8 } }}
            />
          )}
          </TabPanel>

          {/* Storage: primary storage, QoS storage policies, then PBS backup targets */}
          <TabPanel value={dialogTab} index={1}>
            {connectionGated(
              <>
                  {/* Primary storage — the single shared storage backing
                      all VM disks for this vDC. /available-resources
                      already filters to shared+images candidates, so
                      whichever the admin picks is HA-capable. Local
                      and ISO/backup-only storages never reach this list. */}
                  {(() => {
                    const candidates: Array<{ id: string; type: string; maxdisk?: number; disk?: number }> =
                      availableResources?.storages || []
                    if (candidates.length === 0) {
                      return (
                        <Alert severity="error" sx={{ mt: 1 }} icon={<i className="ri-error-warning-line" style={{ fontSize: 18 }} />}>
                          {t('vdc.noSharedStorage')}
                        </Alert>
                      )
                    }
                    return (
                      <Box>
                        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1.5 }}>
                          <Typography variant="subtitle2">
                            {t('vdc.primaryStorageTitle')}
                          </Typography>
                          <Tooltip arrow title={t('vdc.primaryStorageHint')} placement="top">
                            <Box component="i" className="ri-information-line" sx={{ fontSize: 14, opacity: 0.55, cursor: 'help' }} />
                          </Tooltip>
                        </Stack>
                        <FormControl fullWidth size="small" required>
                          <InputLabel>{t('vdc.primaryStorageLabel')}</InputLabel>
                          <Select
                            value={form.primaryStorage}
                            label={t('vdc.primaryStorageLabel')}
                            onChange={(e) => setForm((f) => ({ ...f, primaryStorage: String(e.target.value) }))}
                          >
                            {candidates.map((s) => {
                              const totalGb = (s.maxdisk || 0) / (1024 ** 3)
                              const usedGb = (s.disk || 0) / (1024 ** 3)
                              const pct = s.maxdisk ? Math.min(100, (usedGb / totalGb) * 100) : 0
                              return (
                                <MenuItem key={s.id} value={s.id}>
                                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%' }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 140 }}>
                                      {s.id}
                                    </Typography>
                                    <Chip size="small" label={s.type} sx={{ height: 18, fontSize: 10 }} />
                                    {s.maxdisk ? (
                                      <Stack direction="row" alignItems="center" spacing={1} sx={{ ml: 'auto' }}>
                                        <LinearProgress
                                          variant="determinate"
                                          value={pct}
                                          color={pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success'}
                                          sx={{ width: 80, height: 6, borderRadius: 3 }}
                                        />
                                        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                                          {usedGb.toFixed(0)} / {totalGb.toFixed(0)} GB ({Math.round(pct)}%)
                                        </Typography>
                                      </Stack>
                                    ) : null}
                                  </Stack>
                                </MenuItem>
                              )
                            })}
                          </Select>
                        </FormControl>
                      </Box>
                    )
                  })()}

                  {/* Storage policy assignments (storage policies + QoS, P3) */}
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-database-2-line" />
                        {t('vdc.vdcPoliciesTitle')}
                      </Typography>
                      <Tooltip title={connPolicies.length === 0 ? t('vdc.storagePolicyNoneOnConnection') : vdcPolicies.length >= connPolicies.length ? t('vdc.storagePolicyAllAttached') : t('vdc.vdcPolicyAdd')} arrow>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={t('vdc.vdcPolicyAdd')}
                            onClick={() => setVdcPolicies((prev) => [...prev, { policyId: '', quotaGb: '' }])}
                            disabled={connPolicies.length === 0 || vdcPolicies.length >= connPolicies.length}
                          >
                            <i className="ri-add-line" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{t('vdc.vdcPoliciesHint')}</Typography>
                    {connPolicies.length === 0 && (
                      <Alert severity="info" sx={{ mt: 1, py: 0 }}>{t('vdc.storagePolicyNoneOnConnection')}</Alert>
                    )}
                    {connPolicies.length > 0 && vdcPolicies.length >= connPolicies.length && (
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>{t('vdc.storagePolicyAllAttached')}</Typography>
                    )}

                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {vdcPolicies.map((sp, idx) => {
                        const takenByOthers = new Set(vdcPolicies.filter((_, i) => i !== idx).map((p) => p.policyId))
                        const options = connPolicies.filter((p) => !takenByOthers.has(p.id) || p.id === sp.policyId)
                        return (
                          <Stack key={idx} direction="row" spacing={1} alignItems="flex-start">
                            <TextField
                              select size="small" sx={{ flex: 1, minWidth: 200 }}
                              label={t('vdc.storagePolicyName')}
                              value={sp.policyId}
                              onChange={(e) => setVdcPolicies((prev) => prev.map((p, i) => i === idx ? { ...p, policyId: e.target.value } : p))}
                              slotProps={{
                                select: {
                                  // The MenuItem body is two stacked lines (name + storage);
                                  // MUI would render both inside the CLOSED control and
                                  // overflow it, so the closed state shows the name only.
                                  renderValue: (value) => (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      <i className="ri-database-2-line" style={{ fontSize: 15, opacity: 0.7 }} />
                                      {connPolicies.find((p) => p.id === (value as string))?.name ?? ''}
                                    </Box>
                                  ),
                                },
                              }}
                            >
                              {options.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                  <Box>
                                    <Typography variant="body2">{p.name}</Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <i className="ri-hard-drive-2-line" style={{ fontSize: 13, opacity: 0.6 }} />
                                      <Typography variant="caption" color="text.secondary">{p.storageId}</Typography>
                                    </Box>
                                  </Box>
                                </MenuItem>
                              ))}
                            </TextField>
                            <TextField
                              size="small" type="number" label={t('vdc.vdcPolicyQuotaGb')}
                              sx={{ width: 160, flexShrink: 0 }}
                              value={sp.quotaGb}
                              onChange={(e) => setVdcPolicies((prev) => prev.map((p, i) => i === idx ? { ...p, quotaGb: e.target.value } : p))}
                              slotProps={{ htmlInput: { min: 1 } }}
                              helperText={t('vdc.vdcPolicyUnlimited')}
                            />
                            <IconButton size="small" sx={{ mt: 0.75, flexShrink: 0 }} onClick={() => setVdcPolicies((prev) => prev.filter((_, i) => i !== idx))}>
                              <i className="ri-delete-bin-line" />
                            </IconButton>
                          </Stack>
                        )
                      })}
                    </Stack>
                  </Box>

                  {/* ISO library (#894): read-only ISO storages the tenant may
                      mount on a CD/DVD drive. Excludes the primary storage and
                      the policied storages, which are already writable. */}
                  {(() => {
                    const policiedStorages = new Set(
                      vdcPolicies
                        .map((sp) => connPolicies.find((p) => p.id === sp.policyId)?.storageId)
                        .filter((s): s is string => !!s),
                    )
                    const candidates = isoStorageCandidates.filter(
                      (s) => s.storage !== form.primaryStorage && !policiedStorages.has(s.storage),
                    )
                    const known = new Set(candidates.map((s) => s.storage))
                    const rows = [
                      ...candidates.map((s) => ({ ...s, missing: false })),
                      ...isoLibraries
                        .filter((l) => !known.has(l.storageId))
                        .map((l) => ({ storage: l.storageId, type: '', shared: false, missing: true })),
                    ]
                    return (
                      <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-disc-line" />
                          {t('vdc.isoLibraryTitle')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">{t('vdc.isoLibraryHint')}</Typography>

                        {rows.length === 0 ? (
                          <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                            {t('vdc.isoLibraryNone')}
                          </Typography>
                        ) : (
                          <Stack spacing={0.5} sx={{ mt: 1 }}>
                            {rows.map((s) => {
                              const grant = isoLibraries.find((l) => l.storageId === s.storage)
                              const checked = !!grant
                              return (
                                <Box key={s.storage}>
                                  <FormControlLabel
                                    control={
                                      <Checkbox
                                        checked={checked}
                                        onChange={(e) => {
                                          setIsoLibraries((prev) =>
                                            e.target.checked
                                              ? (prev.some((l) => l.storageId === s.storage)
                                                  ? prev
                                                  : [...prev, { storageId: s.storage, allowUploads: false }])
                                              : prev.filter((l) => l.storageId !== s.storage),
                                          )
                                        }}
                                      />
                                    }
                                    label={
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography>{s.storage}</Typography>
                                        {s.missing ? (
                                          <Typography variant="caption" color="warning.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <i className="ri-error-warning-line" style={{ fontSize: 14 }} />
                                            {t('vdc.isoLibraryMissing')}
                                          </Typography>
                                        ) : (
                                          <Typography variant="caption" color="text.secondary">
                                            {s.type} · {s.shared ? t('vdc.isoLibraryShared') : t('vdc.isoLibraryPerNode')}
                                          </Typography>
                                        )}
                                      </Box>
                                    }
                                  />
                                  {grant && (
                                    <Box sx={{ ml: 4, mb: 0.5 }}>
                                      <FormControlLabel
                                        control={
                                          <Switch
                                            size="small"
                                            checked={grant.allowUploads}
                                            onChange={(e) => {
                                              setIsoLibraries((prev) =>
                                                prev.map((l) => (l.storageId === s.storage ? { ...l, allowUploads: e.target.checked } : l)),
                                              )
                                            }}
                                          />
                                        }
                                        label={<Typography variant="body2">{t('vdc.isoLibraryAllowUploads')}</Typography>}
                                      />
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                        {t('vdc.isoLibraryAllowUploadsHint')}
                                      </Typography>
                                    </Box>
                                  )}
                                </Box>
                              )
                            })}
                          </Stack>
                        )}
                      </Box>
                    )
                  })()}

                  {/* PBS bindings (only when editing an existing vDC).
                      The Pool / Nodes / Storages summary that used to live
                      here was dropped: a vDC now spans the entire cluster
                      so the per-node CPU/RAM bars and per-storage usage
                      bars added noise without informing any decision the
                      admin can still make in this modal. */}
                  {editingVdc && (
                    <VdcPbsBindingsSection
                      vdcId={editingVdc.id}
                      tenantSlug={getTenantSlug(editingVdc.tenantId) || 'tenant'}
                      vdcSlug={editingVdc.slug || form.slug}
                      pbsConnections={pbsConnections}
                    />
                  )}

                  {/* Create-time PBS draft. Lets the admin attach a backup
                      target right at vDC creation instead of forcing a
                      two-step "create then bind" flow. The form mirrors
                      VdcPbsBindingsSection but does not POST to the server
                      — the parent submit handler chains the binding call
                      after the vDC is created. Multiple bindings are still
                      added later from the edit dialog. */}
                  {!editingVdc && (
                    <>
                      <Box>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                          <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-save-3-line" />
                            {t('vdc.pbsBindings')}
                          </Typography>
                          <Box sx={{ flex: 1 }} />
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={pbsDraft.enabled}
                                onChange={(e) => setPbsDraft((d) => ({ ...d, enabled: e.target.checked }))}
                                disabled={pbsConnections.length === 0}
                              />
                            }
                            label={
                              <Typography variant="caption" color="text.secondary">
                                {t('vdc.pbsConfigureAtCreate')}
                              </Typography>
                            }
                          />
                        </Stack>
                        {pbsConnections.length === 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontStyle: 'italic' }}>
                            {t('vdc.pbsNoConnections')}
                          </Typography>
                        )}
                        {pbsDraft.enabled && pbsConnections.length > 0 && (
                          <Stack spacing={1.5} sx={{ mt: 1 }}>
                            <Stack direction="row" alignItems="center" spacing={0.75}>
                              <FormControlLabel
                                control={
                                  <Switch
                                    size="small"
                                    checked={pbsDraft.mode === 'auto'}
                                    onChange={(e) =>
                                      setPbsDraft((d) => ({
                                        ...d,
                                        mode: e.target.checked ? 'auto' : 'manual',
                                        pbsConnectionId: '',
                                        datastore: '',
                                      }))
                                    }
                                  />
                                }
                                label={<Typography variant="caption">{t('vdc.pbsModeAuto')}</Typography>}
                              />
                              <Tooltip
                                arrow
                                placement="top"
                                title={pbsDraft.mode === 'auto' ? t('vdc.pbsModeAutoHint') : t('vdc.pbsModeManualHint')}
                              >
                                <Box component="i" className="ri-information-line" sx={{ fontSize: 14, opacity: 0.55, cursor: 'help' }} />
                              </Tooltip>
                            </Stack>
                            <TextField
                              select
                              size="small"
                              required
                              label={t('vdc.pbsPbsConnection')}
                              value={pbsDraft.pbsConnectionId}
                              onChange={(e) =>
                                setPbsDraft((d) => ({ ...d, pbsConnectionId: e.target.value, datastore: '' }))
                              }
                              fullWidth
                            >
                              {(pbsDraft.mode === 'auto'
                                ? pbsConnections.filter((c) => c.fingerprint)
                                : pbsConnections
                              ).map((c) => (
                                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                              ))}
                            </TextField>
                            <TextField
                              select
                              size="small"
                              required
                              label={t('vdc.pbsDatastore')}
                              value={pbsDraft.datastore}
                              onChange={(e) => setPbsDraft((d) => ({ ...d, datastore: e.target.value }))}
                              disabled={!pbsDraft.pbsConnectionId}
                              fullWidth
                            >
                              {pbsDraftDatastores.map((d) => (
                                <MenuItem key={d} value={d}>{d}</MenuItem>
                              ))}
                            </TextField>
                            <TextField
                              size="small"
                              required
                              label={t('vdc.pbsNamespace')}
                              value={pbsDraft.namespace}
                              onChange={(e) => setPbsDraft((d) => ({ ...d, namespace: e.target.value }))}
                              helperText={t('vdc.pbsNamespaceHelper')}
                              fullWidth
                            />
                          </Stack>
                        )}
                      </Box>
                    </>
                  )}
              </>
            )}
          </TabPanel>

          {/* Compute: CPU models the tenant may pick, advanced CPU controls (#893) */}
          <TabPanel value={dialogTab} index={2}>
            {connectionGated(
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-cpu-line" />
                      {t('vdc.computePolicyTitle')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{t('vdc.computePolicyHint')}</Typography>

                    <Stack spacing={2} sx={{ mt: 2 }}>
                      <TextField
                        select size="small" fullWidth
                        label={t('vdc.cpuModelMode')}
                        value={computePolicy.cpuModelMode}
                        onChange={(e) => {
                          const mode = e.target.value as CpuModelMode
                          setComputePolicy((p) => sanitizeDefaultModel({ ...p, cpuModelMode: mode }, customCpuModels))
                        }}
                        helperText={t(CPU_MODE_KEYS[computePolicy.cpuModelMode].hint)}
                        slotProps={{
                          select: {
                            // The MenuItem body is two stacked lines; the closed
                            // control shows the label alone.
                            renderValue: (value) => t(CPU_MODE_KEYS[value as CpuModelMode].label),
                          },
                        }}
                      >
                        {(Object.keys(CPU_MODE_KEYS) as CpuModelMode[]).map((mode) => (
                          <MenuItem key={mode} value={mode}>
                            <Box>
                              <Typography variant="body2">{t(CPU_MODE_KEYS[mode].label)}</Typography>
                              <Typography variant="caption" color="text.secondary">{t(CPU_MODE_KEYS[mode].hint)}</Typography>
                            </Box>
                          </MenuItem>
                        ))}
                      </TextField>

                      {computePolicy.cpuModelMode === 'custom' && (
                        customCpuModels.length > 0 ? (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                              {t('vdc.cpuCustomModelsDetected', { count: customCpuModels.length })}
                            </Typography>
                            {customCpuModels.map((m) => (
                              <Chip key={m} label={m} size="small" variant="outlined" />
                            ))}
                          </Box>
                        ) : (
                          <Alert severity="info" sx={{ py: 0 }}>{t('vdc.cpuNoCustomModels')}</Alert>
                        )
                      )}

                      {computePolicy.cpuModelMode === 'selected' && (
                        <Autocomplete
                          multiple size="small" fullWidth
                          options={[...customCpuModels, ...KNOWN_CPU_TYPES]}
                          value={computePolicy.cpuAllowedModels}
                          onChange={(_, value) => {
                            setComputePolicy((p) => sanitizeDefaultModel({ ...p, cpuAllowedModels: value }, customCpuModels))
                          }}
                          renderInput={(params) => <TextField {...params} label={t('vdc.cpuAllowedModels')} />}
                        />
                      )}

                      <TextField
                        select size="small" fullWidth
                        label={t('vdc.cpuDefaultModel')}
                        value={computePolicy.cpuDefaultModel}
                        onChange={(e) => setComputePolicy((p) => ({ ...p, cpuDefaultModel: e.target.value }))}
                      >
                        <MenuItem value="">{t('vdc.cpuDefaultModelAuto')}</MenuItem>
                        {defaultModelOptionsFor(computePolicy, customCpuModels).map((m) => (
                          <MenuItem key={m} value={m}>{m}</MenuItem>
                        ))}
                      </TextField>

                      <Box>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={computePolicy.cpuAdvancedSettings}
                              onChange={(e) => setComputePolicy((p) => ({ ...p, cpuAdvancedSettings: e.target.checked }))}
                            />
                          }
                          label={t('vdc.cpuAdvancedSettings')}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {t('vdc.cpuAdvancedSettingsHint')}
                        </Typography>
                      </Box>
                    </Stack>
                  </Box>
            )}
          </TabPanel>

          {/* Network: the tenant's SDN zone, provider uplinks, VLAN pools */}
          <TabPanel value={dialogTab} index={3}>
            {connectionGated(
              <>
                  {/* VXLAN transport (#899): how the tenant zone reaches its peers */}
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1.5}>
                      <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-route-line" />
                        {t('vdc.transportTitle')}
                        {hintIcon(t('vdc.transportHint'), false)}
                      </Typography>
                      {editingVdc?.sdnZoneName && (
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" flexWrap="wrap" useFlexGap sx={{ ml: 'auto' }}>
                          <Tooltip arrow placement="top" title={
                            <Stack spacing={0.5}>
                              <Typography variant="caption">{t('vdc.sdnZoneHint')}</Typography>
                              {Array.isArray(editingVdc.vnets) && (
                                <Typography variant="caption">{t('vdc.zoneVnetCount', { count: editingVdc.vnets.length })}</Typography>
                              )}
                            </Stack>
                          }>
                            <Chip label={editingVdc.sdnZoneName} size="small" variant="outlined" />
                          </Tooltip>
                          {zoneStatus && (
                            <Chip
                              size="small"
                              color={zoneStatus.live === null ? 'error' : zoneStatus.inSync ? 'success' : 'warning'}
                              label={zoneStatus.live === null ? t('vdc.zoneNotFound') : zoneStatus.inSync ? t('vdc.zoneInSync') : t('vdc.zoneOutOfSync')}
                            />
                          )}
                          {zoneStatus?.live?.state && (
                            <Chip size="small" color="info" variant="outlined" label={t('vdc.zonePendingApply')} />
                          )}
                          <Tooltip arrow placement="top" title={transportDirtyFlag ? t('vdc.transportSaveFirst') : ''}>
                            <span>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<i className="ri-refresh-line" />}
                                disabled={transportDirtyFlag || zoneLoading}
                                onClick={handleSyncZone}
                              >
                                {t('vdc.zoneSync')}
                              </Button>
                            </span>
                          </Tooltip>
                        </Stack>
                      )}
                    </Stack>

                    <Stack spacing={2} sx={{ mt: 2 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                          select
                          size="small"
                          fullWidth
                          sx={SMALL_SELECT_SX}
                          label={t('vdc.transportMode')}
                          value={transport.mode}
                          onChange={(e) => setTransport((p) => ({ ...p, mode: e.target.value as VxlanTransportMode }))}
                        >
                          {TRANSPORT_MODES.map((m) => (
                            <MenuItem key={m} value={m}>{t(TRANSPORT_MODE_KEYS[m].label)}</MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          type="number"
                          label={t('vdc.transportMtu')}
                          sx={{ width: { xs: '100%', sm: 240 }, flexShrink: 0 }}
                          value={transport.mtu}
                          placeholder={t('vdc.transportMtuDefault')}
                          onChange={(e) => setTransport((p) => ({ ...p, mtu: e.target.value }))}
                          error={mtuInvalid}
                          helperText={mtuInvalid ? t('vdc.transportMtuInvalid', { min: ZONE_MTU_MIN, max: ZONE_MTU_MAX }) : undefined}
                          slotProps={{
                            htmlInput: { min: ZONE_MTU_MIN, max: ZONE_MTU_MAX },
                            input: { endAdornment: hintAdornment(t('vdc.transportMtuHint')) },
                          }}
                        />
                      </Stack>

                      <TransportModeDiagram
                        mode={transport.mode}
                        nodes={diagramNodes}
                        externalPeers={diagramExternalPeers}
                        iface={transportIface}
                        segment={transport.cidr.trim() || null}
                      />

                      {transport.mode === 'peers' && (
                        <>
                          {renderPeersField(t('vdc.transportPeers'), t('vdc.transportPeersHint'))}
                          {missingPeerNodes.length > 0 && (
                            <Alert severity="warning" sx={{ py: 0 }}>
                              {t('vdc.transportNodesWithoutPeer', { nodes: missingPeerNodes.join(', ') })}
                            </Alert>
                          )}
                        </>
                      )}

                      {transport.mode === 'transport' && (
                        <>
                          <Stack spacing={0.75}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                              <TextField
                                size="small"
                                type="number"
                                label={t('vdc.transportVlanId')}
                                sx={{ width: { sm: 160 }, flexShrink: 0 }}
                                value={transport.vlanId}
                                onChange={(e) => setTransport((p) => ({ ...p, vlanId: e.target.value }))}
                                error={vlanInvalid}
                                helperText={vlanInvalid ? t('vdc.transportVlanInvalid') : undefined}
                                slotProps={{ htmlInput: { min: 1, max: 4094 } }}
                              />
                              <Autocomplete
                                freeSolo
                                size="small"
                                fullWidth
                                options={nodeAddressInfo.devices}
                                value={transport.device}
                                inputValue={transport.device}
                                onInputChange={(_e, v) => setTransport((p) => ({ ...p, device: v ?? '' }))}
                                renderInput={(params) => (
                                  <TextField {...params} label={t('vdc.transportDevice')} placeholder="bond0" />
                                )}
                              />
                              <TextField
                                size="small"
                                fullWidth
                                label={t('vdc.transportCidr')}
                                placeholder="198.51.100.0/24"
                                value={transport.cidr}
                                onChange={(e) => setTransport((p) => ({ ...p, cidr: e.target.value }))}
                                error={cidrInvalid}
                                helperText={cidrInvalid ? t('vdc.transportCidrInvalid') : undefined}
                              />
                            </Stack>
                            {transportIface && (
                              <Typography variant="caption" color="text.secondary">
                                {t('vdc.transportIfaceOnNodes', { iface: transportIface })}
                                {mtuNumber !== null && !mtuInvalid
                                  ? ` ${t('vdc.transportIfaceMtu', { mtu: mtuNumber + VXLAN_OVERHEAD })}`
                                  : ''}
                              </Typography>
                            )}
                          </Stack>

                          {/* Node addresses and interface status share one row per node. */}
                          <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
                            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1} sx={{ mb: 1.5 }}>
                              <Typography variant="body2">{t('vdc.transportNodeAddresses')}</Typography>
                              <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" flexWrap="wrap" useFlexGap sx={{ ml: 'auto' }}>
                                <Button
                                  size="small"
                                  variant="text"
                                  startIcon={<i className="ri-list-ordered" />}
                                  disabled={!transportCidr || nodeAddressInfo.nodes.length === 0}
                                  onClick={() => setTransport((p) => ({
                                    ...p,
                                    nodeAddresses: { ...p.nodeAddresses, ...suggestNodeAddresses(p.cidr, nodeAddressInfo.nodes.map((n) => n.name)) },
                                  }))}
                                >
                                  {t('vdc.transportFillSequentially')}
                                </Button>
                                {editingVdc && (
                                  <Tooltip
                                    arrow
                                    placement="top"
                                    title={
                                      transportDirtyFlag
                                        ? t('vdc.transportSaveFirst')
                                        : transportAllProvisioned
                                          ? t('vdc.transportAllProvisioned')
                                          : t('vdc.transportProvisionWarning')
                                    }
                                  >
                                    <span>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={<i className="ri-server-line" />}
                                        disabled={transportDirtyFlag || provisioning || transportStatusLoading || transportAllProvisioned}
                                        onClick={handleProvisionTransport}
                                      >
                                        {provisioning ? t('vdc.transportProvisioning') : t('vdc.transportProvision')}
                                      </Button>
                                    </span>
                                  </Tooltip>
                                )}
                              </Stack>
                            </Stack>
                            {editingVdc && (
                              <>
                                {(transportStatusLoading || provisioning) && <LinearProgress sx={{ mb: 1 }} />}
                                {provisionError && (
                                  <Alert severity="error" sx={{ mb: 1, py: 0 }} onClose={() => setProvisionError('')}>{provisionError}</Alert>
                                )}
                                {transportStatus && transportStatus.length === 0 && (
                                  <Typography variant="caption" sx={{ display: 'block', mb: 1, fontStyle: 'italic' }}>{t('vdc.transportProvisionNothing')}</Typography>
                                )}
                              </>
                            )}
                            {transportNodeNames.length === 0 ? (
                              <Typography variant="caption" sx={{ fontStyle: 'italic' }}>{t('vdc.transportClusterPeersEmpty')}</Typography>
                            ) : (
                              <Box sx={{ overflowX: 'auto' }}>
                                <Stack
                                  role="table"
                                  aria-label={t('vdc.transportNodeAddresses')}
                                  spacing={1}
                                  sx={{
                                    minWidth: 400,
                                    '& > [role="row"]': {
                                      display: 'grid',
                                      gridTemplateColumns: '128px minmax(220px, 1fr)',
                                      gap: 1.5,
                                      alignItems: 'start',
                                    },
                                  }}
                                >
                                  <Box role="row" sx={{ pb: 0.5 }}>
                                    <Typography role="columnheader" variant="caption" color="text.secondary">{t('common.node')}</Typography>
                                    <Stack role="columnheader" direction="row" spacing={0.75} alignItems="center">
                                      <Typography variant="caption" color="text.secondary">{t('vdc.transportNodeAddress')}</Typography>
                                      {hintIcon(t('vdc.transportNodeAddressPlaceholder'), false)}
                                    </Stack>
                                  </Box>
                                  {transportNodeNames.map((name) => {
                                    const known = nodeAddressInfo.nodes.some((n) => n.name === name)
                                    const value = transport.nodeAddresses[name] ?? ''
                                    const trimmed = value.trim()
                                    const notAnAddress = !!trimmed && ipFamily(trimmed) === null
                                    const outsideCidr = !!trimmed && !notAnAddress && !!transportCidr && !ipInCidr(trimmed, transportCidr)
                                    const status = transportStatus?.find((s) => s.node === name)
                                    const meta = status ? (TRANSPORT_STATE_KEYS[status.state] ?? TRANSPORT_STATE_KEYS.unreachable) : null
                                    const last = provisionResults?.find((r) => r.node === name)
                                    const lastMeta = last ? (PROVISION_ACTION_KEYS[last.action] ?? PROVISION_ACTION_KEYS.error) : null
                                    // Interface state as a coloured icon inside the field; the
                                    // tooltip carries the interface name, the drift detail and
                                    // the last provisioning action.
                                    // The theme forces `color: inherit` on everything inside an
                                    // adornment, so the state colour goes on the adornment itself.
                                    const statusAdornment = editingVdc && status && meta ? (
                                      <InputAdornment position="end" sx={{ pointerEvents: 'auto', color: `${meta.color}.main` }}>
                                        <Tooltip
                                          arrow
                                          placement="top"
                                          title={
                                            <Stack spacing={0.25}>
                                              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                {t(meta.label)}{lastMeta ? ` (${t(lastMeta.label)})` : ''}
                                              </Typography>
                                              <Typography variant="caption">{status.iface}</Typography>
                                              {status.state === 'drift' && status.found && (
                                                <Typography variant="caption">{t('vdc.transportStatusDriftDetail', { found: status.found, wanted: status.wanted })}</Typography>
                                              )}
                                              {status.state === 'unreachable' && status.message && (
                                                <Typography variant="caption">{status.message}</Typography>
                                              )}
                                              {last?.action === 'error' && last.message && (
                                                <Typography variant="caption">{last.message}</Typography>
                                              )}
                                            </Stack>
                                          }
                                        >
                                          <Box
                                            component="i"
                                            className={
                                              status.state === 'provisioned'
                                                ? 'ri-checkbox-circle-fill'
                                                : status.state === 'unreachable'
                                                  ? 'ri-close-circle-fill'
                                                  : 'ri-error-warning-fill'
                                            }
                                            sx={{ cursor: 'help' }}
                                          />
                                        </Tooltip>
                                      </InputAdornment>
                                    ) : undefined
                                    return (
                                      <Box key={name} role="row">
                                        <Box role="cell" sx={{ minWidth: 0, pt: 0.5, opacity: known ? 1 : 0.6 }}>
                                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minHeight: 30 }}>
                                            {renderNodeGlyph(name)}
                                            {!known && (
                                              <IconButton
                                                size="small"
                                                sx={{ flexShrink: 0 }}
                                                aria-label={t('vdc.transportRemoveNode', { node: name })}
                                                onClick={() => setTransport((p) => {
                                                  const next = { ...p.nodeAddresses }
                                                  delete next[name]
                                                  return { ...p, nodeAddresses: next }
                                                })}
                                              >
                                                <i className="ri-delete-bin-line" />
                                              </IconButton>
                                            )}
                                          </Stack>
                                          {!known && (
                                            <Typography variant="caption" color="text.secondary">{t('vdc.transportNodeGone')}</Typography>
                                          )}
                                        </Box>
                                        <Box role="cell">
                                          <TextField
                                            size="small"
                                            fullWidth
                                            value={value}
                                            slotProps={{
                                              htmlInput: { 'aria-label': [name, t('vdc.transportNodeAddress')].join(': ') },
                                              input: statusAdornment ? { endAdornment: statusAdornment } : undefined,
                                            }}
                                            onChange={(e) => setTransport((p) => ({ ...p, nodeAddresses: { ...p.nodeAddresses, [name]: e.target.value } }))}
                                            error={notAnAddress || outsideCidr}
                                            helperText={
                                              notAnAddress
                                                ? t('vdc.transportInvalidAddress', { address: trimmed })
                                                : outsideCidr
                                                  ? t('vdc.transportAddressOutsideCidr')
                                                  : undefined
                                            }
                                          />
                                        </Box>
                                      </Box>
                                    )
                                  })}
                                </Stack>
                              </Box>
                            )}
                          </Box>

                          {renderPeersField(t('vdc.transportExtraPeers'), t('vdc.transportExtraPeersHint'))}
                        </>
                      )}
                    </Stack>

                    {editingVdc?.sdnZoneName && (
                      <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                        {zoneStatus && (
                          <Stack spacing={1}>
                            {zoneStatus.live ? (
                              renderPeerChips(t('vdc.zonePeersOnProxmox'), zoneStatus.live.peers ?? [], zoneStatus.live.mtu ?? null)
                            ) : (
                              <Typography variant="caption" color="error">{t('vdc.zoneNotFoundOnPve')}</Typography>
                            )}
                            {!zoneStatus.inSync && renderPeerChips(t('vdc.zoneExpected'), zoneStatus.desired?.peers ?? [], zoneStatus.desired?.mtu ?? null)}
                          </Stack>
                        )}
                        {zoneLoading && <LinearProgress sx={{ mt: zoneStatus ? 1.5 : 0 }} />}
                        {zoneMessage && (
                          <Alert severity={zoneMessage.severity} sx={{ mt: 1, py: 0 }} onClose={() => setZoneMessage(null)}>
                            {zoneMessage.text}
                          </Alert>
                        )}
                      </Box>
                    )}
                  </Box>

                  {/* Shared Bridges */}

                  <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-router-line" />
                      {t('vdc.sharedBridgesTitle')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{t('vdc.sharedBridgesHintRevised')}</Typography>

                    {providerBridges.length === 0 ? (
                      <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                        {t('vdc.sharedBridgesNoDetected')}
                      </Typography>
                    ) : (
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        {providerBridges.map((pb: any) => {
                          const selected = selectedSharedBridges.has(pb.iface)
                          const isVnet = pb.type === 'sdn-vnet'
                          const label = selectedSharedBridges.get(pb.iface) ?? ''
                          return (
                            <Stack key={pb.iface} direction="row" spacing={1} alignItems="center">
                              <FormControlLabel
                                sx={{ minWidth: 220 }}
                                control={
                                  <Checkbox
                                    checked={selected}
                                    onChange={(e) => {
                                      setSelectedSharedBridges((prev) => {
                                        const next = new Map(prev)
                                        if (e.target.checked) next.set(pb.iface, label || pb.alias || '')
                                        else next.delete(pb.iface)
                                        return next
                                      })
                                    }}
                                  />
                                }
                                label={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <i className={isVnet ? 'ri-share-line' : 'ri-router-line'} style={{ fontSize: 16, opacity: 0.6 }} />
                                    <Typography>{pb.iface}</Typography>
                                    {isVnet && pb.zone && (
                                      <Typography variant="caption" color="text.secondary">({pb.zone})</Typography>
                                    )}
                                  </Box>
                                }
                              />
                              <TextField
                                size="small"
                                fullWidth
                                placeholder={t('vdc.sharedBridgeLabelPlaceholder')}
                                value={label}
                                disabled={!selected}
                                onChange={(e) => {
                                  setSelectedSharedBridges((prev) => {
                                    const next = new Map(prev)
                                    if (next.has(pb.iface)) next.set(pb.iface, e.target.value)
                                    return next
                                  })
                                }}
                              />
                            </Stack>
                          )
                        })}
                      </Stack>
                    )}
                  </Box>

                  {/* VLAN pools */}
                  <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-price-tag-3-line" />
                        {t('vdc.vlanPoolsTitle')}
                      </Typography>
                      <Tooltip title={t('vdc.vlanPoolAdd')} arrow>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={t('vdc.vlanPoolAdd')}
                            onClick={() => setVlanPools((prev) => [...prev, { bridge: poolBridges[0]?.iface ?? '', rangeStart: '', rangeEnd: '' }])}
                            disabled={poolBridges.length === 0}
                          >
                            <i className="ri-add-line" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{t('vdc.vlanPoolsHint')}</Typography>

                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {vlanPools.map((pool, idx) => {
                        const bridgeMeta = poolBridges.find((b) => b.iface === pool.bridge)
                        return (
                          <Stack key={idx} direction="row" spacing={1} alignItems="flex-start">
                            <TextField
                              select size="small" sx={{ flex: 1, minWidth: 160, ...SMALL_SELECT_SX }}
                              label={t('vdc.vlanPoolBridge')}
                              value={pool.bridge}
                              onChange={(e) => setVlanPools((prev) => prev.map((p, i) => i === idx ? { ...p, bridge: e.target.value } : p))}
                              helperText={pool.bridge && bridgeMeta && !bridgeMeta.vlanAware ? t('vdc.vlanPoolNotVlanAware') : undefined}
                            >
                              {poolBridges.map((b) => (
                                <MenuItem key={b.iface} value={b.iface}>{b.iface}</MenuItem>
                              ))}
                            </TextField>
                            <TextField
                              size="small" type="number" label={t('vdc.vlanPoolStart')}
                              sx={{ width: 150, flexShrink: 0 }}
                              value={pool.rangeStart}
                              onChange={(e) => setVlanPools((prev) => prev.map((p, i) => i === idx ? { ...p, rangeStart: e.target.value } : p))}
                              slotProps={{ htmlInput: { min: 1, max: 4094 } }}
                            />
                            <TextField
                              size="small" type="number" label={t('vdc.vlanPoolEnd')}
                              sx={{ width: 150, flexShrink: 0 }}
                              value={pool.rangeEnd}
                              onChange={(e) => setVlanPools((prev) => prev.map((p, i) => i === idx ? { ...p, rangeEnd: e.target.value } : p))}
                              slotProps={{ htmlInput: { min: 1, max: 4094 } }}
                            />
                            <IconButton size="small" sx={{ mt: 0.75, flexShrink: 0 }} onClick={() => setVlanPools((prev) => prev.filter((_, i) => i !== idx))}>
                              <i className="ri-delete-bin-line" />
                            </IconButton>
                          </Stack>
                        )
                      })}
                    </Stack>
                  </Box>

                  {/* Stretched tenant networks (#901), read-only: same card as the sections above. */}
                  {editingVdc && (
                    <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                      <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <i className="ri-git-branch-line" />
                        {t('vdc.tenantNetworksTitle')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('vdc.tenantNetworkOnVdcHint')}</Typography>
                      {vdcNetworks.length === 0 ? (
                        <Typography variant="caption" sx={{ fontStyle: 'italic' }}>{t('vdc.tenantNetworkOnVdcNone')}</Typography>
                      ) : (
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          {vdcNetworks.map((n) => (
                            <Chip key={n.id} size="small" variant="outlined" icon={<i className="ri-git-branch-line" style={{ fontSize: 14 }} />} label={`${n.name} · VNI ${n.vni} · ${n.pveName}`} />
                          ))}
                        </Stack>
                      )}
                    </Box>
                  )}
              </>
            )}
          </TabPanel>

          {/* Quotas */}
          <TabPanel value={dialogTab} index={4}>
              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-bar-chart-box-line" />
                {t('vdc.quotas')}
              </Typography>

              {/* Cluster capacity ratios shown next to vCPU / RAM / Storage —
                  helps the admin gauge "is this allocation reasonable
                  given what the cluster actually has". VMs / Snapshots /
                  Backups stay bar-less because PVE doesn't expose a
                  global cluster ceiling for those (they're soft per-VM
                  limits, not capacity-bound). */}
              {renderQuotaField(t('vdc.maxVcpus'), 'maxVcpus', 'unlimitedVcpus', clusterVcpuTotal > 0 ? { total: clusterVcpuTotal, unit: 'vCPU' } : undefined)}
              {renderQuotaField(t('vdc.maxRam'), 'maxRamGb', 'unlimitedRam', clusterRamGbTotal > 0 ? { total: clusterRamGbTotal, unit: 'GB' } : undefined)}
              {renderQuotaField(t('vdc.maxStorage'), 'maxStorageGb', 'unlimitedStorage', clusterStorageGbTotal > 0 ? { total: clusterStorageGbTotal, unit: 'GB' } : undefined)}
              {renderQuotaField(t('vdc.maxVms'), 'maxVms', 'unlimitedVms')}
              {renderQuotaField(t('vdc.maxSnapshots'), 'maxSnapshots', 'unlimitedSnapshots')}
              {renderQuotaField(t('vdc.maxBackups'), 'maxBackups', 'unlimitedBackups')}

              {renderQuotaField(t('vdc.maxVnets'), 'maxVnets', 'unlimitedVnets')}
          </TabPanel>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={
              saving ||
              !form.tenantId ||
              !form.connectionId ||
              !form.primaryStorage ||
              // Hold the click until /available-resources has populated
              // form.nodes and the primary storage candidate list —
              // without this gate the user could submit before the
              // auto-fill ran and the backend would 400.
              resourcesLoading ||
              // Defense-in-depth: per-keystroke clamping in renderQuotaField
              // already prevents typing past the cluster total, but an
              // edited vDC could carry a legacy quota that exceeds the
              // current cluster (e.g. node decommissioned since create).
              quotaOverCapacity ||
              // PBS draft: when the toggle is ON at create time, all three
              // sub-fields must be filled. Otherwise the bind step is silently
              // skipped after the vDC is created.
              (!editingVdc && pbsDraft.enabled && (
                !pbsDraft.pbsConnectionId || !pbsDraft.datastore || !pbsDraft.namespace
              )) ||
              // One vDC per (tenant, connection): unreachable through the
              // filtered picker — defense-in-depth only.
              occupiedConnectionIds.has(form.connectionId)
            }
          >
            {saving ? t('vdc.saving') : editingVdc ? t('common.update') : t('common.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteVdc} onClose={() => setDeleteVdc(null)}>
        <DialogTitle>{t('vdc.deleteConfirm', { name: deleteVdc?.name || '' })}</DialogTitle>
        <DialogContent>
          {deleteVdc?.usage?.usedVms > 0 ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {t('vdc.deleteBlocked')}
            </Alert>
          ) : (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {t('vdc.deleteWarning', { pool: deleteVdc?.pvePoolName || '' })}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteVdc(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={deleteVdc?.usage?.usedVms > 0}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
