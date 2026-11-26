'use client'

import { useMemo, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import { useMergedClusters } from '@/lib/microseg/useMerged'
import { useClusterIPFilter } from '@/lib/microseg/useMicrosegLists'
import type { IPFilterGuest, MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

import { DialogErrorLine, ONE_LINE_SX, useDialogAction } from './dialogParts'
import { flowZoneHint, type FlowZoneHint } from './flowZoneHint'
import { FLOW_PROTOS, maskedCidr, validateFlowForm } from './zoneForm'

/** What the dialog hands to onSave: the strict body of POST/PUT /flows without the draft version. */
export type FlowSaveValues = {
  src_zone_id: string
  src_cidr: string
  dst_zone_id: string
  dst_cidr: string
  proto: string
  dport: string
  comment: string
  origin: string
}

type Props = {
  flow: MicrosegFlow | null
  zones: MicrosegZone[]
  /** What a new flow starts from (ignored when editing): the Network flows page prefills the zones and the service. */
  initial?: Partial<Pick<FlowSaveValues, 'src_zone_id' | 'dst_zone_id' | 'proto' | 'dport'>>
  /** The clusters of the policy whose zone members a single-host CIDR is matched against (GET /ipfilter, no Proxmox call). */
  clusterIds?: readonly string[]
  onSave: (values: FlowSaveValues) => Promise<void>
  onClose: () => void
}

type Kind = 'zone' | 'cidr'

const HELPER_SX = { ...ONE_LINE_SX, mx: 0 } as const

type SideProps = {
  side: 'src' | 'dst'
  kind: Kind
  zoneId: string
  cidr: string
  zones: MicrosegZone[]
  error?: string
  disabled: boolean
  /** The other side is a CIDR: a flow is enforced on the guests of a zone, so this side must be one. */
  cidrBlocked: boolean
  /** The zone whose member has the address the CIDR names: offered in its place. */
  hint: FlowZoneHint | null
  onKind: (kind: Kind) => void
  onZone: (id: string) => void
  onCidr: (cidr: string) => void
}

/** One side of a flow: a zone or a CIDR, on one line. */
function FlowSide({ side, kind, zoneId, cidr, zones, error, disabled, cidrBlocked, hint, onKind, onZone, onCidr }: SideProps) {
  const t = useTranslations('microsegPilot.policy.flowDialog')
  const tv = useTranslations()
  const masked = kind === 'cidr' ? maskedCidr(cidr) : null
  const message = error ? tv(error, { masked: masked ?? '' }) : undefined
  const shownHint = kind === 'cidr' && !message ? hint : null
  const pickZone = (id: string) => {
    onZone(id)
    onKind('zone')
  }
  // The span carries the tooltip: a disabled button fires no pointer events. A side already on CIDR (a stored flow of
  // before the check) keeps its button, the validation says what is wrong.
  const blocked = cidrBlocked && kind !== 'cidr'
  let adornment
  if (masked) {
    adornment = <Button size='small' onClick={() => onCidr(masked)} sx={{ textTransform: 'none', flexShrink: 0 }}>{t('useMasked', { masked })}</Button>
  } else if (shownHint) {
    adornment = <Button size='small' onClick={() => pickZone(shownHint.zoneId)} sx={{ textTransform: 'none', flexShrink: 0 }}>{t('useZone', { zone: shownHint.zone })}</Button>
  }
  const sideLabel = t(side === 'src' ? 'srcKind' : 'dstKind')
  const zoneLabel = t(side === 'src' ? 'srcZone' : 'dstZone')
  const cidrLabel = t(side === 'src' ? 'srcCidr' : 'dstCidr')

  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', minWidth: 0 }}>
      <ToggleButtonGroup
        exclusive
        size='small'
        value={kind}
        aria-label={sideLabel}
        disabled={disabled}
        onChange={(_, next: Kind | null) => next && onKind(next)}
        sx={{ flexShrink: 0, height: 40 }}
      >
        <ToggleButton value='zone' sx={{ textTransform: 'none', px: 1.5 }}>{t('kindZone')}</ToggleButton>
        <Tooltip title={blocked ? t('cidrBlocked') : ''}>
          <Box component='span' sx={{ display: 'inline-flex' }}>
            <ToggleButton value='cidr' disabled={disabled || blocked} sx={{ textTransform: 'none', px: 1.5 }}>{t('kindCidr')}</ToggleButton>
          </Box>
        </Tooltip>
      </ToggleButtonGroup>
      {kind === 'zone' ? (
        <FormControl size='small' fullWidth error={!!message} sx={SMALL_SELECT_SX} disabled={disabled}>
          <InputLabel id={`flow-${side}-zone-label`}>{zoneLabel}</InputLabel>
          <Select labelId={`flow-${side}-zone-label`} label={zoneLabel} value={zoneId} onChange={e => onZone(e.target.value)}>
            {zones.map(z => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
          </Select>
        </FormControl>
      ) : (
        <TextField
          label={cidrLabel}
          value={cidr}
          onChange={e => onCidr(e.target.value)}
          disabled={disabled}
          error={!!message}
          helperText={message ?? (shownHint ? t('zoneHint', { addr: shownHint.addr, guest: shownHint.guest, zone: shownHint.zone }) : undefined)}
          placeholder='10.0.0.0/24'
          size='small'
          fullWidth
          slotProps={{
            formHelperText: { sx: HELPER_SX },
            input: adornment ? { endAdornment: adornment } : undefined,
          }}
        />
      )}
    </Box>
  )
}

/**
 * The zone members of the clusters, with their addresses, as the engine's last full run saw them. A cluster not yet
 * computed, or whose read failed, gives none: the dialog then offers no zone, nothing else changes.
 */
function useZoneMembers(clusterIds: readonly string[] | undefined): IPFilterGuest[] {
  const reads = useMergedClusters(clusterIds ?? [], useClusterIPFilter)
  return useMemo(() => (clusterIds ?? []).flatMap(id => {
    const data = reads.byCluster[id]
    return data?.computed && !(id in reads.errors) ? data.guests : []
  }), [clusterIds, reads])
}

/** Create or edit a flow: source, destination, protocol, ports, comment. */
export default function FlowDialog({ flow, zones, initial, clusterIds, onSave, onClose }: Props) {
  const t = useTranslations()
  const td = useTranslations('microsegPilot.policy.flowDialog')
  const editing = flow !== null
  const [srcKind, setSrcKind] = useState<Kind>(flow?.src_cidr ? 'cidr' : 'zone')
  const [dstKind, setDstKind] = useState<Kind>(flow?.dst_cidr ? 'cidr' : 'zone')
  const seed = flow ?? initial
  const [src, setSrc] = useState({ zone: seed?.src_zone_id ?? '', cidr: flow?.src_cidr ?? '' })
  const [dst, setDst] = useState({ zone: seed?.dst_zone_id ?? '', cidr: flow?.dst_cidr ?? '' })
  const [proto, setProto] = useState(seed?.proto ?? 'tcp')
  const [dport, setDport] = useState(seed?.dport ?? '')
  const [comment, setComment] = useState(flow?.comment ?? '')
  const { busy, error, run } = useDialogAction()
  const members = useZoneMembers(clusterIds)

  const cleanCidr = (kind: Kind, value: string) => (kind === 'cidr' ? value.trim() : '')
  const values = {
    src_zone_id: srcKind === 'zone' ? src.zone : '',
    src_cidr: cleanCidr(srcKind, src.cidr),
    dst_zone_id: dstKind === 'zone' ? dst.zone : '',
    dst_cidr: cleanCidr(dstKind, dst.cidr),
    proto,
    dport: dport.trim(),
  }
  const errors = validateFlowForm(values)
  // An empty side is not an error to shout about: the button just stays disabled.
  const shown = (key: 'src' | 'dst') => (errors[key] && !errors[key].endsWith('.sideRequired') ? errors[key] : undefined)
  const hintOf = (kind: Kind, cidr: string) => (kind === 'cidr' ? flowZoneHint(cidr, members, zones) : null)

  const submit = () => {
    if (Object.keys(errors).length > 0) return
    void run(() => onSave({ ...values, comment: comment.trim(), origin: flow?.origin || 'manual' }))
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth aria-labelledby='microseg-flow-title'>
      <DialogTitle id='microseg-flow-title' sx={ONE_LINE_SX}>{editing ? td('editTitle') : td('createTitle')}</DialogTitle>
      {/* MUI zeroes the top padding of a content right under its title: the label of the first field would be cut. */}
      <DialogContent sx={{ '&&': { pt: 2.5 } }}>
        <Stack spacing={2}>
          <FlowSide
            side='src' kind={srcKind} zoneId={src.zone} cidr={src.cidr} zones={zones} error={shown('src')} disabled={busy}
            cidrBlocked={dstKind === 'cidr'} hint={hintOf(srcKind, src.cidr)}
            onKind={setSrcKind} onZone={zone => setSrc(prev => ({ ...prev, zone }))} onCidr={cidr => setSrc(prev => ({ ...prev, cidr }))}
          />
          <FlowSide
            side='dst' kind={dstKind} zoneId={dst.zone} cidr={dst.cidr} zones={zones} error={shown('dst')} disabled={busy}
            cidrBlocked={srcKind === 'cidr'} hint={hintOf(dstKind, dst.cidr)}
            onKind={setDstKind} onZone={zone => setDst(prev => ({ ...prev, zone }))} onCidr={cidr => setDst(prev => ({ ...prev, cidr }))}
          />
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <FormControl size='small' sx={{ ...SMALL_SELECT_SX, width: 140, flexShrink: 0 }} disabled={busy}>
              <InputLabel id='flow-proto-label'>{td('proto')}</InputLabel>
              <Select
                labelId='flow-proto-label'
                label={td('proto')}
                value={proto}
                onChange={e => setProto(e.target.value)}
              >
                {FLOW_PROTOS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label={td('dport')}
              value={dport}
              onChange={e => setDport(e.target.value)}
              disabled={busy}
              error={!!errors.dport}
              helperText={errors.dport ? t(errors.dport) : td('dportHint')}
              size='small'
              fullWidth
              slotProps={{ formHelperText: { sx: HELPER_SX } }}
            />
          </Box>
          <TextField label={td('comment')} value={comment} onChange={e => setComment(e.target.value)} disabled={busy} size='small' fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
          {error && <DialogErrorLine message={error} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button onClick={submit} variant='contained' disabled={busy || Object.keys(errors).length > 0}>
          {editing ? td('save') : td('create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
