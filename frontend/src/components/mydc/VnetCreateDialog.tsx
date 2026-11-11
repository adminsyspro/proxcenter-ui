'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog, DialogContent, DialogActions, Button, TextField, FormControlLabel, Switch,
  Alert, Stack, Typography, MenuItem, Checkbox,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import {
  parseCidr, gatewayValidForCidr, usableHostCount, ipToInt, intToIp,
} from '@/lib/vdc/network'
import { readVdcContextCookie } from '@/lib/vdc/contextCookie'
import { DEFAULT_TRANSPORT, VNI_MAX, vniPolicyFor } from '@/lib/vdc/transport'

/** A VLAN range the provider dedicated to this vDC on a given bridge.
 *  Comes straight from `/api/v1/vdcs` (`VdcWithDetails.vlanPools`). */
interface VlanPoolOption { bridge: string; rangeStart: number; rangeEnd: number }

/** VNI policy of the vDC transport (roadmap#18), straight from `VdcWithDetails.transport`. */
interface TransportOption { sharing?: string; vniRangeStart?: number | null; vniRangeEnd?: number | null }

interface VdcOption {
  id: string
  name: string
  vlanPools?: VlanPoolOption[]
  transport?: TransportOption | null
  /** `platform` (#904): the provider operates the L3 edge, so every network declares its subnet. */
  edgeModel?: string | null
  /** Shared EVPN zone the vDC is attached to (#1334): a network created there
   *  reaches the tenant's other vDCs attached to the same zone. */
  evpnZoneId?: string | null
  /** False when the vDC has no VXLAN zone of its own: shared networks only. */
  hasOwnZone?: boolean
}

interface Props {
  open: boolean
  vdcs: VdcOption[]
  defaultVdcId?: string
  onClose: () => void
  onCreated: () => void
}

// User-facing display name — kept scoped to the vDC, free of PVE's 8-char +
// cluster-wide constraints (the backend hashes a unique 8-char pve_name from
// this). Keep in sync with VNET_DISPLAY_NAME_REGEX in lib/vdc/vnets.ts.
const NAME_REGEX = /^[a-z][a-z0-9-]{0,19}$/

