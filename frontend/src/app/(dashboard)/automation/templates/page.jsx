'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

import PlaceholderPage from '@components/PlaceholderPage'
import { usePageTitle } from '@/contexts/PageTitleContext'

export default function Page() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('templates.title'), 'Gestion des templates VM/LXC', 'ri-file-copy-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  return (
    <PlaceholderPage
      title={t('templates.title')}
      subtitle="Catalogue de templates (cloud-init, images, presets)."
      todos={[
        "Templates OS",
        "Presets réseau/storage",
        "Versioning & approbation",
      ]}
    />
  )
}
