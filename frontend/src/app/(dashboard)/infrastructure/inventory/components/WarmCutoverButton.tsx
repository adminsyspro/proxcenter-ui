'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Checkbox, FormControlLabel, Typography } from '@mui/material'

import { GUEST_CONVERSION_ESTIMATE_SEC } from '@/lib/migration/warm/guest-conversion-estimate'

import ConfirmActionButton from './ConfirmActionButton'
import { postJobAction } from './jobAction'

/**
 * The operator's switchover control, with its confirmation.
 *
 * One component rather than a copy per surface: the button belongs both to the
 * VM panel (where a job started through the API is followed) and to the migrate
 * dialog (where the operator who started the run is actually looking). Two
 * hand-written copies would drift, and the first one to drift would be the one
 * nobody is watching.
 */

type WarmJob = {
  id: string
  status: string
  projectedDowntimeSec?: number | null
  config?: { cutoverMode?: string | null; convertGuest?: boolean | null } | null
} | null | undefined

/**
 * A manual-cutover run holds in `delta_sync`, replicating, instead of parking in
 * `awaiting_cutover`. It is waiting for the operator all the same, so both read
 * as "waiting" everywhere in the UI (#443).
 */
export function isWarmHold(job: WarmJob): boolean {
  return job?.config?.cutoverMode === 'manual' && job?.status === 'delta_sync'
}

/** True when the migration is waiting on a human, whichever way it got there. */
export function isAwaitingOperator(job: WarmJob): boolean {
  return isWarmHold(job) || job?.status === 'awaiting_cutover'
}

/**
 * The guest conversion default of the job (#1000): what was chosen at launch,
 * or at a previous cutover of the same job. Null when the job does not offer
 * one (XCP-ng warm, or a job created before the option existed).
 */
export function guestConversionDefault(job: WarmJob): boolean | null {
  const v = job?.config?.convertGuest
  return typeof v === 'boolean' ? v : null
}

/**
 * The cutover can only be requested once a delta pass has produced an estimate:
 * before that the pipeline has no projection to show and no change id to resume
 * from.
 */
export function canRequestCutover(job: WarmJob): boolean {
  return !!job && ['delta_sync', 'awaiting_cutover'].includes(job.status) && job.projectedDowntimeSec != null
}

export default function WarmCutoverButton({
  job,
  size = 'small',
  onRequested,
}: {
  job: WarmJob
  size?: 'small' | 'medium'
  onRequested?: () => void
}) {
  const t = useTranslations()
  const conversionDefault = guestConversionDefault(job)
  // The operator's choice for THIS cutover, reset to the job's default each
  // time the dialog opens.
  const [convertGuest, setConvertGuest] = useState(conversionDefault ?? false)

  if (!canRequestCutover(job)) return null

  const awaiting = isAwaitingOperator(job)
  const mins = Math.round((job!.projectedDowntimeSec ?? 0) / 60)
  const conversionControl = conversionDefault !== null && (
    <FormControlLabel
      sx={{ alignItems: 'flex-start', m: 0 }}
      control={(
        <Checkbox
          size="small"
          checked={convertGuest}
          onChange={(_, v) => setConvertGuest(v)}
          sx={{ mt: -0.5 }}
          slotProps={{ input: { 'data-testid': 'cutover-convert-guest' } as any }}
        />
      )}
      label={(
        <Box>
          <Typography variant="body2" fontWeight={600}>{t('inventoryPage.esxiMigration.cutoverConvertGuest')}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {convertGuest
              ? t('inventoryPage.esxiMigration.cutoverConvertGuestOn', { seconds: GUEST_CONVERSION_ESTIMATE_SEC })
              : t('inventoryPage.esxiMigration.cutoverConvertGuestOff')}
          </Typography>
        </Box>
      )}
    />
  )

  return (
    <ConfirmActionButton
      label={t('inventoryPage.esxiMigration.cutoverNow')}
      icon="ri-flashlight-line"
      color="primary"
      variant={awaiting ? 'contained' : 'outlined'}
      size={size}
      title={t('inventoryPage.esxiMigration.cutoverConfirmTitle')}
      body={t('inventoryPage.esxiMigration.cutoverConfirmBody', { mins })}
      // Only the automatic mode can reach the gate, and only there does the
      // warning hold: a manual hold is waiting on purpose, not diverging.
      alert={job!.status === 'awaiting_cutover' ? t('inventoryPage.esxiMigration.cutoverNotConverging') : undefined}
      extra={conversionControl || undefined}
      onOpen={() => setConvertGuest(conversionDefault ?? false)}
      onConfirm={async () => {
        // Throws on a rejected request, which keeps the dialog open with the
        // reason instead of closing it on a cutover that never started. The
        // conversion choice only goes along for a job that offers it.
        await postJobAction(`/api/v1/migrations/${job!.id}/cutover`, conversionDefault === null ? undefined : { convertGuest })
        onRequested?.()
      }}
    />
  )
}