export default function VnetCreateDialog({ open, vdcs, defaultVdcId, onClose, onCreated }: Props) {
  const t = useTranslations()
  // Default vDC: the caller-supplied one wins if valid; otherwise the vDC
  // context (if the tenant is scoped to one) beats the arbitrary "first in
  // the list" — a tenant creating a VNet while browsing vDC B shouldn't
  // land the picker on vDC A. A cookie pointing outside `vdcs` (foreign,
  // stale, or the "all vDCs" state) fails open to vdcs[0], same as before.
  const initialVdc = useMemo(() => {
    if (defaultVdcId && vdcs.some(v => v.id === defaultVdcId)) return defaultVdcId
    const ctxVdcId = readVdcContextCookie()
    if (ctxVdcId && vdcs.some(v => v.id === ctxVdcId)) return ctxVdcId
    return vdcs[0]?.id ?? ''
  }, [vdcs, defaultVdcId])

  const [vdcId, setVdcId] = useState(initialVdc)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [cidr, setCidr] = useState('')
  const [gateway, setGateway] = useState('')
  const [dnsServers, setDnsServers] = useState('')        // comma-separated
  // VLAN branch (issue #646). VXLAN stays the default everywhere: a tenant
  // whose vDC carries no VLAN pool never sees any of this.
  const [netType, setNetType] = useState<'vxlan' | 'vlan' | 'evpn'>('vxlan')
  // Shared network (#1334): the vDCs left out of it. Empty = present on every
  // vDC attached to the zone, which is the default.
  const [excludedVdcIds, setExcludedVdcIds] = useState<string[]>([])
  const [bridgeChoice, setBridgeChoice] = useState('')
  const [vlanTag, setVlanTag] = useState('')              // '' = auto-allocate
  const [externalAddressing, setExternalAddressing] = useState(false)
  // Pure L2 (roadmap#18): the tenant may leave the IP configuration out and
  // address the network itself; a platform-provided edge forces it in (#904).
  const [withSubnet, setWithSubnet] = useState(true)
  // Tenant-chosen VNI (roadmap#18), '' = let ProxCenter allocate.
  const [vni, setVni] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // VLAN pools are per-vDC, so a bridge or a tag picked for vDC A means
  // nothing in vDC B: every vDC switch, and every reopen, drops the whole
  // VLAN sub-form back to its defaults rather than carrying a now-foreign
  // selection into the POST.
  const resetVlanForm = useCallback(() => {
    setNetType('vxlan'); setBridgeChoice(''); setVlanTag(''); setExternalAddressing(false)
    setWithSubnet(true); setVni(''); setExcludedVdcIds([])
  }, [])

  useEffect(() => {
    if (!open) return
    setVdcId(initialVdc)
    resetVlanForm()
  }, [open, initialVdc, resetVlanForm])

  const selectedVdc = vdcs.find(v => v.id === vdcId)
  // Shared zone (#1334): offered when the vDC is attached to one. A vDC with
  // no VXLAN zone of its own has nothing else to offer on the overlay side.
  const evpnAvailable = !!selectedVdc?.evpnZoneId
  const ownZone = selectedVdc?.hasOwnZone !== false
  const effectiveType: 'vxlan' | 'vlan' | 'evpn' = netType === 'vxlan' && evpnAvailable && !ownZone ? 'evpn' : netType
  // The vDCs the network can reach are asked to the server: the list this
  // dialog receives may be narrowed to the vDC or the cluster being browsed.
  const [sharedTargets, setSharedTargets] = useState<{ vdcId: string; vdcs: Array<{ id: string; name: string }> } | null>(null)
  useEffect(() => {
    if (!open || !evpnAvailable || !vdcId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/evpn-networks`)
        const json = await res.json()
        if (!cancelled && res.ok && Array.isArray(json?.data?.vdcs)) setSharedTargets({ vdcId, vdcs: json.data.vdcs })
      } catch { /* the vDC itself stays offered */ }
    })()
    return () => { cancelled = true }
  }, [open, evpnAvailable, vdcId])
  const sharedVdcs = useMemo(() => {
    if (!evpnAvailable || !selectedVdc) return []
    const known = sharedTargets?.vdcId === vdcId ? sharedTargets.vdcs : []
    const list = known.some(v => v.id === vdcId) ? known : [{ id: vdcId, name: selectedVdc.name }, ...known]
    return list.map(v => ({ id: v.id, name: v.name, edgeModel: vdcs.find(x => x.id === v.id)?.edgeModel ?? null }))
  }, [evpnAvailable, selectedVdc, sharedTargets, vdcId, vdcs])
  // The vDC the network is created from always carries it.
  const presentVdcIds = sharedVdcs.filter(v => v.id === vdcId || !excludedVdcIds.includes(v.id)).map(v => v.id)
  const togglePresence = (id: string) =>
    setExcludedVdcIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const others = sharedVdcs.filter(v => v.id !== vdcId)
  const allPresent = others.every(v => !excludedVdcIds.includes(v.id))
  const nonePresent = others.every(v => excludedVdcIds.includes(v.id))
  const vlanPools = useMemo(() => selectedVdc?.vlanPools ?? [], [selectedVdc])
  const hasVlanPools = vlanPools.length > 0
  const bridges = useMemo(() => [...new Set(vlanPools.map(p => p.bridge))], [vlanPools])
  // A single bridge in the pools leaves the tenant no decision to make, so
  // it is selected implicitly rather than through an effect that would
  // write state back on every render.
  const bridge = bridgeChoice || (bridges.length === 1 ? bridges[0] : '')
  const bridgeRanges = vlanPools.filter(p => p.bridge === bridge)
  const rangesLabel = bridgeRanges.map(p => `${p.rangeStart}-${p.rangeEnd}`).join(', ')
  const tagNum = vlanTag === '' ? null : Number(vlanTag)
  // '' means "let the backend allocate". A typed tag has to land inside one
  // of the ranges the provider dedicated to this vDC on this bridge; the
  // server re-checks it, this only spares the tenant a round-trip.
  const tagValid = tagNum === null
    || (Number.isInteger(tagNum) && bridgeRanges.some(p => tagNum >= p.rangeStart && tagNum <= p.rangeEnd))

  // VNI policy of the vDC transport (roadmap#18): a dedicated transport lets
  // the tenant pick any VNI, a shared one only inside the provider range, and
  // a shared one without a range leaves the allocation to ProxCenter.
  const vniPolicy = useMemo(() => {
    const tr = selectedVdc?.transport
    return vniPolicyFor({
      sharing: tr?.sharing === 'dedicated' ? 'dedicated' : DEFAULT_TRANSPORT.sharing,
      vniRangeStart: typeof tr?.vniRangeStart === 'number' ? tr.vniRangeStart : null,
      vniRangeEnd: typeof tr?.vniRangeEnd === 'number' ? tr.vniRangeEnd : null,
    })
  }, [selectedVdc])
  const vniNum = vni === '' ? null : Number(vni)
  const vniValid = vniNum === null || (
    Number.isInteger(vniNum) && vniNum >= 1 && vniNum <= VNI_MAX
    && (!vniPolicy.range || (vniNum >= vniPolicy.range.start && vniNum <= vniPolicy.range.end))
  )
  // How the VLAN tag / VNI gets picked. A shared range already reads in the
  // VNI field helper, so no caption repeats it.
  let allocationCaption: string | null = t('myVdc.vnetVniAutoAllocated')
  if (effectiveType === 'evpn') allocationCaption = t('myVdc.vnetSharedAllocated')
  else if (netType === 'vlan') allocationCaption = t('myVdc.vnetVlanAutoAllocated')
  else if (vniPolicy.sharing === 'dedicated') allocationCaption = t('myVdc.vnetVniDedicatedTransport')
  else if (vniPolicy.range) allocationCaption = null

  // A platform-provided edge (#904) needs the subnet to serve it.
  const platformEdge = effectiveType === 'evpn'
    ? sharedVdcs.some(v => presentVdcIds.includes(v.id) && v.edgeModel === 'platform')
    : selectedVdc?.edgeModel === 'platform'
  const subnetOn = withSubnet || platformEdge
  let ipConfigCaption = subnetOn ? t('myVdc.vnetIpConfigHelp') : t('myVdc.vnetL2OnlyHelp')
  if (platformEdge) ipConfigCaption = t('myVdc.vnetIpConfigRequiredPlatform')

  // CIDR / gateway live validation — drives helper text + Submit gate.
  const cidrInfo = useMemo(() => parseCidr(cidr), [cidr])
  const cidrValid = !!cidrInfo
  const gatewayValid = !cidr || !gateway || gatewayValidForCidr(gateway, cidr)

  // Suggest gateway = first usable host the moment a fresh, valid CIDR is
  // typed and the gateway field is still empty (don't fight manual edits).
  useEffect(() => {
    if (!cidrInfo) return
    if (!gateway) {
      const candidate = intToIp(cidrInfo.firstUsableInt)
      if (candidate && ipToInt(candidate) !== null) setGateway(candidate)
    }
  }, [cidrInfo, gateway])

  const nameValid = displayName === '' || NAME_REGEX.test(displayName)
  const subnetValid = !subnetOn || (cidrValid && !!gateway && gatewayValid)
  const canSubmit = !!vdcId && !!displayName && nameValid && subnetValid && !saving
    && (effectiveType === 'evpn' || (netType === 'vxlan' ? vniValid : (!!bridge && tagValid)))

  const handleSubmit = async () => {
    if (!vdcId) {
      setError(t('myVdc.vnetSelectVdc'))
      return
    }
    if (!NAME_REGEX.test(displayName)) {
      setError(t('myVdc.errorInvalidName'))
      return
    }
    setSaving(true); setError(null)
    try {
      // Null subnet = pure L2 network (roadmap#18).
      const subnet = subnetOn
        ? {
            cidr,
            gateway,
            dnsServers: dnsServers
              ? dnsServers.split(',').map(s => s.trim()).filter(Boolean)
              : undefined,
          }
        : null
      const res = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/vnets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          description: description || undefined,
          firewall,
          subnet,
          ...(effectiveType === 'vxlan' && vni !== '' ? { vni: Number(vni) } : {}),
          ...(effectiveType === 'evpn' ? { type: 'evpn', vdcIds: presentVdcIds } : {}),
          ...(netType === 'vlan' ? {
            type: 'vlan',
            bridge,
            ...(vlanTag !== '' ? { vlanTag: Number(vlanTag) } : {}),
            ...(externalAddressing ? { externalAddressing: true } : {}),
          } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onCreated()
      setDisplayName(''); setDescription(''); setFirewall(true)
      setCidr(''); setGateway(''); setDnsServers('')
      resetVlanForm()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose}>{t('myVdc.createVnet')}</AppDialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField
            select
            label={t('myVdc.vnetVdc')}
            value={vdcId}
            onChange={(e) => { setVdcId(e.target.value); resetVlanForm() }}
            disabled={vdcs.length <= 1 || saving}
            helperText={vdcs.length === 0 ? t('myVdc.vnetNoVdc') : undefined}
            fullWidth
          >
            {vdcs.map((v) => (
              <MenuItem key={v.id} value={v.id}>{v.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('myVdc.vnetName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={!nameValid}
            helperText={nameValid ? t('myVdc.vnetNameHint') : t('myVdc.errorInvalidName')}
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { maxLength: 20, pattern: '^[a-z][a-z0-9-]{0,19}$' } }}
          />
          <TextField
            label={t('myVdc.vnetDescription')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
          <FormControlLabel
            control={<Switch checked={firewall} onChange={(e) => setFirewall(e.target.checked)} />}
            label={t('myVdc.vnetFirewallToggle')}
          />
          {(hasVlanPools || (evpnAvailable && ownZone)) && (
            <TextField
              select
              label={t('myVdc.vnetType')}
              value={effectiveType}
              onChange={(e) => {
                const next = e.target.value as 'vxlan' | 'vlan' | 'evpn'
                // Back to VXLAN drops the bridge, the tag AND the external
                // addressing flag: none of them mean anything on an overlay.
                if (next === 'vxlan') resetVlanForm()
                else setNetType(next)
              }}
              helperText={evpnAvailable ? t('myVdc.vnetTypeHelpShared') : t('myVdc.vnetTypeHelp')}
              fullWidth
            >
              {ownZone && <MenuItem value="vxlan">{t('myVdc.vnetTypeVxlan')}</MenuItem>}
              {evpnAvailable && <MenuItem value="evpn">{t('myVdc.vnetTypeShared')}</MenuItem>}
              {hasVlanPools && <MenuItem value="vlan">{t('myVdc.vnetTypeVlan')}</MenuItem>}
            </TextField>
          )}
          {effectiveType === 'evpn' && (
            <Stack spacing={0.5}>
              <Stack direction="row" alignItems="center">
                <Typography variant="subtitle2" sx={{ flex: 1 }}>{t('myVdc.vnetSharedPresence')}</Typography>
                {others.length > 1 && (
                  <FormControlLabel
                    sx={{ mr: 0 }}
                    labelPlacement="start"
                    control={
                      <Checkbox
                        size="small"
                        checked={allPresent}
                        indeterminate={!allPresent && !nonePresent}
                        onChange={() => setExcludedVdcIds(allPresent ? others.map(v => v.id) : [])}
                      />
                    }
                    label={<Typography variant="body2">{t('common.all')}</Typography>}
                  />
                )}
              </Stack>
              {sharedVdcs.map((v) => (
                <FormControlLabel
                  key={v.id}
                  control={
                    <Checkbox
                      size="small"
                      checked={presentVdcIds.includes(v.id)}
                      disabled={v.id === vdcId || saving}
                      onChange={() => togglePresence(v.id)}
                    />
                  }
                  label={
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <i className="ri-cloud-line" style={{ opacity: 0.7 }} />
                      <Typography variant="body2">{v.name}</Typography>
                    </Stack>
                  }
                />
              ))}
              <Typography variant="caption" color="text.secondary">{t('myVdc.vnetSharedPresenceHelp')}</Typography>
            </Stack>
          )}
          {netType === 'vlan' && (
            <>
              <TextField
                select
                label={t('myVdc.vnetBridge')}
                value={bridge}
                onChange={(e) => { setBridgeChoice(e.target.value); setVlanTag('') }}
                fullWidth
              >
                {bridges.map((b) => (<MenuItem key={b} value={b}>{b}</MenuItem>))}
              </TextField>
              <TextField
                label={t('myVdc.vnetVlanId')}
                value={vlanTag}
                onChange={(e) => setVlanTag(e.target.value.trim())}
                error={!tagValid}
                helperText={rangesLabel ? t('myVdc.vnetVlanIdAutoHint', { ranges: rangesLabel }) : t('myVdc.vnetVlanId')}
                type="number"
                fullWidth
                disabled={!bridge}
                slotProps={{ htmlInput: { min: 1, max: 4094 } }}
              />
            </>
          )}
          {effectiveType === 'vxlan' && vniPolicy.tenantChoice && (
            <TextField
              label={t('myVdc.vnetVni')}
              value={vni}
              onChange={(e) => setVni(e.target.value.trim())}
              error={!vniValid}
              helperText={vniPolicy.range
                ? t('myVdc.vnetVniRangeHint', { start: vniPolicy.range.start, end: vniPolicy.range.end })
                : t('myVdc.vnetVniFreeHint', { max: VNI_MAX })}
              type="number"
              fullWidth
              size="small"
              slotProps={{ htmlInput: { min: vniPolicy.range?.start ?? 1, max: vniPolicy.range?.end ?? VNI_MAX } }}
            />
          )}
          {allocationCaption && (
            <Typography variant="caption" color="text.secondary">{allocationCaption}</Typography>
          )}

          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {/* Pure L2 (roadmap#18): the tenant keeps its own addressing; a
                platform-provided edge (#904) needs the subnet and locks it in. */}
            <FormControlLabel
              control={<Switch checked={subnetOn} disabled={platformEdge} onChange={(e) => setWithSubnet(e.target.checked)} />}
              label={t('myVdc.vnetIpConfigToggle')}
            />
            <Typography variant="caption" color="text.secondary">
              {ipConfigCaption}
            </Typography>
            {subnetOn && (<>
            <TextField
              label={t('myVdc.subnetCidr')}
              value={cidr}
              onChange={(e) => setCidr(e.target.value.trim())}
              error={!!cidr && !cidrValid}
              helperText={
                !cidr
                  ? t('myVdc.subnetCidrHint')
                  : !cidrValid
                    ? t('myVdc.subnetCidrInvalid')
                    : t('myVdc.subnetCidrUsable', { count: usableHostCount(cidr) })
              }
              fullWidth
              size="small"
              placeholder="10.42.0.0/24"
              required
            />
            <TextField
              label={t('myVdc.subnetGateway')}
              value={gateway}
              onChange={(e) => setGateway(e.target.value.trim())}
              error={!!gateway && !gatewayValid}
              helperText={
                !!gateway && !gatewayValid
                  ? t('myVdc.subnetGatewayInvalid')
                  : t('myVdc.subnetGatewayHint')
              }
              fullWidth
              size="small"
              placeholder="10.42.0.1"
              disabled={!cidrValid}
              required
            />
            <TextField
              label={t('myVdc.subnetDns')}
              value={dnsServers}
              onChange={(e) => setDnsServers(e.target.value)}
              helperText={t('myVdc.subnetDnsHint')}
              fullWidth
              size="small"
              placeholder="1.1.1.1, 9.9.9.9"
            />
            {/* VLAN only. On a VXLAN overlay ProxCenter's IPAM is the sole
                working allocator (PVE-native DHCP does not work there and an
                outside DHCP cannot reach the overlay), so opting out would
                leave the VNet with no allocator at all. On VLAN it is the
                point of the feature: an outside DHCP or static plan. */}
            {netType === 'vlan' && (
              <>
                <FormControlLabel
                  control={<Checkbox checked={externalAddressing} onChange={(e) => setExternalAddressing(e.target.checked)} />}
                  label={t('myVdc.vnetExternalAddressing')}
                />
                {externalAddressing && (
                  <Typography variant="caption" color="text.secondary">{t('myVdc.vnetExternalAddressingHelp')}</Typography>
                )}
              </>
            )}
            </>)}
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>{t('common.create')}</Button>
      </DialogActions>
    </Dialog>
  )
}
