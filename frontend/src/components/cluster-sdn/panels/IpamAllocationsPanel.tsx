'use client'

import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'

interface Props {
  connectionId: string
}

export default function IpamAllocationsPanel({ connectionId }: Props) {
  const t = useTranslations()

  return (
    <EmptyState
      icon="ri-list-ordered"
      title={t('sdn.subtab.ipamsTitle')}
      description={t('sdn.subtab.ipamsPlaceholder')}
      size="large"
    />
  )
}
