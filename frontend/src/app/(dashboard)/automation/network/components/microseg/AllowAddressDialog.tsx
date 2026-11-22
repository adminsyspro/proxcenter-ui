'use client'

import { useTranslations } from 'next-intl'

import type { MicrosegPolicy } from '@/lib/microseg/types'

import { useDialogAction } from './dialogParts'
import type { FilterGuestRef } from './ipFilterModel'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import { useGuestFilterEdits } from './useGuestFilterEdits'

type Props = {
  /** The connection the policy is written through (the tab's). */
  connectionId: string
  policy: MicrosegPolicy
  reloadPolicy: () => Promise<unknown>
  guest: FilterGuestRef & { name: string }
  /** The address the engine held back. */
  addr: string
  onDone: () => void
  onCancel: () => void
}

/**
 * The confirmation of "Allow this address": the address the engine held back goes to the additional addresses of the
 * guest (PUT /policy with the whole list), a draft change the next plan applies. A refusal stays in the dialog.
 */
export default function AllowAddressDialog({ connectionId, policy, reloadPolicy, guest, addr, onDone, onCancel }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.ipFilter')
  const edits = useGuestFilterEdits(connectionId, policy, reloadPolicy)
  const { busy, error, run } = useDialogAction()

  const allow = async () => {
    if (await run(() => edits.allow(guest, addr))) onDone()
  }

  return (
    <MicrosegConfirmDialog
      open
      title={t('allowTitle', { addr, name: guest.name })}
      body={t('allowBody')}
      confirmLabel={t('allowConfirm')}
      busy={busy}
      error={error}
      onConfirm={() => { void allow() }}
      onCancel={onCancel}
    />
  )
}
