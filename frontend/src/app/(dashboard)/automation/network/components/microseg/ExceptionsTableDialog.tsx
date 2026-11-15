'use client'

import { useState } from 'react'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { GuestRefLite, ZoneState } from '@/lib/microseg/types'

import { ONE_LINE_SX } from './dialogParts'
import ExceptionDialog, { useExceptionServiceName } from './ExceptionDialog'
import { draftException, draftMatches, exceptionLabel, exceptionStatus, namedGuests, type ExceptionDraft } from './exceptionModel'
import { ExceptionGuestIcon, ExceptionStatusChip } from './ExceptionLine'
import PolicyPager, { usePaged } from './PolicyPager'
import TruncatedText from './TruncatedText'
import type { PolicyGuest, ZoneMember } from './zoneModel'

/** The guests a cell names before it sums up the others as "+N". */
const CELL_GUESTS = 2

const COLUMNS = 5
const CELL_SX = { display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 } as const
/** The "+N" in the font of the names next to it. */
const MORE_SX = { flexShrink: 0, typography: 'body2', '& .MuiChip-label': { px: 0.75 } } as const
/**
 * A column that gives way (VMs, services): it counts for nothing in the width of the table, so that it takes its share
 * of what the status and the actions leave, and cuts its text.
 */
const YIELDING_CELL_SX = { maxWidth: 0 } as const
/** A column as wide as its widest content, never cut (the status chip, the actions). */
const FITTED_CELL_SX = { width: '1%', whiteSpace: 'nowrap' } as const

type Props = {
  /** The name of the zone as the form has it: empty for a zone being created that has none yet. */
  zoneName: string
  zoneColor: string
  values: ExceptionDraft[]
  guests: PolicyGuest[]
  members: ZoneMember[]
  /** The state of the zone in the form: nothing of an exception is written while the zone is disabled. */
  zoneState: ZoneState
  /** False while the guest list is loading or failed. */
  guestsKnown?: boolean
  /** The whole list after an add, an edit (at its place) or a delete. Nothing is written here. */
  onChange: (next: ExceptionDraft[]) => void
  onClose: () => void
}

/**
 * The guests of one side of an exception on one line: the icon of the first, the names of the first two, then "+N"
 * whose tooltip lists every guest with its VMID.
 */
function GuestsCell({ refs, guests }: { refs: GuestRefLite[]; guests: PolicyGuest[] }) {
  const named = namedGuests(refs, guests)
  const more = named.length - CELL_GUESTS
  return (
    <Box sx={CELL_SX}>
      <ExceptionGuestIcon guest={named[0]?.guest} />
      <TruncatedText text={named.slice(0, CELL_GUESTS).map(n => n.name).join(', ')} variant='body2' sx={{ flex: '0 1 auto', minWidth: 0 }} />
      {more > 0 && (
        <Tooltip
          title={(
            <Box component='span' sx={{ display: 'block' }}>
              {named.map(n => (
                <Box component='span' key={n.key} data-guest sx={{ display: 'block', whiteSpace: 'nowrap' }}>
                  {n.name === String(n.vmid) ? n.name : `${n.name} (${n.vmid})`}
                </Box>
              ))}
            </Box>
          )}
        >
          <Chip size='small' variant='outlined' label={`+${more}`} tabIndex={0} sx={MORE_SX} />
        </Tooltip>
      )}
    </Box>
  )
}

/**
 * The exceptions of the zone being edited, as a table: filtered by a text, paged, each one edited or removed from its
 * row, and added through the exception dialog. It edits the list of the zone form: the save of the zone writes it.
 * Mounted while it is open: its filter and its page start anew each time.
 */
