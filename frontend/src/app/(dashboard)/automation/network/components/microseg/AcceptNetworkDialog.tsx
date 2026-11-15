'use client'

import { useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Select, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import { cidrPreview, prefixBounds } from './observationModel'

type Props = {
  /** The destination address of the outbound flow: the network is the one it falls in. */
  ip: string
  onAccept: (prefixLen: number) => void
  onClose: () => void
}

/**
 * Accepting an outbound flow as a network: the prefix length on one line, with the network it makes beside it
 * (/24 proposed for IPv4, /64 for IPv6).
 */
export default function AcceptNetworkDialog({ ip, onAccept, onClose }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.observation.prefix')
  const { min, max, def } = prefixBounds(ip)
  const [len, setLen] = useState(def)
  const lengths = Array.from({ length: max - min + 1 }, (_, i) => min + i)

  return (
    <Dialog open onClose={onClose} maxWidth='xs' fullWidth aria-labelledby='microseg-prefix-title'>
      <DialogTitle id='microseg-prefix-title'>{t('title')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, pt: 1 }}>
          <Typography variant='body2' sx={{ flexShrink: 0 }}>{t('length')}</Typography>
          <Select size='small' value={len} onChange={e => setLen(Number(e.target.value))} inputProps={{ 'aria-label': t('length') }} sx={{ ...SMALL_SELECT_SX, minWidth: 90 }}>
            {lengths.map(n => <MenuItem key={n} value={n}>{`/${n}`}</MenuItem>)}
          </Select>
          <Typography variant='body2' fontWeight={600} noWrap sx={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}>{cidrPreview(ip, len)}</Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant='contained' onClick={() => onAccept(len)}>{t('accept')}</Button>
      </DialogActions>
    </Dialog>
  )
}
