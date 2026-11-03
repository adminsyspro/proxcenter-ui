import { useState, useCallback, useEffect, useRef } from 'react'
import * as firewallAPI from '@/lib/api/firewall'
import { errorMessage } from '@/lib/firewall/loadError'
import { hasNICFirewall } from '@/lib/firewall/pveDefaults'
import type { GuestCoverageRow } from '@/lib/firewall/guestCoverage'
import { COVERAGE_POLL_MS, firewallCoverageUrl, type FirewallCoverage } from './useZeroTrust'

export interface VMFirewallInfo {
  vmid: number
  name: string
  node: string
  type: 'qemu' | 'lxc'
  status: string
  /** The firewall filters this guest's traffic: both levels below are on. */
  firewallEnabled: boolean
  /** Enabled in the guest's firewall options (PVE "Firewall: Yes"). */
  optionsEnabled: boolean
  /** `firewall=1` on at least one NIC. */
  nicFirewallEnabled: boolean
  /** The state above could not be told (options unreadable, NICs not read by the inventory yet): shown as unknown. */
  stateUnknown: boolean
  /** Empty and meaningless until `rulesLoaded`: a guest's rules are read on demand only (UA44). */
  rules: firewallAPI.FirewallRule[]
  rulesLoaded: boolean
  options: firewallAPI.VMOptions | null
  vlans: number[]
  /** Proxmox tags, for the micro-segmentation zone membership. */
  tags: string[]
}

// Both levels must be on for PVE to filter anything (#1065): the options
// switch alone, or firewall=1 on a NIC alone, used to read as protected.
function firewallState(options: firewallAPI.VMOptions | null, config: Record<string, any> | null | undefined) {
  const optionsEnabled = options?.enable === 1
  const nicFirewallEnabled = hasNICFirewall(config)

  return { firewallEnabled: optionsEnabled && nicFirewallEnabled, optionsEnabled, nicFirewallEnabled, stateUnknown: false }
}

// Helper: Extract unique VLAN tags from NIC config (tag=XXX)
function extractVLANs(config: Record<string, any>): number[] {
  const vlans = new Set<number>()
  for (let i = 0; i < 10; i++) {
    const netConfig = config[`net${i}`]
    if (netConfig && typeof netConfig === 'string') {
      const match = /tag=(\d+)/.exec(netConfig)
      if (match) vlans.add(Number.parseInt(match[1], 10))
    }
  }
  return Array.from(vlans).sort((a, b) => a - b)
}

const keyOf = (g: { type: string; vmid: number | string }) => `${g.type}/${g.vmid}`

/** A row of the coverage route as the panels read it; the rules of a guest already read are kept. */
function toInfo(row: GuestCoverageRow, previous: VMFirewallInfo | undefined): VMFirewallInfo {
  return {
    vmid: Number.parseInt(row.vmid, 10),
    name: row.name,
    node: row.node,
    type: row.type,
    status: row.status,
    firewallEnabled: row.enabled === true,
    optionsEnabled: row.optionsEnabled === true,
    nicFirewallEnabled: row.nicFirewall === true,
    stateUnknown: row.enabled === null,
    rules: previous?.rulesLoaded ? previous.rules : [],
    rulesLoaded: !!previous?.rulesLoaded,
    options: (row.options as firewallAPI.VMOptions | null) ?? null,
    vlans: row.vlans,
    tags: row.tags,
  }
}

interface UseVMFirewallRulesReturn {
  vmFirewallData: VMFirewallInfo[]
  loadingVMRules: boolean
  /** What failed on the last load, null when it loaded. */
  vmRulesError: string | null
  /**
   * Guests left out by the 200-guest cap of the server. Anything reading `vmFirewallData` as a count, security
   * group membership, firewall coverage, is partial when this is above zero, and must say so.
   */
  guestsNotScanned: number
  /** Reads the guest list (one request); `force` asks the server for new figures. */
  loadVMFirewallData: (force?: boolean) => Promise<void>
  /** Reads ONE guest's rules (one request), when its row is opened. */
  loadGuestRules: (vm: VMFirewallInfo) => Promise<firewallAPI.FirewallRule[]>
  reloadVMFirewallRules: (vm: VMFirewallInfo) => Promise<void>
  setVMFirewallData: React.Dispatch<React.SetStateAction<VMFirewallInfo[]>>
}

/**
 * The guests of a connection with their firewall state, for the Firewalling > VMs and Security Groups tabs.
 *
 * Load budget (UA44): the list is ONE request to the coverage route, which asks Proxmox one options call per guest at
 * most (4 in flight, 2 per node, 200 guests, cached 10 min, shared by every viewer). A guest's rules are read only
 * when its row is opened, one request for that guest. This hook used to ask three requests per guest (rules,
 * options, config), 8 guests at a time, every time one of these tabs opened.
 */
