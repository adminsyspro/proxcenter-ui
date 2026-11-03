'use client'

import { useMemo, useState } from 'react'
import { Button } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useSWRConfig } from 'swr'

import { microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegPolicy } from '@/lib/microseg/types'

import { isVersionConflict, useDialogAction } from './dialogParts'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import { WriteTip, useMicrosegWrite } from './microsegAccess'

type Props = {
  connectionId: string
  policy: MicrosegPolicy
  /** The unapplied changes, when counted (the confirmation states it). */
  count: number | null
  /** Called once the draft is discarded (a dialog showing the refusal closes). */
  onDiscarded?: () => void
  variant?: 'text' | 'outlined'
}

/**
 * "Discard changes" of the pending micro-segmentation changes (R66): the draft goes back to the last applied revision
 * (empty without one), after a themed confirmation stating the count. The answer is the new draft: it replaces the
 * policy at once and the status is read again (the pending changes are then gone). A draft changed meanwhile
 * (VERSION_CONFLICT) is read again and the dialog says so, the user discards again if still wanted.
 */
export default function DiscardDraft({ connectionId, policy, count, onDiscarded, variant = 'text' }: Props) {
  const t = useTranslations('microsegPilot.discard')
  const { canWrite } = useMicrosegWrite()
  const { mutate } = useSWRConfig()
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const [open, setOpen] = useState(false)
  const action = useDialogAction()
  const base = microsegBaseUrl(connectionId)

  const discard = async () => {
    const ok = await action.run(async () => {
      try {
        const fresh = await api.discardDraft(policy.version)
        await mutate(`${base}/policy`, fresh, { revalidate: false })
      } catch (e) {
        if (isVersionConflict(e)) await mutate(`${base}/policy`)
        throw e
      }
      await mutate(`${base}/status`)
    })
    if (!ok) return
    setOpen(false)
    onDiscarded?.()
  }

  return (
    <>
      <WriteTip>
        <Button color='inherit' size='small' variant={variant} disabled={!canWrite} onClick={() => { action.reset(); setOpen(true) }} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {t('button')}
        </Button>
      </WriteTip>
      <MicrosegConfirmDialog
        open={open}
        title={count ? t('title', { count }) : t('titleNoCount')}
        body={t('body')}
        confirmLabel={t('confirm')}
        color='error'
        busy={action.busy}
        error={action.error}
        onConfirm={() => { void discard() }}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}
