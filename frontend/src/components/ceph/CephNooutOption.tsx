'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Box, Checkbox, FormControlLabel, Typography } from '@mui/material'

import { osdNames, type CephNooutState } from '@/hooks/useCephNoout'

/*
   The Ceph noout option of a maintenance dialog (ui#1164), the same block in
   every entry point: the checkbox, on by default, then what the operator
   should know before confirming. Entering: the cluster health when it is not
   OK, the other hosts already flagged, and the ok-to-stop refusal with its
   explicit acknowledgement. Leaving: the OSDs not up yet, which keep the flag.
   Nothing renders without Ceph or without an OSD on the node.
*/

export default function CephNooutOption({ state, disabled = false }: Readonly<{ state: CephNooutState; disabled?: boolean }>) {
  const t = useTranslations()
  if (!state.available) return null

  const { info, osds, mode, wanted, acknowledged } = state
  const entering = mode === 'enter'
  const host = info?.crushHost || state.node
  const osdList = osdNames(osds.map(o => o.id))
  const health = info?.health
  const otherHosts = info?.otherHostsWithNoout || []
  const okToStop = info?.okToStop
  const unsafe = entering && okToStop?.ok === false
  const downOsds = osds.filter(o => o.status !== 'up').map(o => o.id)

  return (
    <Box data-testid="ceph-noout-option" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box>
        <FormControlLabel
          control={<Checkbox size="small" checked={wanted} disabled={disabled} onChange={e => state.setWanted(e.target.checked)} />}
          label={entering ? t('cephNoout.setOption', { count: osds.length }) : t('cephNoout.removeOption', { count: osds.length })}
        />
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', ml: 0.5 }}>
          {entering ? t('cephNoout.setHelp', { host, osds: osdList }) : t('cephNoout.removeHelp', { host, osds: osdList, count: osds.length })}
        </Typography>
      </Box>

      {entering && wanted && info?.globalNoout && (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', ml: 0.5 }} data-testid="ceph-noout-global">
          {t('cephNoout.globalAlreadySet')}
        </Typography>
      )}

      {entering && wanted && health && health.status !== 'HEALTH_OK' && (
        <Alert severity={health.status === 'HEALTH_ERR' ? 'error' : 'warning'} data-testid="ceph-noout-health">
          <Typography variant="body2" fontWeight={600}>{t('cephNoout.healthNotOk', { status: health.status })}</Typography>
          {health.checks.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
              {health.checks.map(c => (
                <li key={c.code}><Typography variant="caption">{c.code}: {c.message}</Typography></li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      {entering && wanted && otherHosts.length > 0 && (
        <Alert severity="warning" data-testid="ceph-noout-other-hosts">
          {t('cephNoout.otherHosts', { hosts: otherHosts.join(', ') })}
        </Alert>
      )}

      {wanted && unsafe && (
        <Alert severity="error" data-testid="ceph-noout-unsafe">
          <Typography variant="body2" fontWeight={600}>{t('cephNoout.notOkToStop')}</Typography>
          <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
            {okToStop?.message
              ? t('cephNoout.notOkToStopUnknown', { error: okToStop.message })
              : t('cephNoout.notOkToStopPgs', { count: okToStop?.numNotOkPgs ?? 0 })}
          </Typography>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Checkbox size="small" checked={acknowledged} disabled={disabled} onChange={e => state.setAcknowledged(e.target.checked)} />}
            label={<Typography variant="body2">{t('cephNoout.acknowledge')}</Typography>}
          />
        </Alert>
      )}

      {!entering && wanted && downOsds.length > 0 && (
        <Alert severity="warning" data-testid="ceph-noout-osds-down">
          {t('cephNoout.osdsNotUpHint', { osds: osdNames(downOsds), count: downOsds.length })}
        </Alert>
      )}
    </Box>
  )
}
