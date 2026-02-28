'use client'

import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'

import { useRBAC } from '@/contexts/RBACContext'

const quickLinks = [
  { labelKey: 'navigation.dashboard', href: '/home', icon: 'ri-dashboard-line' },
  { labelKey: 'navigation.inventory', href: '/infrastructure/inventory', permissions: ['vm.view', 'node.view'] },
  { labelKey: 'navigation.topology', href: '/infrastructure/topology', permissions: ['vm.view', 'node.view'] },
  { labelKey: 'navigation.backups', href: '/operations/backups', permissions: ['backup.view', 'backup.job.view'] },
  { labelKey: 'navigation.settings', href: '/settings', permissions: ['connection.manage', 'admin.settings'] }
]

const VCenterQuickNav = () => {
  const pathname = usePathname()
  const t = useTranslations()
  const { hasPermission } = useRBAC()

  const visibleLinks = useMemo(() => {
    return quickLinks.filter(link => {
      if (!link.permissions) return true
      return link.permissions.some(p => hasPermission(p))
    })
  }, [hasPermission])

  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'flex' },
        alignItems: 'center',
        gap: 0,
        height: '100%'
      }}
    >
      {visibleLinks.map((link) => {
        const isActive = link.href === '/home'
          ? pathname === '/home' || pathname === '/'
          : pathname?.startsWith(link.href)

        return (
          <Link key={link.href} href={link.href} style={{ textDecoration: 'none' }}>
            <Box
              sx={{
                px: 1.5,
                height: 48,
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 150ms',
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.08)'
                },
                '&::after': isActive ? {
                  content: '""',
                  position: 'absolute',
                  bottom: 0,
                  left: 8,
                  right: 8,
                  height: 2,
                  backgroundColor: '#49afd9',
                  borderRadius: '2px 2px 0 0'
                } : {}
              }}
            >
              <Typography
                sx={{
                  color: isActive ? '#ffffff' : 'rgba(255,255,255,0.6)',
                  fontSize: 12.5,
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: 'nowrap',
                  transition: 'color 150ms',
                  '&:hover': {
                    color: '#ffffff'
                  }
                }}
              >
                {t(link.labelKey)}
              </Typography>
            </Box>
          </Link>
        )
      })}
    </Box>
  )
}

export default VCenterQuickNav