export default function ExceptionsTableDialog({ zoneName, zoneColor, values, guests, members, zoneState, guestsKnown = true, onChange, onClose }: Props) {
  const t = useTranslations('microsegPilot.policy.exceptions')
  const tc = useTranslations('common')
  const serviceName = useExceptionServiceName()
  const [filter, setFilter] = useState('')
  // The row being edited, or `null` for a new exception; undefined while the exception dialog is closed.
  const [editing, setEditing] = useState<number | null | undefined>(undefined)
  // Each exception with its place in the list: the filter and the pages do not change what an action targets.
  const rows = values.map((exception, index) => ({ exception, index })).filter(r => draftMatches(r.exception, guests, serviceName, filter))
  const paged = usePaged(rows)
  const name = zoneName.trim()

  const onFilter = (text: string) => {
    setFilter(text)
    paged.setPage(0)
  }
  const save = (draft: ExceptionDraft) => {
    if (editing == null) {
      // A new exception goes last: the filter is cleared and the last page shown, so that it is in sight.
      onChange([...values, draft])
      setFilter('')
      paged.setPage(Math.floor(values.length / paged.size))
    } else {
      onChange(values.map((v, i) => (i === editing ? draft : v)))
    }
    setEditing(undefined)
  }

  return (
    <Dialog open onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle sx={{ ...ONE_LINE_SX, display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-shield-fill' data-testid='exceptions-table-icon' style={{ fontSize: 18, flexShrink: 0, color: zoneColor || undefined }} />
        <Box component='span' sx={{ ...ONE_LINE_SX, flexShrink: 0 }}>{t('title')}</Box>
        {/* The space is for the name the dialog is read with: on screen the gap of the title sets the parts apart. */}
        {name ? <>{' '}<Box component='span' sx={{ ...ONE_LINE_SX, minWidth: 0, fontWeight: 700 }}>{`\u00B7 ${name}`}</Box></> : null}
      </DialogTitle>
      <DialogContent>
        <Box data-testid='exceptions-table-toolbar' sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'nowrap', minWidth: 0, pt: 1, pb: 1.5 }}>
          <TextField
            value={filter}
            onChange={e => onFilter(e.target.value)}
            placeholder={t('filter')}
            size='small'
            sx={{ flex: '1 1 0', minWidth: 0 }}
            slotProps={{
              htmlInput: { 'aria-label': t('filter') },
              input: { startAdornment: <InputAdornment position='start'><i className='ri-search-line' /></InputAdornment> },
            }}
          />
          <Button variant='outlined' onClick={() => setEditing(null)} startIcon={<i className='ri-add-line' />} sx={{ height: 36, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {t('add')}
          </Button>
        </Box>
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {/* Not a fixed layout: the status column fits its chip, the VM and service columns share the rest. */}
          <Table size='small' aria-label={t('title')} sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...YIELDING_CELL_SX, width: '36%' }}>{t('sources')}</TableCell>
                <TableCell sx={{ ...YIELDING_CELL_SX, width: '36%' }}>{t('destinations')}</TableCell>
                <TableCell sx={{ ...YIELDING_CELL_SX, width: '28%' }}>{t('columns.services')}</TableCell>
                <TableCell sx={FITTED_CELL_SX}>{t('columns.status')}</TableCell>
                <TableCell sx={FITTED_CELL_SX} />
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.rows.map(({ exception, index }) => {
                const stored = draftException(exception, '')
                return (
                  // A new exception has no id yet: its place names it.
                  <TableRow hover key={exception.id ?? `new-${index}`} aria-label={exceptionLabel(stored, guests, serviceName)}>
                    <TableCell sx={YIELDING_CELL_SX}><GuestsCell refs={exception.sources} guests={guests} /></TableCell>
                    <TableCell sx={YIELDING_CELL_SX}><GuestsCell refs={exception.destinations} guests={guests} /></TableCell>
                    <TableCell sx={YIELDING_CELL_SX}><TruncatedText text={exception.services.map(serviceName).join(', ')} variant='body2' /></TableCell>
                    <TableCell sx={FITTED_CELL_SX}>
                      <Box sx={CELL_SX}><ExceptionStatusChip status={exceptionStatus(stored, { state: zoneState }, members, guests)} guestsKnown={guestsKnown} /></Box>
                    </TableCell>
                    <TableCell align='right' sx={{ ...FITTED_CELL_SX, py: 0 }}>
                      <Tooltip title={t('edit')}>
                        <IconButton size='small' aria-label={t('edit')} onClick={() => setEditing(index)}><i className='ri-pencil-line' /></IconButton>
                      </Tooltip>
                      {/* No question asked: nothing is written before the zone is saved. */}
                      <Tooltip title={t('delete')}>
                        <IconButton size='small' aria-label={t('delete')} onClick={() => onChange(values.filter((_, i) => i !== index))}><i className='ri-delete-bin-line' /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS}>
                    <Typography variant='body2' color='text.secondary' sx={ONE_LINE_SX}>{values.length === 0 ? t('none') : t('noMatch')}</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{tc('close')}</Button>
      </DialogActions>
      <ExceptionDialog
        open={editing !== undefined}
        exception={editing == null ? null : values[editing] ?? null}
        guests={guests}
        members={members}
        onSave={save}
        onClose={() => setEditing(undefined)}
      />
    </Dialog>
  )
}
