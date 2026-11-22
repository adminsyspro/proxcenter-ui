'use client'

import { useState, type ReactNode } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Switch, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegIPFilter } from '@/lib/microseg/useMicrosegLists'
import type { IPFilterHeld, MicrosegPolicy } from '@/lib/microseg/types'

import AllowAddressDialog from './AllowAddressDialog'
import { DialogErrorLine, ONE_LINE_SX, OneLine, useDialogAction } from './dialogParts'
import IPFilterLines, { FILTER_LINE_SX, FILTER_STATE_VISUAL, FilterLine } from './IPFilterLines'
import { guestFilterOf, guestFilterState, invalidAddress, ipFilterAvailable, ipFilterRow, parseAddresses, type FilterGuestRef } from './ipFilterModel'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import PanelSection from './PanelSection'
import { useGuestFilterEdits } from './useGuestFilterEdits'

type Props = {
  /** The connection the policy is read and written through (the tab's). */
  connectionId: string
  /** The guest, with its own cluster: its filter is read from that cluster. */
  guest: FilterGuestRef & { name: string }
}

type ExtraDialogProps = {
  name: string
  initial: readonly string[]
  canWrite: boolean
  /** Throws when the write fails: the dialog stays open and says why. */
  onSave: (addresses: string[]) => Promise<void>
  onClose: () => void
}

