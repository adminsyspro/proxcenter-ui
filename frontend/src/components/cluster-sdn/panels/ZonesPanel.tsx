'use client'

import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'

interface Props {
  connectionId: string
}

export default function ZonesPanel({ connectionId }: Props) {
  const t = useTranslations()

  return (
    <EmptyState
      icon="ri-global-line"
      title={t('sdn.subtab.zonesTitle')}
      description={t('sdn.subtab.zonesPlaceholder')}
      size="large"
    />
  )
}
