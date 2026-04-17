'use client'

import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'

interface Props {
  connectionId: string
}

export default function VNetsPanel({ connectionId }: Props) {
  const t = useTranslations()

  return (
    <EmptyState
      icon="ri-node-tree"
      title={t('sdn.subtab.vnetsTitle')}
      description={t('sdn.subtab.vnetsPlaceholder')}
      size="large"
    />
  )
}
