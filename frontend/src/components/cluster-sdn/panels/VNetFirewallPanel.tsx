'use client'

import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'

interface Props {
  connectionId: string
}

export default function VNetFirewallPanel({ connectionId }: Props) {
  const t = useTranslations()

  return (
    <EmptyState
      icon="ri-shield-keyhole-line"
      title={t('sdn.subtab.firewallTitle')}
      description={t('sdn.subtab.firewallPlaceholder')}
      size="large"
    />
  )
}