/** The additional addresses of a guest, one per line; a mistyped one is said at once, a refusal of the server under the field. */
function ExtraAddressesDialog({ name, initial, canWrite, onSave, onClose }: Readonly<ExtraDialogProps>) {
  const t = useTranslations('microsegPilot.ipFilter')
  const tc = useTranslations('common')
  const [text, setText] = useState(() => initial.join('\n'))
  const { busy, error, run } = useDialogAction()
  const addresses = parseAddresses(text)
  const bad = invalidAddress(addresses)
  const unchanged = addresses.length === initial.length && addresses.every((a, i) => a === initial[i])
  const problem = bad === null ? error : t('extraInvalid', { addr: bad })

  const save = async () => {
    if (await run(() => onSave(addresses))) onClose()
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth='xs' fullWidth aria-labelledby='microseg-ipfilter-extra-title'>
      <DialogTitle id='microseg-ipfilter-extra-title' sx={ONE_LINE_SX}>{t('extraTitle', { name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <OneLine text={t('extraHint')} />
          <TextField
            value={text}
            onChange={e => setText(e.target.value)}
            error={bad !== null}
            disabled={busy || !canWrite}
            multiline
            minRows={4}
            maxRows={10}
            size='small'
            fullWidth
            autoFocus
            autoComplete='off'
            slotProps={{ htmlInput: { 'aria-label': t('extraLabel'), spellCheck: false } }}
          />
          {problem && <DialogErrorLine message={problem} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
        <WriteTip>
          <Button onClick={() => { void save() }} variant='contained' disabled={!canWrite || busy || bad !== null || unchanged}>{tc('save')}</Button>
        </WriteTip>
      </DialogActions>
    </Dialog>
  )
}

/** A setting of the section on one line: its name, what it holds, its control at the right edge (the same edge on every row). */
function SettingLine({ label, value, children }: Readonly<{ label: string; value?: string; children: ReactNode }>) {
  return (
    <Box role='listitem' sx={FILTER_LINE_SX}>
      <Typography variant='body2' noWrap sx={{ flex: '0 1 auto', minWidth: 0 }}>{label}</Typography>
      <Typography variant='body2' color='text.secondary' noWrap sx={{ flex: '1 1 0', minWidth: 0 }}>{value ?? ''}</Typography>
      <Box sx={{ flexShrink: 0, width: 72, display: 'flex', justifyContent: 'flex-end' }}>{children}</Box>
    </Box>
  )
}

function SectionBody({ connectionId, guest, policy, reloadPolicy }: Readonly<Props & { policy: MicrosegPolicy; reloadPolicy: () => Promise<unknown> }>) {
  const t = useTranslations('microsegPilot.ipFilter')
  const tm = useTranslations('microsegPilot')
  const { canWrite } = useMicrosegWrite()
  const { data } = useMicrosegIPFilter(guest.connectionId)
  const edits = useGuestFilterEdits(connectionId, policy, reloadPolicy)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const [editing, setEditing] = useState(false)
  const [allowing, setAllowing] = useState<IPFilterHeld | null>(null)

  const row = ipFilterRow(data, guest)
  const entry = guestFilterOf(edits.filters, guest, connectionId)
  const state = guestFilterState(data, row, policy.policy.ip_filter === true)
  const visual = FILTER_STATE_VISUAL[state]
  const stateText = state === 'waiting' ? tm('waitingFirstCheck') : t(`state.${state}`, { nics: (row?.no_address ?? []).join(', ') })
  const extra = entry?.extra ?? []
  // The settings of a guest that is in no zone would never apply: they show only where one is already stored.
  const settable = state !== 'notMember' || !!entry

  const setLeftOut = async (disabled: boolean) => {
    setBusy(true)
    setFailure(null)
    try {
      await edits.change(guest, { disabled })
    } catch (e) {
      setFailure(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {failure != null && <MicrosegErrorAlert error={failure} onClose={() => setFailure(null)} />}
      <Box role='list' sx={{ minWidth: 0 }}>
        <FilterLine icon={visual.icon} tone={visual.tone} text={stateText} testId='ipfilter-state' />
      </Box>
      {row && data?.computed && <IPFilterLines guest={row} onAllow={setAllowing} busy={busy} />}
      {settable && (
        <Box role='list' sx={{ minWidth: 0 }}>
          <SettingLine label={t('leaveOut')}>
            <WriteTip>
              <Switch
                size='small'
                checked={entry?.disabled === true}
                disabled={!canWrite || busy}
                onChange={e => { void setLeftOut(e.target.checked) }}
                slotProps={{ input: { role: 'switch', 'aria-label': t('leaveOut') } }}
              />
            </WriteTip>
          </SettingLine>
          <SettingLine label={t('extra')} value={extra.length > 0 ? t('extraCount', { count: extra.length }) : t('extraNone')}>
            <WriteTip>
              <Button size='small' variant='outlined' disabled={!canWrite || busy} onClick={() => setEditing(true)} aria-label={t('extraEditLabel')} sx={{ whiteSpace: 'nowrap' }}>
                {t('extraEdit')}
              </Button>
            </WriteTip>
          </SettingLine>
        </Box>
      )}
      {editing && (
        <ExtraAddressesDialog
          name={guest.name}
          initial={extra}
          canWrite={canWrite}
          onSave={addresses => edits.change(guest, { extra: addresses })}
          onClose={() => setEditing(false)}
        />
      )}
      {allowing && (
        <AllowAddressDialog
          connectionId={connectionId}
          policy={policy}
          reloadPolicy={reloadPolicy}
          guest={guest}
          addr={allowing.addr}
          onDone={() => setAllowing(null)}
          onCancel={() => setAllowing(null)}
        />
      )}
    </>
  )
}

/**
 * The foldable "IP filter" section of a guest panel: one line for its state, one per NIC with its addresses, one per
 * address held back (with "Allow"), the source addresses the lists would drop, the NICs on DHCP, then its two settings
 * ("Leave without the filter", "Additional addresses"). The settings are draft changes (PUT /policy with the whole list),
 * applied with the next plan. Nothing is drawn on an orchestrator that does not know the IP filter. The policy is the
 * tab's own read (same SWR key): no request of its own for it.
 */
export default function GuestIPFilterSection({ connectionId, guest }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.ipFilter')
  const { data: policy, reload } = useMicrosegPolicy(connectionId)
  if (!policy || !ipFilterAvailable(policy)) return null
  return (
    <PanelSection id='guest.ipfilter' title={t('section')}>
      <SectionBody connectionId={connectionId} guest={guest} policy={policy} reloadPolicy={reload} />
    </PanelSection>
  )
}
