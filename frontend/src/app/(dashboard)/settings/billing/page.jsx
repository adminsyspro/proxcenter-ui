'use client'

import { useEffect } from 'react'

import PlaceholderPage from '@components/PlaceholderPage'
import { usePageTitle } from '@/contexts/PageTitleContext'

export default function Page() {
  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo('Facturation', "Gestion de l'abonnement", 'ri-bill-line')
    
return () => setPageInfo('', '', '')
  }, [setPageInfo])

  return (
    <PlaceholderPage
      title="Licences & facturation"
      subtitle="Plans, usage, facturation (si SaaS)."
      todos={[
        "Afficher plan",
        "Metriques d'usage",
        "Téléchargement factures",
      ]}
    />
  )
}
