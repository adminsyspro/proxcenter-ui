'use client'

import { useTranslations } from 'next-intl'

import TypedConfirmDialog from './TypedConfirmDialog'

type Props = {
  /** The connection the admin must type. */
  connectionName: string
  busy: boolean
  error: string | null
  /** Starts the removal; it is only called once the name has been typed. */
  onConfirm: () => void
  onCancel: () => void
}

/** Confirmation of the removal of the micro-segmentation: the name of the connection has to be typed, exactly. */
export default function RemoveDialog({ connectionName, busy, error, onConfirm, onCancel }: Props) {
  const t = useTranslations('microsegPilot.settings.remove')
  return (
    <TypedConfirmDialog
      title={t('title')}
      lines={[t('body'), t('tagsKept')]}
      inputLabel={t('typeName', { name: connectionName })}
      expected={connectionName}
      confirmLabel={t('confirm')}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
