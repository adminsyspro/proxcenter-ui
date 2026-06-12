'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
  MenuItem,
  Select,
  Slider,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'

import type { CloudImage } from '@/lib/templates/cloudImages'
import { supportsVmDisks } from '@/lib/proxmox/storage'
import DeploymentProgress from './DeploymentProgress'
import VendorLogo from './VendorLogo'
import IsoNetworkReservation from './IsoNetworkReservation'
import { useTenant } from '@/contexts/TenantContext'
import VdcQuotaBanner from '@/components/inventory/VdcQuotaBanner'

interface DeployWizardProps {
  open: boolean
  onClose: () => void
  image: CloudImage | null
  prefillBlueprint?: any | null
  // When set, the wizard reopens directly at the Progress step attached
  // to an existing deployment (resuming a job that was minimized to the
  // taskbar). Mutually exclusive with the regular new-deploy flow — if
  // both are present, resume wins.
  resumeDeploymentId?: string | null
}

const STEP_LABELS = [
  'templates.deploy.steps.image',
  'templates.deploy.steps.target',
  'templates.deploy.steps.hardware',
  'templates.deploy.steps.cloudInit',
  'templates.deploy.steps.review',
  'templates.deploy.steps.progress',
] as const

interface Connection {
  id: string
  name: string
  type: string
}

interface NodeInfo {
  node: string
  status: string
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
}

interface StorageInfo {
  storage: string
  content: string
  total: number
  used: number
  avail: number
  type: string
}

