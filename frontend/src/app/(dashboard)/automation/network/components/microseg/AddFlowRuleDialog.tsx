'use client'

import { useState } from 'react'

import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Select, TextField,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import * as firewallAPI from '@/lib/api/firewall'
import { useToast } from '@/contexts/ToastContext'
import type { EastWestGuest } from '@/lib/firewall/eastWest'

import { GuestOptionRow } from './GuestOption'

/** A picked guest (vmid), a free IP/CIDR typed in, or nothing yet. */
type EndpointValue = number | string | null

/**
 * Loose shape check for a free endpoint: IPv4, IPv4/len, IPv4-IPv4 range, or
 * anything IPv6-looking. PVE validates for real on submit; this only keeps
 * obvious non-addresses from silently producing a broken rule.
 */
export function looksLikeIpOrCidr(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.includes(':')) return true

  const ipv4 = String.raw`\d{1,3}(\.\d{1,3}){3}`

  return new RegExp(`^${ipv4}(/\\d{1,2}|-${ipv4})?$`).test(trimmed)
}

interface AddFlowRuleDialogProps {
  open: boolean
  onClose: () => void
  guests: EastWestGuest[]
  /** Prefills from the current canvas selection. */
  defaultSourceVmid: number | null
  defaultDestVmid: number | null
  selectedConnection: string
  /** Called with the guest carrying the new rule once it is created. */
  onCreated: (carrierVmid: number) => void
}

/**
 * Creates the allow rule behind a new east-west flow. The rule always lives on
 * a guest's firewall: a guest destination takes an `IN ACCEPT` (the destination
 * controls its ingress) whose source is the source guest's IP or a free
 * IP/CIDR; a free destination flips the rule to an `OUT ACCEPT` carried by the
 * source guest. Two free endpoints have no guest to carry the rule, so the
 * form refuses them.
 */
