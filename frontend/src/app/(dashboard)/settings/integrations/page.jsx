'use client'

import { useEffect } from 'react'

import PlaceholderPage from '@components/PlaceholderPage'
import { usePageTitle } from '@/contexts/PageTitleContext'

export default function Page() {
  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo('Intégrations', 'Connexions externes', 'ri-plug-line')
    
return () => setPageInfo('', '', '')
  }, [setPageInfo])

  return (
    <PlaceholderPage
      title="Intégrations"
      subtitle="Connecteurs: Prometheus, Grafana, PBS, PowerDNS, Slack, etc."
      todos={[
        "Lister intégrations",
        "Setup wizard",
        "Tests de connectivité",
      ]}
    />
  )
}
