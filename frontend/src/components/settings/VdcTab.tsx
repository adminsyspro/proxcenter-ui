'use client'

import { useState, useEffect, useCallback } from 'react'

import {
  Alert,
  Autocomplete,
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
import QuotaDonut from '@/components/mydc/QuotaDonut'
import { NodeIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

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
}

// Translates an ISO timestamp into a localized "3m ago" / "2h ago" / "5d ago"
// using the existing time.* keys, so we don't ship a new dependency.
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
  // Sub-tabs: the vDC list and the connection-level storage policies are
  // separate concerns; showing both stacked made the page too long.
  const [activeSection, setActiveSection] = useState<'vdcs' | 'policies'>('vdcs')
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
      return
    }
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
    setPbsDraft({ enabled: false, mode: 'auto', pbsConnectionId: '', datastore: '', namespace: '' })
    setPbsDraftDatastores([])
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
      if (form.maxVnets) quota.maxVnets = Number.parseInt(form.maxVnets)

      // For unlimited fields, explicitly set null so the backend clears them
      if (form.unlimitedVcpus) quota.maxVcpus = null
      if (form.unlimitedRam) quota.maxRamMb = null
      if (form.unlimitedStorage) quota.maxStorageMb = null
      if (form.unlimitedVms) quota.maxVms = null
      if (form.unlimitedSnapshots) quota.maxSnapshots = null
      if (form.unlimitedBackups) quota.maxBackups = null

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
          nodes: nodesPayload,
          primaryStorage: form.primaryStorage,
          sharedBridges: sharedBridgesPayload,
          vlanPools: vlanPoolsPayload,
          storagePolicies: storagePoliciesPayload,
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
        const tooltip = count === 0 ? t('myVdc.cockpit.noBackups') : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {bindings.map((b) => (
              <Typography key={b.id} variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                {b.pbsConnectionName} • {b.datastore}{b.namespace ? ` / ${b.namespace}` : ''}
              </Typography>
            ))}
          </Box>
        )

        return (
          <Tooltip arrow title={tooltip}>
            <Chip
              icon={<Box component="i" className="ri-database-2-line" sx={{ fontSize: 14, ml: '6px !important' }} />}
              label={count}
              size="small"
              color={count === 0 ? 'error' : 'default'}
              variant={count === 0 ? 'outlined' : 'filled'}
              sx={{ height: 24, cursor: 'default' }}
            />
          </Tooltip>
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
      </Tabs>

      {activeSection === 'policies' && <StoragePoliciesSection connections={connections} />}

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
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '20px !important' }}>
          {/* Tenant — drives the vDC name and slug. Picking a tenant fills
              name (= tenant.name) and slug (= sluggified tenant + later
              the connection too). The slug field is no longer exposed —
              it's a derived identifier the user shouldn't tune. */}
          <Autocomplete
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
          {tenantHasExistingVdc && (
            <Alert severity={allClustersUsed ? 'warning' : 'info'}>
              {allClustersUsed
                ? t('vdc.tenantAllClustersUsed')
                : t('vdc.tenantHasVdcs', {
                    count: existingTenantVdcs.length,
                    names: existingTenantVdcs
                      .map((v: any) => {
                        const conn = connections.find((c: any) => c.id === v.connectionId)
                        return conn?.name ? `${v.name} (${conn.name})` : v.name
                      })
                      .join(', '),
                  })}
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

          {/* Resources section (when connection selected) */}
          {form.connectionId && (
            <>
              {resourcesLoading ? (
                <Box sx={{ py: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('vdc.loadingResources')}
                  </Typography>
                  <LinearProgress />
                </Box>
              ) : availableResources ? (
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
                      <Box sx={{ mt: 2 }}>
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

                  <Divider />

                  {/* PBS bindings (only when editing an existing vDC).
                      The Pool / Nodes / Storages summary that used to live
                      here was dropped: a vDC now spans the entire cluster
                      so the per-node CPU/RAM bars and per-storage usage
                      bars added noise without informing any decision the
                      admin can still make in this modal. */}
                  {editingVdc && (
                    <>
                      <VdcPbsBindingsSection
                        vdcId={editingVdc.id}
                        tenantSlug={getTenantSlug(editingVdc.tenantId) || 'tenant'}
                        vdcSlug={editingVdc.slug || form.slug}
                        pbsConnections={pbsConnections}
                      />
                      <Divider />
                    </>
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
                      <Divider />
                    </>
                  )}

                  {/* Tenant networks: the VXLAN / SDN overlay is automatic */}

                  <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-git-branch-line" />
                      {t('vdc.vxlanSectionTitle')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{t('vdc.vxlanSectionHint')}</Typography>
                    {editingVdc?.sdnZoneName ? (
                      <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
                        {t('vdc.vxlanZoneInfo', { zone: editingVdc.sdnZoneName, count: editingVdc.vnets?.length ?? 0 })}
                      </Typography>
                    ) : null}
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
                              select size="small" sx={{ flex: 1, minWidth: 160 }}
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

                  {/* Storage policy assignments (storage policies + QoS, P3) */}

                  <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-database-2-line" />
                        {t('vdc.vdcPoliciesTitle')}
                      </Typography>
                      <Tooltip title={t('vdc.vdcPolicyAdd')} arrow>
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
                                  renderValue: (value) =>
                                    connPolicies.find((p) => p.id === (value as string))?.name ?? '',
                                },
                              }}
                            >
                              {options.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                  <Box>
                                    <Typography variant="body2">{p.name}</Typography>
                                    <Typography variant="caption" color="text.secondary">{p.storageId}</Typography>
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

                  {/* Shared Bridges */}

                  <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-router-line" />
                      {t('vdc.sharedBridgesTitle')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{t('vdc.sharedBridgesHint')}</Typography>

                    {providerBridges.length === 0 ? (
                      <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                        {t('vdc.sharedBridgesNoDetected')}
                      </Typography>
                    ) : (
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        {providerBridges.map((pb) => {
                          const selected = selectedSharedBridges.has(pb.iface)
                          const label = selectedSharedBridges.get(pb.iface) ?? ''
                          return (
                            <Stack key={pb.iface} direction="row" spacing={1} alignItems="center">
                              <FormControlLabel
                                sx={{ minWidth: 180 }}
                                control={
                                  <Checkbox
                                    checked={selected}
                                    onChange={(e) => {
                                      setSelectedSharedBridges((prev) => {
                                        const next = new Map(prev)
                                        if (e.target.checked) next.set(pb.iface, label)
                                        else next.delete(pb.iface)
                                        return next
                                      })
                                    }}
                                  />
                                }
                                label={<Typography>{pb.iface}</Typography>}
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
                </>
              ) : null}

              <Divider />

              {/* Quotas */}
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

              <TextField
                label={t('vdc.maxVnets')}
                type="number"
                value={form.maxVnets}
                onChange={(e) => setForm((f) => ({ ...f, maxVnets: e.target.value }))}
                helperText={t('vdc.maxVnetsHint')}
                slotProps={{ htmlInput: { min: 0 } }}
                size="small"
                fullWidth
              />
            </>
          )}
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
