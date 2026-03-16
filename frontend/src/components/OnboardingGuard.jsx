'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Box, CircularProgress } from '@mui/material'
import { useTenant } from '@/contexts/TenantContext'

// Routes autorisées sans connexion Proxmox configurée
const allowedRoutes = ['/settings', '/logout', '/profile']

export default function OnboardingGuard({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { currentTenant } = useTenant()
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Vérifier si on est sur une route autorisée
    const isAllowed = allowedRoutes.some(route => pathname.startsWith(route))

    if (isAllowed) {
      // If we're on /settings with onboarding=true, re-check in case tenant changed
      const isOnboarding = pathname.startsWith('/settings') && searchParams.get('onboarding') === 'true'

      if (isOnboarding) {
        fetch('/api/v1/app/status')
          .then(res => res.json())
          .then(data => {
            if (data.connectionsConfigured) {
              // Connections exist now (tenant switch), remove onboarding param
              router.replace('/settings')
            }
          })
          .catch(() => {})
      }

      setChecking(false)
      setReady(true)
      return
    }

    // Vérifier l'état de l'application
    fetch('/api/v1/app/status')
      .then(res => res.json())
      .then(data => {
        if (!data.connectionsConfigured) {
          // Pas de connexion configurée, rediriger vers settings
          router.push('/settings?onboarding=true')
        } else {
          setReady(true)
        }
      })
      .catch(() => {
        // En cas d'erreur, on laisse passer
        setReady(true)
      })
      .finally(() => setChecking(false))
  }, [pathname, router, currentTenant?.id, searchParams])

  if (checking) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '50vh',
        }}
      >
        <CircularProgress />
      </Box>
    )
  }

  if (!ready) {
    return null
  }

  return children
}
