'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Select, Stack, Tooltip, Typography } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import { LOG_LEVELS } from '@/components/firewall/logLevels'
import type { DraftScope, ScopeOptions } from '@/lib/firewall/publishOps'

import { ONE_LINE_SX, OneLine } from '../microseg/dialogParts'
import { WriteTip, useMicrosegWrite } from '../microseg/microsegAccess'

/** A field of a dialog on one line: the label on the left, the control on the right. */
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <Typography id={id} noWrap sx={{ flex: '0 0 40%', fontSize: 14, color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

type OptionField = 'enable' | 'policy_in' | 'policy_out' | 'log_level_in' | 'log_level_out'

/** The options each scope has in Proxmox: a host has no default policy, the cluster no log level of its own. */
const FIELDS: Record<DraftScope['kind'], OptionField[]> = {
  cluster: ['enable', 'policy_in', 'policy_out'],
  host: ['enable', 'log_level_in', 'log_level_out'],
  guest: ['enable', 'policy_in', 'policy_out', 'log_level_in', 'log_level_out'],
}

const POLICIES = ['ACCEPT', 'DROP', 'REJECT']

export function ScopeOptionsDialog({ open, name, scope, current, locked = [], busy = false, onClose, onSave }: {
  open: boolean
  name: string
  scope: DraftScope
  /** The options as the draft shows them (read, then changed). */
  current: ScopeOptions
  /** Options the engine owns on this guest (its zone rules are there): shown, never changed here. */
  locked?: readonly string[]
  /** A publish is running: the draft takes no change until it ends. */
  busy?: boolean
  onClose: () => void
  onSave: (options: ScopeOptions) => void
}) {
  const t = useTranslations('microsegPilot.dfw')
  const tg = useTranslations()
  // A read-only user sees the options (firewall switch, default policies, log levels) but changes none of them.
  const { canWrite } = useMicrosegWrite()
  const [form, setForm] = useState<ScopeOptions>(current)
  const set = (field: OptionField, value: string) => setForm(prev => ({ ...prev, [field]: field === 'enable' ? Number(value) : value }))
  const choices = (field: OptionField): string[] => {
    if (field === 'enable') return ['1', '0']
    return field.startsWith('policy') ? POLICIES : [...LOG_LEVELS]
  }
  const label = (field: OptionField, value: string) => {
    if (field !== 'enable') return value
    return value === '1' ? t('optionsDialog.on') : t('optionsDialog.off')
  }
  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth aria-labelledby='dfw-options-title'>
      <DialogTitle id='dfw-options-title' sx={ONE_LINE_SX}>{t('optionsDialog.title', { name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {FIELDS[scope.kind].map(field => {
            const engine = locked.includes(field)
            const select = (
              <Select size='small' fullWidth value={String(form[field] ?? '')} onChange={e => set(field, String(e.target.value))} sx={{ ...SMALL_SELECT_SX, width: '100%' }}
                disabled={!canWrite || engine} inputProps={{ 'aria-labelledby': `dfw-opt-${field}` }}>
                {choices(field).map(v => <MenuItem key={v} value={v}>{label(field, v)}</MenuItem>)}
              </Select>
            )
            return (
              <Field key={field} label={t(`optionsDialog.${field}`)} id={`dfw-opt-${field}`}>
                {engine
                  ? <Tooltip title={t('managedRule')}><span style={{ display: 'flex' }}>{select}</span></Tooltip>
                  : <WriteTip>{select}</WriteTip>}
              </Field>
            )
          })}
          <OneLine text={t('optionsDialog.hint')} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tg('common.cancel')}</Button>
        <WriteTip>
          <Button variant='contained' disabled={!canWrite || busy} onClick={() => onSave(form)}>{tg('common.save')}</Button>
        </WriteTip>
      </DialogActions>
    </Dialog>
  )
}
