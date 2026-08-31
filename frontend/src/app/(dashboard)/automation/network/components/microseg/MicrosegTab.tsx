'use client'

import { useEffect, useMemo, useState } from 'react'

import { Alert, Autocomplete, Box, Chip, CircularProgress, IconButton, LinearProgress, TextField, Tooltip, Typography, alpha, useTheme } from '@mui/material'
import { ReactFlowProvider } from '@xyflow/react'
import { useTranslations } from 'next-intl'

import * as firewallAPI from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import { buildEastWestFlows, type EastWestGuest } from '@/lib/firewall/eastWest'
import { useToast } from '@/contexts/ToastContext'

import RuleFormDialog, { type RuleFormData } from '../rules/RuleFormDialog'
import AddFlowRuleDialog from './AddFlowRuleDialog'
import EastWestCanvas from './EastWestCanvas'
import { GuestOptionRow, GuestStatusIcon } from './GuestOption'
import { buildFlowGraph, type MsFlowNodeData, type MsFlowOrigin, type MsSelection } from './buildFlowGraph'
import { useGuestIps } from './useGuestIps'

interface MicrosegTabProps {
  vmFirewallData: VMFirewallInfo[]
  loadingVMRules: boolean
  guestsNotScanned: number
  reloadVMFirewallRules: (vm: VMFirewallInfo) => Promise<void>
  securityGroups: firewallAPI.SecurityGroup[]
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  selectedConnection: string
  /** Reloads the shared firewall objects, needed after editing an SG rule. */
  reload: () => void
}

const EMPTY_RULE_FORM: RuleFormData = {
  type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '',
  source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '',
}

/**
 * Micro-segmentation tab: the east-west traffic view. Guests come from the
 * page's firewall scan; their addresses are resolved once on demand; the flow
 * resolution itself is pure (lib/firewall/eastWest) and re-runs on any change.
 */
