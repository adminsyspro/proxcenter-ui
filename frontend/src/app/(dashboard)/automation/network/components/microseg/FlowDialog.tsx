'use client'

import { useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack,
  TextField, ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

import { DialogErrorLine, ONE_LINE_SX, useDialogAction } from './dialogParts'
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
  onKind: (kind: Kind) => void
  onZone: (id: string) => void
  onCidr: (cidr: string) => void
}

/** One side of a flow: a zone or a CIDR, on one line. */
function FlowSide({ side, kind, zoneId, cidr, zones, error, disabled, onKind, onZone, onCidr }: SideProps) {
  const t = useTranslations('microsegPilot.policy.flowDialog')
  const tv = useTranslations()
  const masked = kind === 'cidr' ? maskedCidr(cidr) : null
  const message = error ? tv(error, { masked: masked ?? '' }) : undefined
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
        <ToggleButton value='cidr' sx={{ textTransform: 'none', px: 1.5 }}>{t('kindCidr')}</ToggleButton>
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
          helperText={message}
          placeholder='10.0.0.0/24'
          size='small'
          fullWidth
          slotProps={{
            formHelperText: { sx: HELPER_SX },
            input: masked ? {
              endAdornment: <Button size='small' onClick={() => onCidr(masked)} sx={{ textTransform: 'none', flexShrink: 0 }}>{t('useMasked', { masked })}</Button>,
            } : undefined,
          }}
        />
      )}
    </Box>
  )
}

/** Create or edit a flow: source, destination, protocol, ports, comment. */
export default function FlowDialog({ flow, zones, onSave, onClose }: Props) {
  const t = useTranslations()
  const td = useTranslations('microsegPilot.policy.flowDialog')
  const editing = flow !== null
  const [srcKind, setSrcKind] = useState<Kind>(flow?.src_cidr ? 'cidr' : 'zone')
  const [dstKind, setDstKind] = useState<Kind>(flow?.dst_cidr ? 'cidr' : 'zone')
  const [src, setSrc] = useState({ zone: flow?.src_zone_id ?? '', cidr: flow?.src_cidr ?? '' })
  const [dst, setDst] = useState({ zone: flow?.dst_zone_id ?? '', cidr: flow?.dst_cidr ?? '' })
  const [proto, setProto] = useState(flow?.proto ?? 'tcp')
  const [dport, setDport] = useState(flow?.dport ?? '')
  const [comment, setComment] = useState(flow?.comment ?? '')
  const { busy, error, run } = useDialogAction()

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

  const submit = () => {
    if (Object.keys(errors).length > 0) return
    void run(() => onSave({ ...values, comment: comment.trim(), origin: flow?.origin || 'manual' }))
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth aria-labelledby='microseg-flow-title'>
      <DialogTitle id='microseg-flow-title' sx={ONE_LINE_SX}>{editing ? td('editTitle') : td('createTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <FlowSide
            side='src' kind={srcKind} zoneId={src.zone} cidr={src.cidr} zones={zones} error={shown('src')} disabled={busy}
            onKind={setSrcKind} onZone={zone => setSrc(prev => ({ ...prev, zone }))} onCidr={cidr => setSrc(prev => ({ ...prev, cidr }))}
          />
          <FlowSide
            side='dst' kind={dstKind} zoneId={dst.zone} cidr={dst.cidr} zones={zones} error={shown('dst')} disabled={busy}
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
