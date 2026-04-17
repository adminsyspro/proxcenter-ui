'use client'

import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'

interface Props {
  connectionId: string
}

export default function FabricsPanel({ connectionId }: Props) {
  const t = useTranslations()

  return (
    <EmptyState
      icon="ri-route-line"
      title={t('sdn.subtab.fabricsTitle')}
      description={t('sdn.subtab.fabricsPlaceholder')}
      size="large"
    />
  )
}