export default function AddFlowRuleDialog({
  open, onClose, guests, defaultSourceVmid, defaultDestVmid, selectedConnection, onCreated,
}: AddFlowRuleDialogProps) {
  const t = useTranslations('microseg.eastWest')
  const { showToast } = useToast()

  // The parent remounts the dialog (key) when it opens, so the initial state
  // seeds the form and no reset effect is needed.
  const [source, setSource] = useState<EndpointValue>(defaultSourceVmid)
  const [dest, setDest] = useState<EndpointValue>(defaultDestVmid)
  const [proto, setProto] = useState('tcp')
  const [dport, setDport] = useState('')
  const [iface, setIface] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const guestOf = (value: EndpointValue) => (typeof value === 'number' ? guests.find(g => g.vmid === value) : undefined)
  const isFree = (value: EndpointValue): value is string => typeof value === 'string' && value.trim().length > 0

  const sourceGuest = guestOf(source)
  const destGuest = guestOf(dest)
  const bothFree = !sourceGuest && !destGuest && (isFree(source) || isFree(dest))

  const freeInvalid = (value: EndpointValue) => isFree(value) && !looksLikeIpOrCidr(value)

  // What the rule's source reference will be, when the destination carries it.
  const sourceRef = sourceGuest ? sourceGuest.ips[0] : (isFree(source) && looksLikeIpOrCidr(source) ? source.trim() : undefined)
  const destRef = isFree(dest) && looksLikeIpOrCidr(dest) ? dest.trim() : undefined

  // A rule from a machine to itself allows nothing: same guest on both sides,
  // or a free address that is exactly the opposite guest's own IP.
  const refIsGuestIp = (ref: string | undefined, guest: EastWestGuest | undefined) => {
    if (ref === undefined || guest === undefined) return false
    const bare = ref.endsWith('/32') ? ref.slice(0, -3) : ref

    return guest.ips.includes(bare)
  }
  const selfRule = (sourceGuest !== undefined && sourceGuest.vmid === destGuest?.vmid) ||
    (destGuest !== undefined && sourceGuest === undefined && refIsGuestIp(sourceRef, destGuest)) ||
    (destGuest === undefined && refIsGuestIp(destRef, sourceGuest))

  // Ingress on the destination guest, else egress on the source guest.
  const carrier = destGuest ?? (destRef !== undefined ? sourceGuest : undefined)

  // PVE scopes a rule's `iface` to the carrier guest's own NICs. When the
  // carrier changes, a stale pick silently falls back to every interface.
  const carrierNics = carrier?.nics ?? []
  const ifaceValue = carrierNics.some(nic => `net${nic.index}` === iface) ? iface : ''
  const canSubmit = carrier !== undefined && !selfRule && !saving &&
    (destGuest ? sourceRef !== undefined : destRef !== undefined)

  const endpointName = (value: EndpointValue) => guestOf(value)?.name ?? (isFree(value) ? value.trim() : '')
  const defaultComment = `east-west: ${endpointName(source)} -> ${endpointName(dest)}`

  const submit = async () => {
    if (!carrier) return
    setSaving(true)
    const service = {
      ...(proto ? { proto } : {}),
      ...(dport ? { dport } : {}),
      ...(ifaceValue ? { iface: ifaceValue } : {}),
      comment: comment || defaultComment,
    }

    try {
      if (destGuest) {
        await firewallAPI.addVMRule(selectedConnection, destGuest.node, destGuest.type, destGuest.vmid, {
          type: 'in', action: 'ACCEPT', enable: 1, source: sourceRef, ...service,
        })
      } else {
        await firewallAPI.addVMRule(selectedConnection, carrier.node, carrier.type, carrier.vmid, {
          type: 'out', action: 'ACCEPT', enable: 1, dest: destRef, ...service,
        })
      }
      showToast(t('ruleCreated'), 'success')
      onCreated(carrier.vmid)
      onClose()
    } catch (err: any) {
      showToast(err.message || 'Error', 'error')
      setSaving(false)
    }
  }

  const guestLabel = (g: EastWestGuest) => `${g.name} (${g.vmid})${g.ips[0] ? ` · ${g.ips[0]}` : ''}`
  const optionLabel = (value: number | string) => {
    const g = typeof value === 'number' ? guests.find(x => x.vmid === value) : undefined

    return g ? guestLabel(g) : String(value)
  }

  /**
   * autoSelect re-commits the visible text on blur, so a guest picked from the
   * list would come back as its own label string and read as an invalid free
   * address. A committed string that is exactly a guest's label maps back to
   * that guest; anything else really is free text.
   */
  const normalizeEndpoint = (value: number | string | null): EndpointValue => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (trimmed === '') return null

    return guests.find(g => guestLabel(g) === trimmed)?.vmid ?? trimmed
  }

  const endpointField = (label: string, value: EndpointValue, onChange: (v: EndpointValue) => void, disabledVmid?: number) => (
    <Autocomplete
      freeSolo
      autoSelect
      size='small'
      options={guests.map(g => g.vmid)}
      getOptionLabel={optionLabel}
      getOptionDisabled={option => option === disabledVmid}
      renderOption={(optionProps, option) => {
        const { key, ...rest } = optionProps

        return (
          <li key={key} {...rest}>
            <GuestOptionRow guest={typeof option === 'number' ? guests.find(g => g.vmid === option) : undefined} label={optionLabel(option)} />
          </li>
        )
      }}
      value={value}
      onChange={(_e, v) => onChange(normalizeEndpoint(v))}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          placeholder={t('endpointHelp')}
          error={freeInvalid(value)}
          helperText={freeInvalid(value) ? t('invalidCidr') : undefined}
        />
      )}
    />
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
      <DialogTitle>{t('addRuleTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {endpointField(t('sourceVm'), source, setSource, destGuest?.vmid)}
          {endpointField(t('destVm'), dest, setDest, sourceGuest?.vmid)}

          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl size='small' sx={{ minWidth: 110 }}>
              <InputLabel>{t('protocol')}</InputLabel>
              <Select value={proto} label={t('protocol')} onChange={e => setProto(e.target.value)}>
                <MenuItem value='tcp'>TCP</MenuItem>
                <MenuItem value='udp'>UDP</MenuItem>
                <MenuItem value='icmp'>ICMP</MenuItem>
                <MenuItem value=''>{t('anyProtocol')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size='small'
              fullWidth
              label={t('port')}
              value={dport}
              onChange={e => setDport(e.target.value)}
              placeholder='5432, 8000:8080'
              disabled={proto === 'icmp' || proto === ''}
            />
          </Box>

          <FormControl size='small' fullWidth disabled={carrierNics.length === 0}>
            <InputLabel>{t('interface')}</InputLabel>
            <Select value={ifaceValue} label={t('interface')} onChange={e => setIface(e.target.value)} displayEmpty={false}>
              <MenuItem value=''>{t('anyInterface')}</MenuItem>
              {carrierNics.map(nic => (
                <MenuItem key={nic.index} value={`net${nic.index}`}>
                  {`net${nic.index}`}{nic.bridge ? ` (${nic.bridge})` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            size='small'
            fullWidth
            label={t('comment')}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={carrier ? defaultComment : ''}
          />

          {bothFree && <Alert severity='warning'>{t('bothFree')}</Alert>}
          {selfRule && <Alert severity='warning'>{t('selfRule')}</Alert>}
          {!selfRule && destGuest !== undefined && sourceGuest !== undefined && !sourceRef && <Alert severity='warning'>{t('sourceNoIp')}</Alert>}
          {!selfRule && destGuest && <Alert severity='info' sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>{t('ruleTarget', { name: destGuest.name })}</Alert>}
          {!selfRule && !destGuest && carrier && <Alert severity='info' sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>{t('ruleTargetOut', { name: carrier.name })}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant='contained' onClick={submit} disabled={!canSubmit}>{t('create')}</Button>
      </DialogActions>
    </Dialog>
  )
}