export default function DeployWizard({ open, onClose, image, prefillBlueprint, resumeDeploymentId }: DeployWizardProps) {
  const t = useTranslations()
  // Tenants get cloud-style abstraction in step "Target": no connection /
  // node / storage / VMID picker. They only enter a name. Selections are
  // resolved in the background (first allowed connection, least-loaded
  // node, first shared storage, /cluster/nextid).
  const { currentTenant, loading: tenantLoading, isFullClusterView } = useTenant()
  const hideInfra = !tenantLoading && !!currentTenant && currentTenant.id !== 'default'
  // Full cluster view = provider OR MSP tenant (mirrors CreateVmDialog). In
  // that mode the bridge picker exposes the whole PVE bridge list and the
  // VLAN Tag field is live; the SDN-VNet-only lock below is for vDC tenants.
  // `hideInfra` (vDC tenant) and `isFullClusterView` are NOT mutually
  // exclusive opposites in general (an MSP user is full-cluster but could
  // still scope to a vDC connection), so we branch on the dedicated flag
  // rather than `!hideInfra`.
  const fullClusterNet = !tenantLoading && isFullClusterView
  const [activeStep, setActiveStep] = useState(0)
  const [deploying, setDeploying] = useState(false)
  const [deploymentId, setDeploymentId] = useState<string | null>(null)
  const [deployError, setDeployError] = useState<string | null>(null)

  // Target step
  const [connections, setConnections] = useState<Connection[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [node, setNode] = useState('')
  const [storages, setStorages] = useState<StorageInfo[]>([])
  const [storage, setStorage] = useState('')
  // ISO-mode only: storages on the node that have content=iso. The boot ISO
  // is downloaded here (separate from the disk storage above).
  const [isoStorages, setIsoStorages] = useState<StorageInfo[]>([])
  const [isoStorage, setIsoStorage] = useState('')
  const [vmid, setVmid] = useState<number>(100)
  const [vmName, setVmName] = useState('')

  // Hardware step
  const [cores, setCores] = useState(2)
  const [sockets, setSockets] = useState(1)
  const [memory, setMemory] = useState(2048)
  const [diskSize, setDiskSize] = useState('20G')
  const [scsihw, setScsihw] = useState('virtio-scsi-single')
  const [networkModel, setNetworkModel] = useState('virtio')
  const [networkBridge, setNetworkBridge] = useState('vmbr0')
  // VLAN tag. For vDC tenants the wizard restricts the bridge picker to SDN
  // VNets, which carry their own VNI and reject per-NIC tags — so the field
  // stays locked and the payload nulls it (legacy behaviour). In full
  // cluster view (provider / MSP) the picker exposes raw PVE bridges, where
  // an 802.1Q tag is valid; the field becomes editable and we send the tag.
  // '' = no tag. Stored as a string so the controlled <TextField> stays
  // un-glitchy; coerced to number | null at submit.
  const [vlanTag, setVlanTag] = useState<string>('')
  const [cpu, setCpu] = useState('host')
  // ISO-mode only: BIOS firmware + OS type override. Cloud-images keep
  // ostype from the catalog and seabios silently; ISO installs need an
  // explicit choice (ovmf+pre-enrolled-keys for Windows 10/11/Server 2025).
  const [bios, setBios] = useState<'seabios' | 'ovmf'>('seabios')
  const [ostypeOverride, setOstypeOverride] = useState<string | null>(null)

  // vDC quota (tenant only — provider has no vDC scope so banner stays hidden)
  const [vdcQuota, setVdcQuota] = useState<{ maxVcpus: number | null; maxRamMb: number | null; maxStorageMb: number | null; maxVms: number | null } | null>(null)
  const [vdcUsage, setVdcUsage] = useState<{ usedVcpus: number; usedRamMb: number; usedStorageMb: number; usedVms: number } | null>(null)
  const [quotaBlocked, setQuotaBlocked] = useState(false)

  // The picker also keeps the VNet's display name so we can render the
  // tenant-friendly alias ("public-net") next to PVE's hashed VNet ID
  // (e.g. "v7f83c9"). The bridge value sent to PVE stays the iface
  // (PVE only knows about pve_name); the alias is purely cosmetic.
  // Bridges + VNets for the network picker. Mirrors the shape used by
  // CreateVmDialog so we hit the same `/network-choices` endpoint.
  // type values: 'vnet' (tenant SDN), 'shared' (provider uplink), or a
  // PVE bridge type (e.g. 'bridge', 'OVSBridge').
  // bridges carry their VNet's subnet config (CIDR, gateway, DNS) when
  // available, so the CloudInit step can pre-fill the IP/gateway/DNS fields
  // straight from IPAM context — the user only types an override IP if
  // they want a specific one, otherwise the backend auto-allocates.
  type BridgeChoice = {
    iface: string
    type: string
    label?: string | null
    vdc?: string | null
    /** vDC UUID (for /api/v1/vdcs/{id}/... routes). vdc above is the slug,
     *  surfaced for legacy reasons; vdcId is the only safe identifier. */
    vdcId?: string | null
    displayName?: string | null
    subnet?: { cidr: string; gateway: string; dnsServers: string[]; subnetId: string } | null
  }
  const [bridges, setBridges] = useState<BridgeChoice[]>([])
  const [agent, setAgent] = useState(true)

  // Cloud-init step.
  // - ipOverride: optional IP the user wants pinned (else IPAM auto-allocates).
  //   Empty string is the canonical "auto" state.
  // - We don't carry an `ipconfig0` raw string anymore — the wizard composes
  //   it at submit time from (subnet.gateway + ipOverride or "" → backend
  //   IPAM injects the static config server-side).
  const [ciuser, setCiuser] = useState('')
  const [cipassword, setCipassword] = useState('')
  const [sshKeys, setSshKeys] = useState('')
  const [ipOverride, setIpOverride] = useState('')
  const [nameserver, setNameserver] = useState('')
  const [searchdomain, setSearchdomain] = useState('')

  // ISO-mode network reservation. Cloud-init can't push ipconfigN to a
  // raw OS installer, so for IPAM-managed VNets we pre-allocate an
  // (IP, MAC) here and tell the tenant to type the IP into the OS during
  // install. Pinned MAC = stable IPAM key across reboots / rebuilds.
  const [staticIp, setStaticIp] = useState('')
  const [staticMac, setStaticMac] = useState('')
  const [staticDns, setStaticDns] = useState<string[]>([])
  const [staticPrefix, setStaticPrefix] = useState<number | null>(null)
  const [nextFreeLoading, setNextFreeLoading] = useState(false)
  const [nextFreeError, setNextFreeError] = useState<string | null>(null)

  // Save as blueprint
  const [saveAsBlueprint, setSaveAsBlueprint] = useState(false)
  const [blueprintName, setBlueprintName] = useState('')

  // True when the selected image is an install-media ISO (not a cloud
  // image). Used to gate the ISO storage picker on Target, the BIOS/OS
  // controls on Hardware, the cloud-init step skip, and the post-deploy
  // console link on Progress.
  const isIsoMode = String(image?.format || '').toLowerCase() === 'iso'

  // ISO + IPAM-managed bridge → the wizard needs (IP, MAC) before submit.
  // We compute this from the currently selected bridge so the network
  // reservation block can render and the next-free fetcher knows which
  // VNet to query.
  const isoBridgeChoice = bridges.find((b) => b.iface === networkBridge)
  // vdcId is the UUID required by /api/v1/vdcs/{id}/... routes; vdc is
  // a slug kept around for display compatibility — never use it for
  // route building.
  const isoNeedsReservation = isIsoMode && !!isoBridgeChoice?.subnet && !!isoBridgeChoice.vdcId && !!isoBridgeChoice.displayName

  const [reservationLoading, setReservationLoading] = useState(false)
  const [reservationError, setReservationError] = useState<string | null>(null)

  const fetchNextFree = useCallback(async (which: 'both' | 'ip' | 'mac') => {
    if (!isoBridgeChoice?.vdcId || !isoBridgeChoice?.displayName) return
    setReservationLoading(true)
    setReservationError(null)
    try {
      const r = await fetch(
        `/api/v1/vdcs/${encodeURIComponent(isoBridgeChoice.vdcId)}/vnets/${encodeURIComponent(isoBridgeChoice.displayName)}/ipam/next-free`,
        { cache: 'no-store' },
      )
      const j = await r.json()
      if (!r.ok) {
        setReservationError(j?.error || `HTTP ${r.status}`)
        return
      }
      const d = j?.data
      if (!d) { setReservationError('Invalid response'); return }
      if (which === 'both' || which === 'ip') setStaticIp(String(d.ip || ''))
      if (which === 'both' || which === 'mac') setStaticMac(String(d.suggestedMac || ''))
      if (which === 'both') {
        setStaticDns(Array.isArray(d.dnsServers) ? d.dnsServers : [])
        setStaticPrefix(typeof d.prefix === 'number' ? d.prefix : null)
      }
    } catch (e: any) {
      setReservationError(e?.message || 'Failed to fetch next free IP')
    } finally {
      setReservationLoading(false)
    }
  }, [isoBridgeChoice?.vdcId, isoBridgeChoice?.displayName])

  // Auto-prefill (IP, MAC, DNS, prefix) the first time the user lands
  // on an ISO + IPAM-managed bridge. The ref tracks the (vdcId, vnet)
  // pair we've already prefilled for so a re-render with the same
  // bridge never overwrites what the tenant has typed. When they switch
  // to a non-IPAM bridge we clear the values so they don't leak into
  // a non-IPAM submit, and reset the marker so a flip back re-fetches.
  const prefilledForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      prefilledForRef.current = null
      return
    }
    if (!isoNeedsReservation || !isoBridgeChoice?.vdcId || !isoBridgeChoice?.displayName) {
      if (prefilledForRef.current !== null) {
        prefilledForRef.current = null
        setStaticIp('')
        setStaticMac('')
        setStaticDns([])
        setStaticPrefix(null)
        setReservationError(null)
      }
      return
    }
    const key = `${isoBridgeChoice.vdcId}|${isoBridgeChoice.displayName}`
    if (prefilledForRef.current === key) return
    prefilledForRef.current = key
    fetchNextFree('both')
  }, [open, isoNeedsReservation, isoBridgeChoice?.vdcId, isoBridgeChoice?.displayName, fetchNextFree])

  // Best-effort guess of "this ISO is a Windows installer" — drives the
  // OVMF/pre-enrolled-keys default. We check ostype first (most reliable
  // if the uploader filled it in), then vendor/tags as fallbacks.
  const windowsHint = (() => {
    if (!image) return false
    const ot = String(image.ostype || '').toLowerCase()
    if (ot === 'win10' || ot === 'win11' || ot.startsWith('win')) return true
    const vendor = String(image.vendor || '').toLowerCase()
    if (vendor.includes('microsoft') || vendor.includes('windows')) return true
    return image.tags?.some(tg => /windows|win-?\d+|win2k|server2025/i.test(String(tg))) || false
  })()

  // Reset state on open
  useEffect(() => {
    if (!open) return
    // Resume path: jump straight to the Progress step bound to an existing
    // deployment. Skip the form reset since none of the form fields will
    // be shown; DeploymentProgress drives the rest from the deploymentId.
    if (resumeDeploymentId) {
      setActiveStep(5)
      setDeploying(true)
      setDeploymentId(resumeDeploymentId)
      setDeployError(null)
      return
    }
    setActiveStep(0)
    setDeploying(false)
    setDeploymentId(null)
    setDeployError(null)
    // Fresh open starts with no VLAN tag; the blueprint prefill below
    // overrides this when a stored tag round-trips.
    setVlanTag('')

    if (image) {
      setCores(image.recommendedCores)
      setMemory(image.recommendedMemory)
      setDiskSize(image.defaultDiskSize)
      setVmName('')
      // ISO defaults: pre-set Windows install media to win11 + OVMF
      // (Secure Boot enrolled), other ISOs to ostype='other' + SeaBIOS.
      // Cloud images keep their catalog ostype (no override).
      if (isIsoMode) {
        if (windowsHint) {
          setOstypeOverride('win11')
          setBios('ovmf')
        } else {
          setOstypeOverride(image.ostype || 'other')
          setBios('seabios')
        }
      } else {
        setOstypeOverride(null)
        setBios('seabios')
      }
    }

    // Prefill from blueprint
    if (prefillBlueprint) {
      try {
        const hw = typeof prefillBlueprint.hardware === 'string'
          ? JSON.parse(prefillBlueprint.hardware)
          : prefillBlueprint.hardware
        setCores(hw.cores || 2)
        setSockets(hw.sockets || 1)
        setMemory(hw.memory || 2048)
        setDiskSize(hw.diskSize || '20G')
        setScsihw(hw.scsihw || 'virtio-scsi-single')
        setNetworkModel(hw.networkModel || 'virtio')
        setNetworkBridge(hw.networkBridge || 'vmbr0')
        // Round-trip a stored VLAN tag from the blueprint (only meaningful
        // for raw bridges in full cluster view; on a VNet the picker effect
        // re-locks it). null / undefined / 0 → no tag.
        setVlanTag(hw.vlanTag != null && hw.vlanTag !== 0 ? String(hw.vlanTag) : '')
        setCpu(hw.cpu || 'host')
        setAgent(hw.agent !== false)
      } catch { /* ignore */ }

      try {
        const ci = prefillBlueprint.cloudInit
          ? (typeof prefillBlueprint.cloudInit === 'string'
            ? JSON.parse(prefillBlueprint.cloudInit)
            : prefillBlueprint.cloudInit)
          : null
        if (ci) {
          setCiuser(ci.ciuser || '')
          setCipassword(ci.cipassword || '')
          setSshKeys(ci.sshKeys || '')
          // Try to extract a manual IP from a saved blueprint's ipconfig0;
          // anything else (dhcp, manual, empty) → leave empty so IPAM wins.
          const m = String(ci.ipconfig0 || '').match(/(?:^|,)\s*ip=([0-9.]+)(?:\/\d+)?/)
          setIpOverride(m ? m[1] : '')
          setNameserver(ci.nameserver || '')
          setSearchdomain(ci.searchdomain || '')
        }
      } catch { /* ignore */ }

      // Prefill target from retry
      if (prefillBlueprint._retryFrom) {
        const rf = prefillBlueprint._retryFrom
        if (rf.connectionId) setConnectionId(rf.connectionId)
        if (rf.node) setNode(rf.node)
        if (rf.storage) setStorage(rf.storage)
        if (rf.vmName) setVmName(rf.vmName)
      }
    }
  }, [open, image, prefillBlueprint, resumeDeploymentId])

  // Fetch connections
  useEffect(() => {
    if (!open) return
    fetch('/api/v1/connections?type=pve')
      .then(r => r.json())
      .then(res => {
        const conns = res.data || []
        setConnections(conns)
        // Tenant: auto-pick the first connection from their vDC scope so
        // step Target requires no input. Provider keeps manual selection
        // unless there's a single option.
        if (conns.length === 1 || (hideInfra && conns.length > 0)) {
          setConnectionId(conns[0].id)
        }
      })
      .catch(() => {})
  }, [open, hideInfra])

  // Fetch nodes when connection changes
  useEffect(() => {
    if (!connectionId) { setNodes([]); setNode(''); return }
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes`)
      .then(r => r.json())
      .then(res => {
        const nodeList = (res.data || []).filter((n: any) => n.status === 'online')
        setNodes(nodeList)
        if (nodeList.length === 1) {
          setNode(nodeList[0].node)
        } else if (hideInfra && nodeList.length > 0) {
          // Pick least-loaded online node (cpu + 1.5*ram, RAM weighted higher).
          const scored = nodeList.map((n: any) => {
            const cpuPct = n.maxcpu ? (n.cpu || 0) * 100 : 0
            const memPct = n.maxmem ? ((n.mem || 0) / n.maxmem) * 100 : 0
            return { n, score: cpuPct + 1.5 * memPct }
          })
          scored.sort((a: any, b: any) => a.score - b.score)
          setNode(scored[0].n.node)
        }
      })
      .catch(() => setNodes([]))
  }, [connectionId, hideInfra])

  // Fetch storages + next VMID when node changes
  useEffect(() => {
    if (!connectionId || !node) { setStorages([]); setIsoStorages([]); return }

    // Fetch file-based storages (content types are auto-enabled by the deploy route)
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/storages`)
      .then(r => r.json())
      .then(res => {
        const all = (res.data || []) as any[]

        // Filter on BOTH type AND content. supportsVmDisks() only checks the
        // backing technology (dir, NFS, RBD, …); we still need the storage
        // to be configured for `images` (or `rootdir`) — otherwise PVE
        // rejects the VM creation with "storage X does not support vm images".
        const stList = all.filter((s: any) =>
          supportsVmDisks(s.type)
          && s.enabled !== 0
          && (s.content?.includes('images') || s.content?.includes('rootdir')),
        )
        setStorages(stList)
        // Tenant: prefer a shared storage (cluster-wide, no node leak), then
        // fall back to the first available. Provider keeps the existing
        // first-match logic.
        if (stList.length > 0) {
          if (hideInfra) {
            const shared = stList.find((s: any) => s.shared)
            setStorage((shared || stList[0]).storage)
          } else {
            setStorage(stList[0].storage)
          }
        } else {
          setStorage('')
        }

        // ISO-capable storages — separate selector on Target step. PVE only
        // lets you mount an ISO from a storage advertising content=iso, so
        // we can't just reuse the disk storage list.
        const isoList = all.filter((s: any) => s.enabled !== 0 && s.content?.includes('iso'))
        setIsoStorages(isoList)
        if (isoList.length > 0) {
          if (hideInfra) {
            const shared = isoList.find((s: any) => s.shared)
            setIsoStorage((shared || isoList[0]).storage)
          } else {
            setIsoStorage(isoList[0].storage)
          }
        } else {
          setIsoStorage('')
        }
      })
      .catch(() => { setStorages([]); setIsoStorages([]) })

    // Try to get next available VMID
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/nextid`)
      .then(r => r.json())
      .then(res => {
        if (res.data) setVmid(Number(res.data) || 100)
      })
      .catch(() => {})

    // Network bridges + tenant vDC VNets — populates the bridge picker on
    // the Hardware step. Mirrors the call made by CreateVmDialog so we
    // honour the same vDC whitelist server-side: tenants get their VNets
    // and shared bridges, providers get the full PVE bridge list.
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/network-choices?node=${encodeURIComponent(node)}`)
      .then(r => r.json())
      .then(res => {
        const choices = Array.isArray(res?.data) ? res.data : []
        const list: BridgeChoice[] = choices.map((c: any) => ({
          iface: c.name,
          type: c.kind === 'vnet' ? 'vnet' : c.kind === 'shared' ? 'shared' : (c.type || 'bridge'),
          label: c.label ?? null,
          vdc: c.vdc ?? null,
          vdcId: c.vdcId ?? null,
          displayName: c.displayName ?? null,
          subnet: c.subnet ?? null,
        }))
        setBridges(list)
        // Auto-pick the first VNet so the displayed picker value and the
        // deploy payload stay in sync — for vDC tenants the wizard restricts
        // the bridge to SDN VNets only, so non-VNet pre-fills (e.g. 'vmbr0'
        // from initial state, or a stale blueprint value) would otherwise
        // leave networkBridge pointing at something the dropdown no longer
        // surfaces. In full cluster view (provider / MSP) we expose the whole
        // bridge list and must NOT force-switch — keep the user's / blueprint
        // value if it exists, else fall back to 'vmbr0'.
        if (fullClusterNet) {
          if (!list.some((b: { iface: string }) => b.iface === networkBridge)) {
            setNetworkBridge(list.some((b: { iface: string }) => b.iface === 'vmbr0') ? 'vmbr0' : (networkBridge || 'vmbr0'))
          }
        } else {
          const vnets = list.filter((b: { type: string }) => b.type === 'vnet')
          if (vnets.length > 0 && !vnets.some((b: { iface: string }) => b.iface === networkBridge)) {
            setNetworkBridge(vnets[0].iface)
          }
        }
      })
      .catch(() => setBridges([]))
  }, [connectionId, node, hideInfra, fullClusterNet])

  // Fetch the tenant's vDC quota+usage for the live quota banner on the
  // Hardware step. The /api/v1/vdcs route already returns null for the
  // provider tenant (no vDC), so the banner only shows up for tenants.
  useEffect(() => {
    if (!open || !connectionId) {
      setVdcQuota(null); setVdcUsage(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/vdcs')
        if (!res.ok) { if (!cancelled) { setVdcQuota(null); setVdcUsage(null) } ; return }
        const json = await res.json()
        const vdcs: any[] = Array.isArray(json?.data) ? json.data : []
        const match = vdcs.find(v => v.connectionId === connectionId || v.connection_id === connectionId)
        if (cancelled) return
        if (match?.quota) {
          setVdcQuota({
            maxVcpus: match.quota.maxVcpus ?? null,
            maxRamMb: match.quota.maxRamMb ?? null,
            maxStorageMb: match.quota.maxStorageMb ?? null,
            maxVms: match.quota.maxVms ?? null,
          })
          setVdcUsage({
            usedVcpus: match.usage?.usedVcpus ?? 0,
            usedRamMb: match.usage?.usedRamMb ?? 0,
            usedStorageMb: match.usage?.usedStorageMb ?? 0,
            usedVms: match.usage?.usedVms ?? 0,
          })
        } else {
          setVdcQuota(null); setVdcUsage(null)
        }
      } catch {
        if (!cancelled) { setVdcQuota(null); setVdcUsage(null) }
      }
    })()
    return () => { cancelled = true }
  }, [open, connectionId])

  const handleNext = useCallback(() => {
    setActiveStep(s => {
      const next = Math.min(s + 1, STEP_LABELS.length - 1)
      // ISO mode skips the cloud-init step (index 3) — install media has
      // no notion of cloud-init, the user runs the OS installer manually.
      if (isIsoMode && next === 3) return 4
      return next
    })
  }, [isIsoMode])

  const handleBack = useCallback(() => {
    setActiveStep(s => {
      const prev = Math.max(s - 1, 0)
      if (isIsoMode && prev === 3) return 2
      return prev
    })
  }, [isIsoMode])

  const handleDeploy = useCallback(async () => {
    if (!image) return
    setDeploying(true)
    setDeployError(null)
    setActiveStep(5) // Progress step

    try {
      const body: any = {
        connectionId,
        node,
        storage,
        vmid,
        vmName: vmName || undefined,
        imageSlug: image.slug,
        blueprintId: prefillBlueprint?.id || undefined,
        hardware: {
          cores,
          sockets,
          memory,
          diskSize,
          scsihw,
          networkModel,
          networkBridge,
          // VLAN tag:
          //  - vDC tenant: the picker only exposes SDN VNets (own VNI), PVE
          //    rejects per-NIC tags on VXLAN VNets and the field is locked →
          //    hard-null, dropping any stale blueprint value.
          //  - full cluster view (provider / MSP): a raw bridge can carry an
          //    802.1Q tag. Send the number when one was entered AND the
          //    selected choice isn't a VNet; null otherwise (VNet selected,
          //    or field left empty). The deploy route applies `,tag=` only
          //    when this is truthy.
          vlanTag: (() => {
            if (!fullClusterNet) return null
            const sel = bridges.find(b => b.iface === networkBridge)
            if (sel?.type === 'vnet') return null
            const n = Number.parseInt(vlanTag, 10)
            return Number.isFinite(n) && n >= 1 && n <= 4094 ? n : null
          })(),
          // ISO mode lets the user override ostype (Windows install media
          // pre-selects win11) — fall back to the catalog ostype otherwise.
          ostype: isIsoMode ? (ostypeOverride || image.ostype) : image.ostype,
          agent,
          cpu,
          bios: isIsoMode ? bios : 'seabios',
        },
        // ISO deployments don't run cloud-init: omit the block entirely so
        // the backend skips the configure step. Cloud-image deployments
        // keep their existing cloud-init payload.
        cloudInit: isIsoMode ? null : (() => {
          // Build ipconfig0 from the structured fields:
          //   - ipOverride empty → send empty so the backend's IPAM hook
          //     auto-allocates and injects the static config server-side
          //   - ipOverride set   → compose `ip=<ip>/<prefix>,gw=<gateway>`
          //     using the bridge's subnet (gateway is read-only in the UI)
          const selectedBridge = bridges.find(b => b.iface === networkBridge)
          const subnet = selectedBridge?.subnet ?? null
          let ipconfig0 = ''
          if (ipOverride && subnet) {
            const prefixMatch = subnet.cidr.match(/\/(\d+)$/)
            const prefix = prefixMatch ? prefixMatch[1] : '24'
            ipconfig0 = `ip=${ipOverride}/${prefix},gw=${subnet.gateway}`
          }
          return {
            ciuser: ciuser || undefined,
            cipassword: cipassword || undefined,
            sshKeys: sshKeys || undefined,
            ipconfig0,
            nameserver: nameserver || undefined,
            searchdomain: searchdomain || undefined,
          }
        })(),
        saveAsBlueprint,
        blueprintName: saveAsBlueprint ? blueprintName : undefined,
      }
      if (isIsoMode) body.isoStorage = isoStorage
      if (isoNeedsReservation) {
        body.staticIp = staticIp
        body.staticMac = staticMac
      }

      const res = await fetch('/api/v1/templates/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const text = await res.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        console.warn('[DeployWizard] Non-JSON response from /api/v1/templates/deploy →', text.slice(0, 200))
        setDeployError('Server returned an invalid response')
        setDeploying(false)
        return
      }
      if (data.error) {
        // Validation / permission errors from the sync part
        setDeployError(data.error)
        setDeploying(false)
        return
      }
      if (data.data?.deploymentId) {
        setDeploymentId(data.data.deploymentId)
      }
    } catch (err: any) {
      setDeployError(err.message || 'Deploy failed')
      setDeploying(false)
    }
  }, [
    image, connectionId, node, storage, isoStorage, vmid, vmName, cores, sockets, memory,
    diskSize, scsihw, networkModel, networkBridge, vlanTag, fullClusterNet, cpu, agent,
    bios, ostypeOverride, isIsoMode, isoNeedsReservation, staticIp, staticMac,
    ciuser, cipassword, sshKeys, ipOverride, nameserver, searchdomain,
    bridges,
    saveAsBlueprint, blueprintName, prefillBlueprint,
  ])

  const handleDeployComplete = useCallback((status: 'completed' | 'failed', error?: string) => {
    setDeploying(false)
    if (status === 'failed' && error) setDeployError(error)
  }, [])

  const canProceed = useMemo(() => {
    switch (activeStep) {
      case 0: return !!image
      case 1: {
        const baseOk = !!connectionId && !!node && !!storage && vmid >= 100 && !!vmName.trim()
        // ISO mode also requires an ISO-capable storage on the node — if
        // the tenant's vDC has none we surface a blocking message instead
        // of the picker, and the wizard can't advance.
        if (isIsoMode) return baseOk && !!isoStorage
        return baseOk
      }
      // Hardware step: also block while the vDC quota would be exceeded.
      // ISO + IPAM-managed VNet requires an explicit static IP — we can't
      // pin it via cloud-init (no agent during install), so the tenant
      // must commit to the IP before we let them advance.
      case 2: {
        const baseOk = cores >= 1 && memory >= 128 && !!diskSize && !quotaBlocked
        // Win11/Server 2025 ISO install needs ≥32 GB or the installer
        // refuses to start — block Next instead of letting the user walk
        // into a hard failure on the deploy step.
        const sizeNum = Number.parseInt(String(diskSize).replace(/G$/i, ''), 10) || 0
        const ot = ostypeOverride || image?.ostype || ''
        if (isIsoMode && ot === 'win11' && sizeNum < 32) return false
        if (isoNeedsReservation) {
          const ipOk = /^\d{1,3}(\.\d{1,3}){3}$/.test(staticIp)
          const macOk = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(staticMac)
          return baseOk && ipOk && macOk
        }
        return baseOk
      }
      case 3: return true
      case 4: return !quotaBlocked
      default: return false
    }
  }, [activeStep, image, connectionId, node, storage, vmid, vmName, cores, memory, diskSize, quotaBlocked, isIsoMode, isoStorage, isoNeedsReservation, ostypeOverride, staticIp, staticMac])

  // ─── Step renderers ────────────────────────────────────────────────

  const renderImageStep = () => {
    if (!image) return null
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              width: 56, height: 56, borderRadius: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <VendorLogo vendor={image.vendor} size={48} />
          </Box>
          <Box>
            <Typography variant="h6">{image.name}</Typography>
            <Typography variant="body2" sx={{ opacity: 0.6 }}>
              {image.arch} &middot; {image.format} &middot; {image.ostype}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {image.tags.map(tag => (
            <Chip key={tag} label={tag} size="small" />
          ))}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('templates.catalog.recommendedSpecs')}</Typography>
            <Typography variant="body2">
              {image.recommendedCores} {t('templates.catalog.cores')} / {image.recommendedMemory >= 1024 ? `${image.recommendedMemory / 1024} GB` : `${image.recommendedMemory} MB`} RAM / {image.defaultDiskSize} {t('templates.deploy.hardware.disk')}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('templates.catalog.minimumSpecs')}</Typography>
            <Typography variant="body2">
              {image.minCores} {t('templates.catalog.cores')} / {image.minMemory >= 1024 ? `${image.minMemory / 1024} GB` : `${image.minMemory} MB`} RAM
            </Typography>
          </Box>
        </Box>
      </Box>
    )
  }

  const renderTargetStep = () => {
    // Block ISO deployments when the resolved vDC has no ISO-capable
    // storage. Tenant view doesn't expose the picker (auto-resolved), so
    // we still need to surface this — otherwise the wizard would let the
    // user click Next and fail in the backend.
    const isoBlocker = isIsoMode && !!node && isoStorages.length === 0 ? (
      <Alert severity="error" variant="outlined" icon={<i className="ri-error-warning-line" style={{ fontSize: 18 }} />}>
        {t('templates.deploy.iso.noIsoStorage')}
      </Alert>
    ) : null

    // Tenant-facing simplified target: VM name only, the rest auto-resolved.
    if (hideInfra) {
      return (
        <Stack spacing={2}>
          <TextField
            size="small"
            fullWidth
            label={t('templates.deploy.target.vmName')}
            value={vmName}
            onChange={e => setVmName(e.target.value)}
            placeholder={image ? `${image.slug}-${vmid}` : ''}
            autoFocus
          />
          {isoBlocker}
        </Stack>
      )
    }

    return (
    <Stack spacing={2}>
      <FormControl size="small" fullWidth required>
        <InputLabel>{t('templates.deploy.target.connection')}</InputLabel>
        <Select
          value={connectionId}
          onChange={e => { setConnectionId(e.target.value); setNode(''); setStorage(''); setIsoStorage('') }}
          label={t('templates.deploy.target.connection')}
        >
          {connections.map(c => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth required disabled={!connectionId}>
        <InputLabel>{t('templates.deploy.target.node')}</InputLabel>
        <Select
          value={node}
          onChange={e => { setNode(e.target.value); setStorage(''); setIsoStorage('') }}
          label={t('templates.deploy.target.node')}
        >
          {nodes.map(n => (
            <MenuItem key={n.node} value={n.node}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <Typography variant="body2">{n.node}</Typography>
                <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>
                  CPU: {(n.cpu * 100).toFixed(0)}% &middot; RAM: {((n.mem / n.maxmem) * 100).toFixed(0)}%
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth required disabled={!node}>
        <InputLabel>{t('templates.deploy.target.storage')}</InputLabel>
        <Select
          value={storage}
          onChange={e => setStorage(e.target.value)}
          label={t('templates.deploy.target.storage')}
        >
          {storages.map(s => (
            <MenuItem key={s.storage} value={s.storage}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <Typography variant="body2">{s.storage}</Typography>
                <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>
                  {s.type} &middot; {((s.avail || 0) / 1073741824).toFixed(1)} GB {t('templates.deploy.target.available')}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {node && storages.length === 0 && (
        <Alert severity="warning" variant="outlined">
          {t('templates.deploy.target.noFileStorage')}
        </Alert>
      )}

      {isIsoMode && isoStorages.length > 0 && (
        <FormControl size="small" fullWidth required disabled={!node}>
          <InputLabel>{t('templates.deploy.iso.isoStorage')}</InputLabel>
          <Select
            value={isoStorage}
            onChange={e => setIsoStorage(e.target.value)}
            label={t('templates.deploy.iso.isoStorage')}
          >
            {isoStorages.map(s => (
              <MenuItem key={s.storage} value={s.storage}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <Box component="i" className="ri-disc-line" sx={{ fontSize: 14, opacity: 0.7 }} />
                  <Typography variant="body2">{s.storage}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>
                    {s.type} &middot; {((s.avail || 0) / 1073741824).toFixed(1)} GB {t('templates.deploy.target.available')}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {isoBlocker}

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <TextField
          size="small"
          label={t('templates.deploy.target.vmid')}
          type="number"
          value={vmid}
          onChange={e => setVmid(Number.parseInt(e.target.value) || 100)}
          required
          slotProps={{ htmlInput: { min: 100 } }}
        />
        <TextField
          size="small"
          label={t('templates.deploy.target.vmName')}
          value={vmName}
          onChange={e => setVmName(e.target.value)}
          placeholder={image ? `${image.slug}-${vmid}` : ''}
        />
      </Box>
    </Stack>
    )
  }

  // Convert "20G" → MB for the quota banner. Falls back to 0 on parse error.
  const parseDiskSizeMb = (s: string): number => {
    const m = /^(\d+)\s*([GTM]?)$/i.exec(String(s).trim())
    if (!m) return 0
    const n = Number.parseInt(m[1], 10)
    const unit = m[2].toUpperCase()
    if (unit === 'T') return n * 1024 * 1024
    if (unit === 'M') return n
    return n * 1024
  }

  const renderHardwareStep = () => (
    <Box>
      {vdcQuota && vdcUsage && (
        <VdcQuotaBanner
          quota={vdcQuota}
          usage={vdcUsage}
          requested={{
            vcpus: cores * sockets,
            ramMb: memory,
            storageMb: parseDiskSizeMb(diskSize),
            vms: 1,
          }}
          onStateChange={({ blocked }) => {
            if (blocked !== quotaBlocked) setQuotaBlocked(blocked)
          }}
        />
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, rowGap: 3 }}>
      {/* Cores / Memory / Disk — exposed as sliders with log-scale marks
          so the user picks from sensible quantities (powers of two for
          RAM, common SKUs for disk) without having to type a free-form
          number that could land on something PVE later refuses. The
          sockets / SCSI controller / CPU type knobs stay defaulted (1
          socket, virtio-scsi-single, host CPU); providers who need to
          tweak them can still go through the bare-metal CreateVmDialog. */}
      {(() => {
        // Cores: linear, with marks on classic VM sizings. The slider
        // tops out at 32 — the manual override on the right lets users
        // go beyond when their vDC quota allows it (PVE itself caps at
        // 128 per VM).
        const coresMarks = [1, 2, 4, 8, 16, 32]
        const coresSliderMax = 32
        return (
          <Box sx={{ gridColumn: '1 / -1', px: 1.5 }}>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 600 }}>
                {t('templates.deploy.hardware.cores')}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {cores} {cores > 1 ? 'vCPUs' : 'vCPU'}
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={5}>
              <Box sx={{ flex: 1, pr: 2 }}>
                <Slider
                  size="small"
                  value={Math.min(cores, coresSliderMax)}
                  min={1}
                  max={coresSliderMax}
                  step={1}
                  onChange={(_, v) => setCores(v as number)}
                  marks={coresMarks.map(m => ({ value: m, label: String(m) }))}
                  valueLabelDisplay="auto"
                  sx={{ '& .MuiSlider-markLabel': { fontSize: '0.7rem' } }}
                />
              </Box>
              <TextField
                size="small"
                type="number"
                value={cores}
                onChange={e => setCores(Math.max(1, Number.parseInt(e.target.value) || 1))}
                slotProps={{ htmlInput: { min: 1, max: 128 } }}
                sx={{ width: 120 }}
              />
            </Stack>
          </Box>
        )
      })()}
      {(() => {
        // Memory: log-style picker — marks span 512 MB → 64 GB. The
        // helpers map a continuous slider position into the canonical
        // values so users land on round powers of two (with finer
        // granularity in between if they really want it). Mirrors
        // CreateVmDialog so the two flows feel consistent.
        const memoryMarks = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]
        const memoryToSlider = (mib: number) => {
          for (let i = memoryMarks.length - 1; i >= 0; i--) {
            if (mib >= memoryMarks[i]) {
              return i + (mib - memoryMarks[i]) / (memoryMarks[Math.min(i + 1, memoryMarks.length - 1)] - memoryMarks[i])
            }
          }
          return 0
        }
        const sliderToMemory = (val: number) => {
          const idx = Math.floor(val)
          const frac = val - idx
          if (idx >= memoryMarks.length - 1) return memoryMarks[memoryMarks.length - 1]
          const raw = memoryMarks[idx] + frac * (memoryMarks[idx + 1] - memoryMarks[idx])
          return Math.round(raw / 128) * 128 || 128
        }
        const formatMem = (mib: number) => mib >= 1024 ? `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GB` : `${mib} MB`
        // The slider caps at 64 GiB; the manual override accepts anything
        // ≥128 MiB so users can go higher if their vDC quota allows.
        const memorySliderMax = memoryMarks[memoryMarks.length - 1]
        return (
          <Box sx={{ gridColumn: '1 / -1', px: 1.5 }}>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 600 }}>
                {t('templates.deploy.hardware.memory')}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {formatMem(memory)}
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={5}>
              <Box sx={{ flex: 1, pr: 2 }}>
                <Slider
                  size="small"
                  value={memoryToSlider(Math.min(memory, memorySliderMax))}
                  min={0}
                  max={memoryMarks.length - 1}
                  step={0.01}
                  onChange={(_, v) => setMemory(sliderToMemory(v as number))}
                  marks={memoryMarks.map((m, i) => ({ value: i, label: formatMem(m) }))}
                  valueLabelDisplay="auto"
                  valueLabelFormat={() => formatMem(memory)}
                  sx={{ '& .MuiSlider-markLabel': { fontSize: '0.65rem' } }}
                />
              </Box>
              <TextField
                size="small"
                type="number"
                value={memory}
                onChange={e => setMemory(Math.max(128, Number.parseInt(e.target.value) || 128))}
                slotProps={{
                  htmlInput: { min: 128, step: 128 },
                  input: { endAdornment: <InputAdornment position="end" sx={{ '& p': { fontSize: 11, opacity: 0.6 } }}>MB</InputAdornment> },
                }}
                sx={{ width: 120 }}
              />
            </Stack>
          </Box>
        )
      })()}
      {(() => {
        // Disk: state stays as the PVE-flavoured string ('20G') so the
        // existing payload + parseDiskSizeMb keeps working unchanged.
        // Slider operates in GiB ints; conversions are trivial.
        const diskMarks = [10, 20, 50, 100, 250, 500, 1000]
        const diskGiB = Math.max(diskMarks[0], Number.parseInt(String(diskSize).replace(/G$/i, ''), 10) || diskMarks[0])
        const diskGiBToSlider = (gib: number) => {
          for (let i = diskMarks.length - 1; i >= 0; i--) {
            if (gib >= diskMarks[i]) {
              return i + (gib - diskMarks[i]) / (diskMarks[Math.min(i + 1, diskMarks.length - 1)] - diskMarks[i])
            }
          }
          return 0
        }
        const sliderToDiskGiB = (val: number) => {
          const idx = Math.floor(val)
          const frac = val - idx
          if (idx >= diskMarks.length - 1) return diskMarks[diskMarks.length - 1]
          const raw = diskMarks[idx] + frac * (diskMarks[idx + 1] - diskMarks[idx])
          // Round to 5 GiB so users land on tidy values.
          return Math.max(diskMarks[0], Math.round(raw / 5) * 5)
        }
        // The slider caps at 1000 GiB; the manual override on the right
        // accepts anything ≥1 GiB (PVE itself takes much larger volumes).
        const diskSliderMax = diskMarks[diskMarks.length - 1]
        return (
          <Box sx={{ gridColumn: '1 / -1', px: 1.5 }}>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 600 }}>
                {t('templates.deploy.hardware.diskSize')}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {diskGiB} GB
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={5}>
              <Box sx={{ flex: 1, pr: 2 }}>
                <Slider
                  size="small"
                  value={diskGiBToSlider(Math.min(diskGiB, diskSliderMax))}
                  min={0}
                  max={diskMarks.length - 1}
                  step={0.01}
                  onChange={(_, v) => setDiskSize(`${sliderToDiskGiB(v as number)}G`)}
                  marks={diskMarks.map((m, i) => ({ value: i, label: `${m} GB` }))}
                  valueLabelDisplay="auto"
                  valueLabelFormat={() => `${diskGiB} GB`}
                  sx={{ '& .MuiSlider-markLabel': { fontSize: '0.65rem' } }}
                />
              </Box>
              <TextField
                size="small"
                type="number"
                value={diskGiB}
                onChange={e => setDiskSize(`${Math.max(1, Number.parseInt(e.target.value) || 1)}G`)}
                slotProps={{
                  htmlInput: { min: 1, step: 1 },
                  input: { endAdornment: <InputAdornment position="end" sx={{ '& p': { fontSize: 11, opacity: 0.6 } }}>GB</InputAdornment> },
                }}
                sx={{ width: 120 }}
              />
            </Stack>
          </Box>
        )
      })()}
      {/* Bridge picker.
          - vDC tenant: restricted to SDN VNets. Shared bridges and raw PVE
            bridges are hidden — deployments land on a tenant VNet so traffic
            stays inside the vDC's L2 domain (VXLAN VNI). Each option surfaces
            the VNet's subnet (CIDR + gateway) when configured. The picker
            spans full-width and the VLAN Tag field is dropped (tenant) or
            shown disabled (super-admin parity case below).
          - full cluster view (provider / MSP): lists the whole `bridges`
            list — VNets first (keeping their shield icon + subnet chips),
            then raw bridges / shared uplinks rendered the CreateVmDialog way
            (iface name + a type tag). On a raw bridge the VLAN field is
            editable; on a VNet it stays disabled like before. */}
      {(() => {
        // VNets float to the top so the friendly tenant-scoped entries stay
        // discoverable; raw bridges follow. Stable within each group.
        const vnetChoices = bridges.filter(b => b.type === 'vnet')
        const rawChoices = bridges.filter(b => b.type !== 'vnet')
        const ordered = fullClusterNet ? [...vnetChoices, ...rawChoices] : vnetChoices
        // Selection value:
        //  - full cluster: keep the user's choice if it's still in the list,
        //    else fall back to vmbr0 / first entry (never coerce to a VNet).
        //  - vDC tenant: legacy coercion to a VNet so the displayed value
        //    always matches a surfaced option.
        const selectValue = fullClusterNet
          ? (bridges.some(b => b.iface === networkBridge) ? networkBridge : '')
          : (bridges.some(b => b.iface === networkBridge && b.type === 'vnet') ? networkBridge : (vnetChoices[0]?.iface || ''))
        return (
          <FormControl size="small" sx={hideInfra ? { gridColumn: '1 / -1' } : undefined}>
            <InputLabel>{t('templates.deploy.hardware.bridge')}</InputLabel>
            <Select
              value={selectValue}
              onChange={e => setNetworkBridge(String(e.target.value))}
              label={t('templates.deploy.hardware.bridge')}
            >
              {ordered.length === 0 && (
                <MenuItem value="" disabled>
                  <Typography variant="body2" sx={{ fontStyle: 'italic', opacity: 0.6 }}>
                    {t(fullClusterNet ? 'templates.deploy.hardware.bridgeNoneAvailable' : 'templates.deploy.hardware.bridgeNoVnet')}
                  </Typography>
                </MenuItem>
              )}
              {ordered.map(b => {
                if (b.type === 'vnet') {
                  return (
                    <MenuItem key={b.iface} value={b.iface}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                        <Box component="i" className="ri-shield-keyhole-line" sx={{ fontSize: 14, color: 'primary.main' }} />
                        <Typography variant="body2">{b.displayName || b.iface}</Typography>
                        {b.subnet && (
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 'auto', opacity: 0.7 }}>
                            <Chip
                              size="small"
                              label={b.subnet.cidr}
                              sx={{ height: 18, fontSize: 10 }}
                            />
                            <Typography variant="caption" sx={{ fontSize: 10 }}>
                              gw {b.subnet.gateway}
                            </Typography>
                          </Stack>
                        )}
                      </Box>
                    </MenuItem>
                  )
                }
                // Raw bridge / shared uplink. Mirror CreateVmDialog's label
                // convention: iface name + a short type tag.
                const tag = b.type === 'shared' ? 'Shared' : b.type === 'OVSBridge' ? 'OVS' : 'Bridge'
                return (
                  <MenuItem key={b.iface} value={b.iface}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                      <Box component="i" className="ri-git-branch-line" sx={{ fontSize: 14, opacity: 0.6 }} />
                      <Typography variant="body2">{b.iface}</Typography>
                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.5 }}>{tag}</Typography>
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
        )
      })()}
      {/* VLAN Tag field.
          - vDC tenant (hideInfra): hidden — the picker spans full-width.
          - super-admin on a vDC connection (!hideInfra, !fullClusterNet):
            disabled field for parity with CreateVmDialog (VNet-only here).
          - full cluster view: editable when a raw bridge is selected,
            disabled (with the same VNet tooltip) when a VNet is selected. */}
      {!hideInfra && (() => {
        const sel = bridges.find(b => b.iface === networkBridge)
        // Disabled either because we're not in full cluster view (legacy
        // VNet-only lock) or because the selected choice is a VNet (VXLAN
        // VNI can't carry an 802.1Q tag).
        const vlanDisabled = !fullClusterNet || sel?.type === 'vnet'
        return (
          <Tooltip
            arrow
            placement="top"
            title={vlanDisabled ? t('templates.deploy.hardware.vlanDisabledOnVnetTooltip') : ''}
          >
            <span>
              <TextField
                size="small"
                label={t('templates.deploy.hardware.vlan')}
                type="number"
                value={vlanDisabled ? '' : vlanTag}
                onChange={e => setVlanTag(e.target.value)}
                placeholder={vlanDisabled ? t('templates.deploy.hardware.vlanDisabledOnVnet') : t('templates.deploy.hardware.vlanPlaceholder')}
                slotProps={{ htmlInput: { min: 1, max: 4094 } }}
                disabled={vlanDisabled}
                helperText={vlanDisabled ? t('templates.deploy.hardware.vlanDisabledOnVnetHelp') : undefined}
                fullWidth
              />
            </span>
          </Tooltip>
        )
      })()}
      <FormControlLabel
        control={<Switch checked={agent} onChange={(_, v) => setAgent(v)} size="small" />}
        label={t('templates.deploy.hardware.qemuAgent')}
        sx={{ gridColumn: 'span 2' }}
      />
      </Box>

      {/* ISO-only extras: OS type override, BIOS firmware, disk size hint.
          Cloud-image deployments don't expose any of these — ostype is
          fixed by the catalog and SeaBIOS is fine for every supported
          distro. Machine type stays q35 silently (sent server-side). */}
      {isIsoMode && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="overline" sx={{ opacity: 0.6, display: 'block', mb: 1 }}>
            {t('templates.deploy.iso.installOptions')}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl size="small">
              <InputLabel>{t('templates.catalog.ostypeLabel')}</InputLabel>
              <Select
                value={ostypeOverride || image?.ostype || 'other'}
                onChange={e => setOstypeOverride(String(e.target.value))}
                label={t('templates.catalog.ostypeLabel')}
              >
                <MenuItem value="l26">Linux 2.6+</MenuItem>
                <MenuItem value="win10">Windows 10</MenuItem>
                <MenuItem value="win11">Windows 11 / Server 2022+</MenuItem>
                <MenuItem value="w2k19">Windows Server 2019</MenuItem>
                <MenuItem value="w2k16">Windows Server 2016</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel>{t('templates.deploy.iso.bios')}</InputLabel>
              <Select
                value={bios}
                onChange={e => setBios(e.target.value as 'seabios' | 'ovmf')}
                label={t('templates.deploy.iso.bios')}
              >
                <MenuItem value="seabios">{t('templates.deploy.iso.biosSeabios')}</MenuItem>
                <MenuItem value="ovmf">{t('templates.deploy.iso.biosOvmf')}</MenuItem>
              </Select>
            </FormControl>
          </Box>
          {/* Windows Server 2025 / Win11 install footprint won't fit in
              <32 GB — the installer refuses to start, so we block Next
              and flag this as an error rather than a soft warning. */}
          {(() => {
            const sizeNum = Number.parseInt(String(diskSize).replace(/G$/i, ''), 10) || 0
            const ot = ostypeOverride || image?.ostype || ''
            const isWin2025OrLater = ot === 'win11'
            return (isWin2025OrLater && sizeNum > 0 && sizeNum < 32) ? (
              <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }} icon={<i className="ri-error-warning-line" style={{ fontSize: 18 }} />}>
                {t('templates.deploy.iso.diskWarning')}
              </Alert>
            ) : null
          })()}
        </Box>
      )}

      {/* ISO + IPAM-managed VNet → tenant must commit to a static (IP, MAC).
          Cloud-init can't push ipconfigN to a raw OS installer, so we
          pre-generate a MAC, propose the next free IP, and surface a
          banner instructing the tenant to type these into the OS at
          install time. */}
      {isoNeedsReservation && isoBridgeChoice?.subnet && (
        <IsoNetworkReservation
          ip={staticIp}
          mac={staticMac}
          subnet={{
            cidr: isoBridgeChoice.subnet.cidr,
            gateway: isoBridgeChoice.subnet.gateway,
            dnsServers: isoBridgeChoice.subnet.dnsServers,
          }}
          loading={reservationLoading}
          error={reservationError}
          onIpChange={setStaticIp}
          onMacChange={setStaticMac}
          onAutoPick={(which) => fetchNextFree(which)}
        />
      )}
    </Box>
  )

  const renderCloudInitStep = () => {
    // The CloudInit step is now subnet-aware: when the chosen VNet has an
    // IPAM-managed subnet (always the case in this wizard since we restrict
    // the bridge picker to VNets), we surface the subnet's CIDR + gateway
    // as read-only context and turn the "IP" field into an *override only*
    // — empty means "let IPAM auto-allocate". Gateway is no longer typed
    // by hand because it must match the subnet, otherwise the route would
    // never come up.
    const selectedBridge = bridges.find(b => b.iface === networkBridge)
    const subnet = selectedBridge?.subnet ?? null
    // Validate the optional override IP: must be IPv4-shaped and not equal
    // to the gateway. Range bounds are enforced server-side by IPAM, but
    // this catch-22 ("user typed gateway as VM IP") is worth flagging in
    // the UI before submit.
    const ipOverrideValid = !ipOverride
      || (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipOverride) && ipOverride !== subnet?.gateway)

    // Pre-fill nameserver from the subnet's DNS servers the first time the
    // user lands on this step with a subnet attached and hasn't typed
    // anything yet. We don't overwrite an explicit value.
    if (subnet && !nameserver && subnet.dnsServers.length > 0) {
      // Defer the setState to avoid mutating during render.
      queueMicrotask(() => {
        if (!nameserver) setNameserver(subnet.dnsServers.join(' '))
      })
    }

    return (
    <Stack spacing={2}>
      <TextField
        size="small"
        label={t('templates.deploy.cloudInit.user')}
        value={ciuser}
        onChange={e => setCiuser(e.target.value)}
        placeholder="ubuntu"
        fullWidth
      />
      <TextField
        size="small"
        label={t('templates.deploy.cloudInit.password')}
        value={cipassword}
        onChange={e => setCipassword(e.target.value)}
        type="password"
        fullWidth
        placeholder={t('templates.deploy.cloudInit.passwordPlaceholder')}
      />
      <TextField
        size="small"
        label={t('templates.deploy.cloudInit.sshKeys')}
        value={sshKeys}
        onChange={e => setSshKeys(e.target.value)}
        multiline
        rows={3}
        fullWidth
        placeholder="ssh-ed25519 AAAA... user@host"
      />
      {/* Subnet context + IP override. Gateway is read-only (must match
          the subnet). Empty IP = "auto-allocate from IPAM" — the most
          common case. */}
      {subnet && (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField
            size="small"
            label={t('templates.deploy.cloudInit.ipAddress')}
            value={ipOverride}
            onChange={e => setIpOverride(e.target.value.trim())}
            placeholder={t('templates.deploy.cloudInit.ipAutoFromCidr', { cidr: subnet.cidr })}
            error={!!ipOverride && !ipOverrideValid}
            helperText={
              !!ipOverride && !ipOverrideValid
                ? t('templates.deploy.cloudInit.ipInvalid')
                : t('templates.deploy.cloudInit.ipAutoHelp')
            }
            fullWidth
          />
          <TextField
            size="small"
            label={t('templates.deploy.cloudInit.gateway')}
            value={subnet.gateway}
            InputProps={{ readOnly: true }}
            helperText={t('templates.deploy.cloudInit.gatewayFromSubnet')}
            fullWidth
          />
        </Box>
      )}
      {!subnet && (
        <TextField
          size="small"
          label={t('templates.deploy.cloudInit.ipAddress')}
          value={ipOverride}
          onChange={e => setIpOverride(e.target.value.trim())}
          placeholder="ip=dhcp"
          helperText={t('templates.deploy.cloudInit.ipNoSubnet')}
          fullWidth
        />
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <TextField
          size="small"
          label={t('templates.deploy.cloudInit.nameserver')}
          value={nameserver}
          onChange={e => setNameserver(e.target.value)}
          placeholder="1.1.1.1"
        />
        <TextField
          size="small"
          label={t('templates.deploy.cloudInit.searchdomain')}
          value={searchdomain}
          onChange={e => setSearchdomain(e.target.value)}
          placeholder="local.lan"
        />
      </Box>
    </Stack>
    )
  }

  const renderReviewStep = () => {
    if (!image) return null

    const selectedConn = connections.find(c => c.id === connectionId)

    return (
      <Stack spacing={2}>
        {isIsoMode && (
          <Alert severity="info" icon={<i className="ri-disc-line" style={{ fontSize: 18 }} />}>
            {t('templates.deploy.iso.reviewAlert')}
          </Alert>
        )}

        {/* Image */}
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>{t('templates.deploy.steps.image')}</Typography>
          <Typography variant="body2">{image.name}</Typography>
        </Box>
        <Divider />

        {/* Target */}
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>{t('templates.deploy.steps.target')}</Typography>
          <Typography variant="body2">
            {selectedConn?.name} &rarr; {node} &rarr; {storage}
            {isIsoMode && isoStorage && <> &middot; ISO: {isoStorage}</>}
          </Typography>
          <Typography variant="body2">
            VMID: {vmid} {vmName && `(${vmName})`}
          </Typography>
        </Box>
        <Divider />

        {/* Hardware */}
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>{t('templates.deploy.steps.hardware')}</Typography>
          <Typography variant="body2">
            {cores}C &times; {sockets}S / {memory >= 1024 ? `${memory / 1024} GB` : `${memory} MB`} RAM / {diskSize} / {bridges.find(b => b.iface === networkBridge)?.displayName || networkBridge}
            {isIsoMode && <> &middot; {bios === 'ovmf' ? 'UEFI' : 'BIOS'} &middot; {ostypeOverride || image.ostype}</>}
          </Typography>
        </Box>
        <Divider />

        {/* Cloud-Init — only relevant for cloud-image deployments. ISO
            installs hide this section: the field is meaningless and we
            already alerted the user above. */}
        {!isIsoMode && (
          <>
            <Box>
              <Typography variant="overline" sx={{ opacity: 0.6 }}>{t('templates.deploy.steps.cloudInit')}</Typography>
              <Typography variant="body2">
                {ciuser ? `${t('templates.deploy.cloudInit.user')}: ${ciuser}` : t('templates.deploy.cloudInit.noUser')}
                {cipassword ? ` · ${t('templates.deploy.cloudInit.password')}: ••••••` : ''}
                {' · '}
                {ipOverride
                  ? `${t('templates.deploy.cloudInit.ipAddress')}: ${ipOverride}`
                  : t('templates.deploy.cloudInit.ipAutoSummary')}
              </Typography>
              {sshKeys && (
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {sshKeys.split('\n').filter(Boolean).length} SSH key(s)
                </Typography>
              )}
            </Box>
            <Divider />
          </>
        )}

        {/* Save as blueprint option */}
        <FormControlLabel
          control={<Switch checked={saveAsBlueprint} onChange={(_, v) => setSaveAsBlueprint(v)} size="small" />}
          label={t('templates.deploy.review.saveBlueprint')}
        />
        {saveAsBlueprint && (
          <TextField
            size="small"
            label={t('templates.deploy.review.blueprintName')}
            value={blueprintName}
            onChange={e => setBlueprintName(e.target.value)}
            fullWidth
            placeholder={image.name}
          />
        )}
      </Stack>
    )
  }

  const renderProgressStep = () => {
    if (deploymentId) {
      // Console link surfaces only for completed ISO deployments — the
      // VM is sitting at the boot prompt waiting for the user to drive
      // the OS installer through noVNC. Cloud-image deployments boot
      // unattended and don't need this affordance.
      const consoleHref = (isIsoMode && !deploying && !deployError && connectionId)
        ? `/novnc/console.html?connId=${encodeURIComponent(connectionId)}&type=qemu&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(String(vmid))}`
        : null
      return (
        <>
          <DeploymentProgress deploymentId={deploymentId} onComplete={handleDeployComplete} />
          {consoleHref && (
            <Alert
              severity="success"
              icon={<i className="ri-disc-line" style={{ fontSize: 18 }} />}
              sx={{ mt: 2 }}
              action={
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  onClick={() => window.open(consoleHref, `console-${vmid}`, 'width=1024,height=768,resizable,scrollbars')}
                  startIcon={<i className="ri-computer-line" style={{ fontSize: 16 }} />}
                >
                  {t('templates.deploy.iso.openConsole')}
                </Button>
              }
            >
              {t('templates.deploy.iso.completedHint')}
            </Alert>
          )}
        </>
      )
    }

    if (deployError) {
      return (
        <Alert severity="error" sx={{ mt: 2 }}>
          {deployError}
        </Alert>
      )
    }

    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  // No useMemo here — the previous version's deps array silently went
  // out of date every time we added a piece of step state (staticIp,
  // staticMac, reservationLoading, …), which froze the active step's
  // JSX on a stale closure and made controlled inputs un-typeable. The
  // render functions are cheap (just JSX construction); React's normal
  // reconciliation handles the per-render cost just fine.
  let stepContent: ReactNode = null
  switch (activeStep) {
    case 0: stepContent = renderImageStep(); break
    case 1: stepContent = renderTargetStep(); break
    case 2: stepContent = renderHardwareStep(); break
    case 3: stepContent = renderCloudInitStep(); break
    case 4: stepContent = renderReviewStep(); break
    case 5: stepContent = renderProgressStep(); break
  }

  const isProgressStep = activeStep === 5
  // Minimize is only meaningful while a deploy is in flight — at that
  // point the pipeline runs server-side independently of the dialog.
  // Closing the wizard via the minimize button leaves the deployment
  // visible in the navbar TasksDropdown for follow-up.
  const canMinimize = isProgressStep && deploying && !!deploymentId

  return (
    <Dialog open={open} onClose={isProgressStep && deploying ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-rocket-2-line" style={{ fontSize: 22 }} />
        {t('templates.deploy.title')}
        {canMinimize && (
          <Box sx={{ ml: 'auto' }}>
            <Tooltip title={t('templates.deploy.progress.minimize')}>
              <IconButton size="small" onClick={onClose} aria-label="minimize">
                <i className="ri-subtract-line" style={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </DialogTitle>

      <DialogContent>
        <Stepper
          activeStep={isIsoMode && activeStep > 3 ? activeStep - 1 : activeStep}
          sx={{ mb: 3 }}
          alternativeLabel
        >
          {STEP_LABELS
            .filter(label => !isIsoMode || label !== 'templates.deploy.steps.cloudInit')
            .map(label => (
              <Step key={label}>
                <StepLabel>{t(label as any)}</StepLabel>
              </Step>
            ))}
        </Stepper>

        <Box sx={{ minHeight: 300 }}>
          {stepContent}
        </Box>
      </DialogContent>

      {!isProgressStep && (
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Box sx={{ flex: 1 }} />
          {activeStep > 0 && (
            <Button onClick={handleBack}>{t('common.back')}</Button>
          )}
          {activeStep < 4 ? (
            <Button variant="contained" onClick={handleNext} disabled={!canProceed}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              onClick={handleDeploy}
              disabled={deploying}
              startIcon={deploying ? <CircularProgress size={18} /> : <i className="ri-rocket-2-line" style={{ fontSize: 16 }} />}
            >
              {t('templates.deploy.review.deployNow')}
            </Button>
          )}
        </DialogActions>
      )}

      {isProgressStep && !deploying && (
        <DialogActions>
          <Button variant="contained" onClick={onClose}>
            {deployError ? t('common.close') : t('common.done')}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}
