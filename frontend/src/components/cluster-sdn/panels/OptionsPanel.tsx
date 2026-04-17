'use client'

import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'

interface Props {
  connectionId: string
}

export default function OptionsPanel({ connectionId }: Props) {
  const t = useTranslations()

  return (
    <EmptyState
      icon="ri-settings-4-line"
      title={t('sdn.subtab.optionsTitle')}
      description={t('sdn.subtab.optionsPlaceholder')}
      size="large"
    />
  )
}
