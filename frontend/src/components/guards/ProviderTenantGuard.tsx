'use client'

import { ReactNode, useEffect } from 'react'

import { useRouter } from 'next/navigation'

import { Box, Typography } from '@mui/material'

import { useTenant } from '@/contexts/TenantContext'

interface ProviderTenantGuardProps {
  children: ReactNode
}

/**
 * Gate a page to the provider tenant (id === 'default').
 *
 * The five orchestration pages (DRS, Site Recovery, Network Security, Flows,
 * Resources) act on the whole fleet — they let an operator move workloads
 * across clusters or rewrite shared firewall rules. A tenant user has no
 * authority over either, so even if they hold `automation.view` through a
 * legacy role we never want them to land on these pages.
 *
 * The menu already hides the entries via `requires.isProviderTenant`, but a
 * direct URL would otherwise still mount the page. This component handles
 * that path by redirecting to /home as soon as the tenant context resolves
 * to anything other than 'default'.
 */
export default function ProviderTenantGuard({ children }: ProviderTenantGuardProps) {
  const { currentTenant, loading } = useTenant()
  const router = useRouter()
  const isProviderTenant = !loading && currentTenant?.id === 'default'

  useEffect(() => {
    if (!loading && currentTenant && currentTenant.id !== 'default') {
      router.replace('/home')
    }
  }, [loading, currentTenant, router])

  if (loading || !isProviderTenant) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <Box sx={{ textAlign: 'center' }}>
          <i className='ri-loader-4-line ri-spin' style={{ fontSize: 32, opacity: 0.5 }} />
          <Typography variant='body2' sx={{ mt: 1, opacity: 0.5 }}>Loading…</Typography>
        </Box>
      </Box>
    )
  }

  return <>{children}</>
}