export default function MicrosegTab({
  vmFirewallData, loadingVMRules, guestsNotScanned, reloadVMFirewallRules,
  securityGroups, aliases, ipsets, selectedConnection, reload,
}: MicrosegTabProps) {
  const t = useTranslations('microseg.eastWest')
  const tNet = useTranslations()
  const theme = useTheme()
  const { showToast } = useToast()

  const { ipsByVmid, loadingIps, loadGuestIps, resetGuestIps } = useGuestIps(selectedConnection || null)

  const [selection, setSelection] = useState<MsSelection>(null)
  const [query, setQuery] = useState('')
  // The VM picker's working set (vmids); empty means every guest is shown.
  const [vmFilter, setVmFilter] = useState<number[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)

  // New connection: the previous connection's addresses no longer mean anything.
  useEffect(() => {
    resetGuestIps()
  }, [selectedConnection, resetGuestIps])

  useEffect(() => {
    if (vmFirewallData.length > 0) loadGuestIps(vmFirewallData)
  }, [vmFirewallData, loadGuestIps])

  const guests: EastWestGuest[] = useMemo(() => vmFirewallData.map(vm => ({
    vmid: vm.vmid,
    name: vm.name,
    node: vm.node,
    type: vm.type,
    status: vm.status,
    ips: ipsByVmid.get(vm.vmid) ?? [],
    firewallEnabled: vm.firewallEnabled,
    ...(vm.options?.policy_in ? { policyIn: vm.options.policy_in } : {}),
    ...(vm.options?.policy_out ? { policyOut: vm.options.policy_out } : {}),
    rules: vm.rules,
    ...(vm.nics ? { nics: vm.nics } : {}),
  })), [vmFirewallData, ipsByVmid])

  const flows = useMemo(
    () => buildEastWestFlows(guests, securityGroups, aliases, ipsets),
    [guests, securityGroups, aliases, ipsets],
  )

  // A selection left over from another connection (the page clears the guest
  // list on switch) is ignored rather than reset from an effect.
  const effectiveSelection = selection !== null && guests.some(g => g.vmid === selection.vmid) ? selection : null

  const vmidFilter = useMemo(() => (vmFilter.length > 0 ? new Set(vmFilter) : null), [vmFilter])

  const graph = useMemo(
    () => buildFlowGraph({
      guests, flows, selection: effectiveSelection, query, vmidFilter,
      colors: { edge: theme.palette.success.main, edgeDim: alpha(theme.palette.success.main, 0.35) },
    }),
    [guests, flows, effectiveSelection, query, vmidFilter, theme.palette.success.main],
  )

  // Picker options sorted like the columns; labels resolved through the guests.
  const pickerOptions = useMemo(
    () => [...guests].sort((a, b) => a.name.localeCompare(b.name) || a.vmid - b.vmid).map(g => g.vmid),
    [guests],
  )
  const guestByVmid = useMemo(() => new Map(guests.map(g => [g.vmid, g])), [guests])
  const pickerLabel = (vmid: number) => {
    const g = guestByVmid.get(vmid)

    return g ? `${g.name} (${g.vmid})` : String(vmid)
  }

  const onVmClick = (side: 'source' | 'dest', vmid: number) => {
    setSelection(prev => (prev && prev.side === side && prev.vmid === vmid) ? null : { side, vmid })
  }

  const onRuleCreated = (destVmid: number) => {
    const vm = vmFirewallData.find(v => v.vmid === destVmid)
    if (vm) reloadVMFirewallRules(vm)
  }

  // ── Edit the rule behind a connection card ──
  const [editOrigin, setEditOrigin] = useState<MsFlowOrigin | null>(null)
  const [editForm, setEditForm] = useState<RuleFormData>(EMPTY_RULE_FORM)

  const onFlowClick = (data: MsFlowNodeData) => {
    const origin = data.origins[0]
    if (!origin) return

    const rule = origin.via
      ? securityGroups.find(g => g.group === origin.via)?.rules?.find(r => r.pos === origin.pos)
      : vmFirewallData.find(v => v.vmid === origin.vmid)?.rules.find(r => r.pos === origin.pos)
    if (!rule) return

    setEditForm({
      type: rule.type || 'in', action: rule.action || 'ACCEPT', enable: rule.enable ?? 1,
      proto: rule.proto || '', dport: rule.dport || '', sport: rule.sport || '',
      source: rule.source || '', dest: rule.dest || '', macro: rule.macro || '',
      iface: rule.iface || '', log: rule.log || 'nolog', comment: rule.comment || '',
    })
    setEditOrigin(origin)
  }

  const submitRuleEdit = async () => {
    if (!editOrigin || !selectedConnection) return
    try {
      if (editOrigin.via) {
        await firewallAPI.updateSecurityGroupRule(selectedConnection, editOrigin.via, editOrigin.pos, editForm)
        reload()
      } else {
        const vm = vmFirewallData.find(v => v.vmid === editOrigin.vmid)
        if (!vm) return
        await firewallAPI.updateVMRule(selectedConnection, vm.node, vm.type, vm.vmid, editOrigin.pos, editForm)
        reloadVMFirewallRules(vm)
      }
      showToast(tNet('network.ruleUpdated'), 'success')
      setEditOrigin(null)
    } catch (err: any) {
      showToast(err.message || tNet('networkPage.error'), 'error')
    }
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <Box>
          <Typography variant='h6' sx={{ fontWeight: 700 }}>{t('ewTitle')}</Typography>
          <Typography variant='body2' color='text.secondary'>{t('ewSubtitle')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Autocomplete
            multiple
            size='small'
            limitTags={2}
            options={pickerOptions}
            value={vmFilter}
            onChange={(_e, value) => setVmFilter(value)}
            getOptionLabel={pickerLabel}
            renderOption={(optionProps, vmid) => {
              const { key, ...rest } = optionProps

              return (
                <li key={key} {...rest}>
                  <GuestOptionRow guest={guestByVmid.get(vmid)} label={pickerLabel(vmid)} />
                </li>
              )
            }}
            renderTags={(value, getTagProps) => value.map((vmid, index) => {
              const { key, ...tagProps } = getTagProps({ index })
              const guest = guestByVmid.get(vmid)

              return (
                <Chip
                  key={key}
                  size='small'
                  label={pickerLabel(vmid)}
                  {...(guest ? { icon: <GuestStatusIcon guest={guest} size={13} /> } : {})}
                  {...tagProps}
                />
              )
            })}
            renderInput={params => <TextField {...params} label={t('filterVms')} />}
            sx={{ minWidth: 280, maxWidth: 420 }}
          />
          <TextField
            size='small'
            placeholder={tNet('networkPage.searchVm')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            InputProps={{
              startAdornment: <i className='ri-search-line' style={{ marginRight: 6, fontSize: 16, color: theme.palette.text.disabled }} />,
              sx: { fontSize: 13 },
            }}
            sx={{ width: 200 }}
          />
          <Chip label={t('flowsCount', { count: flows.length })} size='small' />
          <Tooltip title={t('reloadIps')}>
            <span>
              <IconButton size='small' onClick={() => loadGuestIps(vmFirewallData, true)} disabled={loadingIps || vmFirewallData.length === 0}>
                {loadingIps ? <CircularProgress size={16} /> : <i className='ri-refresh-line' style={{ fontSize: 16 }} />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {guestsNotScanned > 0 && (
        <Alert severity='warning' sx={{ mb: 2 }}>{tNet('firewall.membersPartial', { count: guestsNotScanned })}</Alert>
      )}

      {loadingVMRules ? (
        <Box sx={{ py: 4 }}>
          <LinearProgress />
          <Typography variant='body2' sx={{ color: 'text.secondary', textAlign: 'center', mt: 2 }}>{tNet('networkPage.loadingFirewallRules')}</Typography>
        </Box>
      ) : (
        <Box
          sx={{
            height: 'calc(100vh - 420px)',
            minHeight: 480,
            border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
            borderRadius: 1.5,
            overflow: 'hidden',
            bgcolor: 'background.paper',
          }}
        >
          <ReactFlowProvider>
            <EastWestCanvas
              nodes={graph.nodes}
              edges={graph.edges}
              onVmClick={onVmClick}
              onFlowClick={onFlowClick}
              onAddRuleClick={() => setDialogOpen(true)}
              onPaneClick={() => setSelection(null)}
            />
          </ReactFlowProvider>
        </Box>
      )}

      <RuleFormDialog
        open={editOrigin !== null}
        onClose={() => setEditOrigin(null)}
        onSubmit={submitRuleEdit}
        isNew={false}
        scope={editOrigin?.via ? { type: 'security-group', name: editOrigin.via } : { type: 'vm', name: editOrigin?.name ?? '' }}
        rule={editForm}
        onRuleChange={setEditForm}
        securityGroups={securityGroups}
        aliases={aliases}
        ipsets={ipsets}
        {...(editOrigin?.via ? { notice: t('sgRuleNotice', { name: editOrigin.via }) } : {})}
      />

      <AddFlowRuleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        guests={guests}
        key={`add-rule-${effectiveSelection?.side ?? 'none'}-${effectiveSelection?.vmid ?? 0}-${dialogOpen}`}
        defaultSourceVmid={effectiveSelection?.side === 'source' ? effectiveSelection.vmid : null}
        defaultDestVmid={effectiveSelection?.side === 'dest' ? effectiveSelection.vmid : null}
        selectedConnection={selectedConnection}
        onCreated={onRuleCreated}
      />
    </Box>
  )
}
