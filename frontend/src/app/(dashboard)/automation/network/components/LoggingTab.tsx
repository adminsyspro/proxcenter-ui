'use client'

// Logging tab of the Network Security page (ui#1114): the firewall log of one
// element of the infrastructure at a time, picked in a single list (the
// cluster's host rules, a node, a guest, a security group). Reading every log
// of a cluster at once would cost a read per node and per guest every few
// seconds, so nothing is read until an element is chosen.

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Autocomplete, Box, InputAdornment, TextField, Typography, useTheme } from '@mui/material'

import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import FirewallLogView from '@/components/firewall/FirewallLogView'

import type { LogGuestInfo } from '@/components/firewall/FirewallLogView'
import type { FirewallLogScope, FirewallMode, SecurityGroup } from '@/lib/api/firewall'

interface Props {
  selectedConnection: string
  nodesList: string[]
  securityGroups: SecurityGroup[]
  firewallMode: FirewallMode
}

interface Guest extends LogGuestInfo {
  vmid: number
  node: string
}

type Target =
  | { kind: 'cluster'; key: string; label: string }
  | { kind: 'node'; key: string; label: string; status?: string }
  | { kind: 'vm'; key: string; label: string; guest: Guest }
  | { kind: 'group'; key: string; label: string; comment?: string }

function scopeOf(target: Target): FirewallLogScope {
  switch (target.kind) {
    case 'cluster': return { kind: 'cluster' }
    case 'node': return { kind: 'node', node: target.label }
    case 'vm': return { kind: 'vm', node: target.guest.node, vmType: target.guest.type, vmid: target.guest.vmid }
    default: return { kind: 'group', group: target.label }
  }
}

/** The guests and node states the list shows; one cluster resources read each. */
function useInventory(connectionId: string) {
  const [guests, setGuests] = useState<Guest[]>([])
  const [nodeStatus, setNodeStatus] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const json = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

    void Promise.all([
      json(`/api/v1/connections/${connectionId}/resources`),
      json(`/api/v1/connections/${connectionId}/nodes`),
    ]).then(([res, nodes]) => {
      if (!alive) return
      const list: any[] = Array.isArray(res?.data) ? res.data : []

      setGuests(list
        .filter(g => !g.template && g.vmid && (g.type === 'qemu' || g.type === 'lxc'))
        .map(g => ({ vmid: Number(g.vmid), name: g.name || `VM ${g.vmid}`, node: g.node, type: g.type, status: g.status }))
        .sort((a, b) => a.vmid - b.vmid))
      setNodeStatus(Object.fromEntries((Array.isArray(nodes?.data) ? nodes.data : []).map((n: any) => [n.node || n.name, n.status])))
      setLoading(false)
    })

    return () => { alive = false }
  }, [connectionId])

  return { guests, nodeStatus, loading }
}

export default function LoggingTab({ selectedConnection, nodesList, securityGroups, firewallMode }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper

  const { guests, nodeStatus, loading } = useInventory(selectedConnection)
  const [target, setTarget] = useState<Target | null>(null)

  const guestsByVmid = useMemo(() => Object.fromEntries(guests.map(g => [g.vmid, g])), [guests])

  // In kind order, as groupBy needs each kind contiguous.
  const options = useMemo<Target[]>(() => [
    // A standalone node has no cluster beyond itself: its node log says it all.
    ...(firewallMode === 'cluster' ? [{ kind: 'cluster' as const, key: 'cluster', label: t('firewallLog.clusterTarget') }] : []),
    ...[...nodesList].sort((a, b) => a.localeCompare(b)).map(n => ({ kind: 'node' as const, key: `node:${n}`, label: n, status: nodeStatus[n] })),
    ...guests.map(g => ({ kind: 'vm' as const, key: `vm:${g.vmid}`, label: `${g.name} #${g.vmid}`, guest: g })),
    ...[...securityGroups].sort((a, b) => a.group.localeCompare(b.group)).map(g => ({ kind: 'group' as const, key: `group:${g.group}`, label: g.group, comment: g.comment })),
  ], [firewallMode, nodesList, nodeStatus, guests, securityGroups, t])

  const groupLabel = (kind: Target['kind']) => ({
    cluster: t('firewallLog.groupCluster'),
    node: t('firewallLog.groupNodes'),
    vm: t('firewallLog.groupGuests'),
    group: t('firewallLog.groupSecurityGroups'),
  })[kind]

  const glyph = (o: Target) => {
    switch (o.kind) {
      case 'cluster': return <i className="ri-server-line" style={{ fontSize: 15, opacity: 0.8 }} />
      case 'node': return <NodeGlyph status={o.status} dark={dark} dotBorder={dotBorder} />
      case 'vm': return <GuestGlyph type={o.guest.type} status={o.guest.status} dotBorder={dotBorder} />
      default: return <i className="ri-shield-check-line" style={{ fontSize: 15, opacity: 0.8 }} />
    }
  }

  const caption = (o: Target) => {
    if (o.kind === 'cluster') return t('firewallLog.clusterTargetHint')
    if (o.kind === 'vm') return o.guest.node
    if (o.kind === 'group') return o.comment

    return undefined
  }

  return (
    <Box>
      <Box sx={{ px: 2, pt: 2, pb: target ? 0.5 : 2 }}>
        <Autocomplete
          options={options}
          value={target}
          onChange={(_, v) => setTarget(v)}
          loading={loading}
          groupBy={o => groupLabel(o.kind)}
          getOptionLabel={o => o.label}
          getOptionKey={o => o.key}
          isOptionEqualToValue={(a, b) => a.key === b.key}
          // A guest is also found by its node, a group by its comment.
          filterOptions={(opts, { inputValue }) => {
            const q = inputValue.trim().toLowerCase()

            return opts.filter(o => !q || o.label.toLowerCase().includes(q) || (caption(o) || '').toLowerCase().includes(q))
          }}
          renderOption={({ key, ...props }, o) => (
            <Box component="li" key={key} {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 18, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>{glyph(o)}</Box>
              <Typography variant="body2" noWrap>{o.label}</Typography>
              {caption(o) && (
                <Typography variant="caption" noWrap sx={{ color: 'text.disabled', ml: 'auto', pl: 2 }}>{caption(o)}</Typography>
              )}
            </Box>
          )}
          renderInput={params => (
            <TextField
              {...params}
              size="small"
              label={t('firewallLog.target')}
              placeholder={t('firewallLog.targetPlaceholder')}
              InputProps={{
                ...params.InputProps,
                startAdornment: target ? (
                  <InputAdornment position="start" sx={{ ml: 0.5 }}>{glyph(target)}</InputAdornment>
                ) : undefined,
              }}
            />
          )}
          sx={{ maxWidth: 520 }}
        />
      </Box>

      {target ? (
        <FirewallLogView
          key={target.key}
          connectionId={selectedConnection}
          scope={scopeOf(target)}
          guests={guestsByVmid}
          maxHeight="fill"
        />
      ) : (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <i className="ri-terminal-box-line" style={{ fontSize: 36, opacity: 0.3 }} />
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{t('firewallLog.pickTarget')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 0.5, maxWidth: 520, mx: 'auto' }}>
            {t('firewallLog.pickTargetHint')}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
