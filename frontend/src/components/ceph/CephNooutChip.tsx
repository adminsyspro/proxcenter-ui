'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useToast } from '@/contexts/ToastContext'
import { osdNames, type CephNooutState } from '@/hooks/useCephNoout'
import { byFlagOrder } from '@/lib/ceph/osdFlagsView'

/*
   The Ceph flags of a node's CRUSH host (ui#1164): noout set by maintenance,
   and any noin / noup / nodown set from the Ceph tab. Shown while one is set,
   whether or not the node is in maintenance, so a flag left behind is seen.
   One remove button lifts them all (the Ceph tab switches handle them one
   by one): the others first, then noout through the maintenance route,
   which keeps it while an OSD of the node is not up yet and offers to force. `inline` draws it as a segment of the maintenance
   banner rather than as a box of its own.
*/

const cephLogo = <img src="/images/ceph-logo.svg" alt="" width={16} height={16} />

export default function CephNooutChip({ state, canManage = false, inline = false }: Readonly<{ state: CephNooutState; canManage?: boolean; inline?: boolean }>) {
  const t = useTranslations()
  const toast = useToast()
  // A removal is running: the button shows a spinner.
  const [busy, setBusy] = useState(false)
  // The OSDs the server reported down: the force dialog is open while set.
  const [downOsds, setDownOsds] = useState<number[] | null>(null)

  const info = state.info
  const flags = [...new Set([...(info?.hostFlags || []), ...(info?.noout ? ['noout'] : [])])]
    .sort(byFlagOrder)
  if (!info || flags.length === 0) return null
  const host = info.crushHost || state.node
  const osds = osdNames(state.osds.map(o => o.id))

  const remove = async (force: boolean) => {
    setBusy(true)
    try {
      const result = await state.remove({ force })
      if (result.ok) {
        setDownOsds(null)
        toast.success(t('cephNoout.removed', { host }))
      } else if (result.code === 'osds_down' && !force) {
        setDownOsds(result.osds || [])
      } else {
        toast.error(t('cephNoout.removeFailed', { error: result.error || '' }))
      }
    } finally {
      setBusy(false)
    }
  }

  const removeAll = async () => {
    setBusy(true)
    try {
      for (const flag of flags.filter(f => f !== 'noout')) {
        if (await state.removeHostFlag(flag)) toast.success(t('cephNoout.hostFlagUnset', { flag, host }))
        else toast.error(t('cephNoout.removeFailed', { error: flag }))
      }
    } finally {
      setBusy(false)
    }
    if (flags.includes('noout')) await remove(false)
  }

  return (
    <>
      <Box
        component="span"
        data-testid="ceph-noout-chip"
        sx={inline
          ? { display: 'inline-flex', alignItems: 'center', gap: 1, pl: 2.5, borderLeft: '1px solid', borderColor: 'warning.main', minWidth: 0 }
          : { display: 'inline-flex', alignItems: 'center', gap: 1, px: 2.5, height: 30, border: '1px solid', borderColor: 'warning.main', borderRadius: '6px', color: 'warning.main', flexShrink: 0 }}
      >
        <Tooltip title={t('cephNoout.chipTooltip', { host, osds, count: state.osds.length })}>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <img src="/images/ceph-logo.svg" alt="" width={16} height={16} />
            <Typography variant="body2" fontWeight={600} noWrap>Ceph</Typography>
          </Box>
        </Tooltip>
        <Tooltip title={t('ceph.osdFlagOnHost', { flag: flags.join(', '), host, count: flags.length })}>
          <Typography variant="body2" fontWeight={600} noWrap data-testid="ceph-host-flags">{flags.join(' · ')}</Typography>
        </Tooltip>
        {canManage && (
          <Tooltip title={t('cephNoout.removeFlag', { flag: flags.join(', '), host })}>
            <span>
              <IconButton
                size="small"
                aria-label={t('cephNoout.removeFlag', { flag: flags.join(', '), host })}
                disabled={busy}
                onClick={() => void removeAll()}
                sx={{ p: 0.25, color: 'warning.main' }}
              >
                {busy ? <CircularProgress size={14} /> : <i className="ri-close-circle-line" style={{ fontSize: 16 }} />}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      <Dialog open={downOsds !== null} onClose={() => { if (!busy) setDownOsds(null) }} maxWidth="xs" fullWidth>
        <AppDialogTitle icon={<img src="/images/ceph-logo.svg" alt="" width={20} height={20} />}>
          {t('cephNoout.removeTitle', { host })}
        </AppDialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Alert severity="warning">{t('cephNoout.osdsNotUp', { osds: osdNames(downOsds || []), count: downOsds?.length ?? 0 })}</Alert>
          <Typography variant="body2" color="text.secondary">{t('cephNoout.forceRemoveHelp')}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDownOsds(null)} color="inherit" disabled={busy}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            onClick={() => void remove(true)}
          >
            {t('cephNoout.forceRemove')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
