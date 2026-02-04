'use client'

import { useEffect } from 'react'

import PlaceholderPage from '@components/PlaceholderPage'
import { usePageTitle } from '@/contexts/PageTitleContext'

export default function Page() {
  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo('SSO', 'Authentification unique', 'ri-shield-keyhole-line')
    
return () => setPageInfo('', '', '')
  }, [setPageInfo])

  return (
    <PlaceholderPage
      title="SSO"
      subtitle="SSO (OIDC/SAML) + provisioning (SCIM) si besoin."
      todos={[
        "Configurer OIDC",
        "Mapper claims -> rôles",
        "Tester login",
      ]}
    />
  )
}