export function useVMFirewallRules(connectionId: string | null): UseVMFirewallRulesReturn {
  const [vmFirewallData, setVMFirewallData] = useState<VMFirewallInfo[]>([])
  const [loadingVMRules, setLoadingVMRules] = useState(false)
  const [vmRulesError, setVMRulesError] = useState<string | null>(null)
  const [guestsNotScanned, setGuestsNotScanned] = useState(0)
  const [loaded, setLoaded] = useState(false)

  // Each load takes a number and the connection it is for; only the latest load of the current connection may write
  // state. Without it, the slow load of the connection that was just left finished after the switch.
  const latestScan = useRef(0)
  const currentConnection = useRef(connectionId)
  const controller = useRef<AbortController | null>(null)
  const rulesInFlight = useRef(new Map<string, Promise<firewallAPI.FirewallRule[]>>())
  useEffect(() => { currentConnection.current = connectionId }, [connectionId])
  useEffect(() => () => controller.current?.abort(), [])

  // Another connection starts from nothing (adjusted while rendering, not in an effect).
  const [scannedConnection, setScannedConnection] = useState(connectionId)
  if (scannedConnection !== connectionId) {
    setScannedConnection(connectionId)
    setVMFirewallData([])
    setLoadingVMRules(false)
    setVMRulesError(null)
    setGuestsNotScanned(0)
    setLoaded(false)
  }

  const loadVMFirewallData = useCallback(async (force = false) => {
    if (!connectionId || (loaded && !force)) return

    const scanId = ++latestScan.current
    const isLatest = () => latestScan.current === scanId && currentConnection.current === connectionId
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort

    setLoadingVMRules(true)
    let error: string | null = null

    try {
      let url = `${firewallCoverageUrl(connectionId)}${force ? '?refresh=1' : ''}`
      let body: FirewallCoverage
      // While the server computes, read again (each read joins its computation: no new Proxmox call).
      for (;;) {
        const res = await fetch(url, { cache: 'no-store', signal: abort.signal })
        body = await res.json()
        if (!res.ok) throw new Error((body as any)?.error || `HTTP ${res.status}`)
        if (!body.computing || !isLatest()) break
        url = firewallCoverageUrl(connectionId)
        await new Promise(resolve => setTimeout(resolve, COVERAGE_POLL_MS))
      }
      if (!isLatest()) return

      setGuestsNotScanned(Math.max(0, (body.total ?? 0) - (body.measured ?? 0)))
      setVMFirewallData(prev => {
        const before = new Map(prev.map(v => [keyOf(v), v]))
        return (body.guests ?? []).map(row => toInfo(row, before.get(keyOf(row))))
      })
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return
      error = errorMessage(err)
      if (isLatest()) setVMFirewallData([])
    } finally {
      if (isLatest()) {
        setVMRulesError(error)
        setLoadingVMRules(false)
        setLoaded(true)
      }
    }
  }, [connectionId, loaded])

  const loadGuestRules = useCallback(async (vm: VMFirewallInfo) => {
    if (!connectionId) return []
    const key = `${connectionId}:${keyOf(vm)}`
    const running = rulesInFlight.current.get(key)
    if (running) return running

    const read = firewallAPI.getVMRules(connectionId, vm.node, vm.type, vm.vmid)
      .then(rules => (Array.isArray(rules) ? rules : []))
      .finally(() => rulesInFlight.current.delete(key))
    rulesInFlight.current.set(key, read)
    const rules = await read

    if (currentConnection.current === connectionId) {
      setVMFirewallData(prev => prev.map(v => (keyOf(v) === keyOf(vm) ? { ...v, rules, rulesLoaded: true } : v)))
    }

    return rules
  }, [connectionId])

  // After an edit of one guest: its rules, options and NIC config again (that guest only).
  const reloadVMFirewallRules = useCallback(async (vm: VMFirewallInfo) => {
    if (!connectionId) return

    const scanId = latestScan.current

    try {
      const [rulesData, optionsData, configResp] = await Promise.all([
        firewallAPI.getVMRules(connectionId, vm.node, vm.type, vm.vmid).catch(() => []),
        firewallAPI.getVMOptions(connectionId, vm.node, vm.type, vm.vmid).catch(() => null),
        fetch(`/api/v1/connections/${connectionId}/guests/${vm.type}/${vm.node}/${vm.vmid}/config`).then(r => r.json()).catch(() => null)
      ])

      // Another connection or a new load since: this guest's answer no longer belongs to the list.
      if (latestScan.current !== scanId || currentConnection.current !== connectionId) return

      const vlans = configResp?.data ? extractVLANs(configResp.data) : vm.vlans

      setVMFirewallData(prev => prev.map(v =>
        keyOf(v) === keyOf(vm) ? {
          ...v,
          ...firewallState(optionsData, configResp?.data),
          rules: Array.isArray(rulesData) ? rulesData : [],
          rulesLoaded: true,
          options: optionsData,
          vlans,
        } : v
      ))
    } catch (err) {
      console.error('Failed to reload VM firewall rules:', err)
    }
  }, [connectionId])

  const resetVMFirewallData: typeof setVMFirewallData = (value) => {
    setVMFirewallData(value)
    setLoaded(false)
  }

  return {
    vmFirewallData,
    loadingVMRules,
    vmRulesError,
    guestsNotScanned,
    loadVMFirewallData,
    loadGuestRules,
    reloadVMFirewallRules,
    setVMFirewallData: resetVMFirewallData,
  }
}
