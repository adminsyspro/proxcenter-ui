'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Box, CircularProgress } from '@mui/material'

// Routes autorisées sans connexion Proxmox configurée
const allowedRoutes = ['/settings', '/logout', '/profile']

export default function OnboardingGuard({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Vérifier si on est sur une route autorisée
    const isAllowed = allowedRoutes.some(route => pathname.startsWith(route))

    if (isAllowed) {
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
  }, [pathname, router])

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
