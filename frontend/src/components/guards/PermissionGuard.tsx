'use client'

import type { ReactNode } from 'react'

import { LinearProgress } from '@mui/material'
import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'
import { useRBAC } from '@/contexts/RBACContext'

interface PermissionGuardProps {
  permission: string
  children: ReactNode
}

/**
 * Gate a dashboard page on one RBAC permission.
 *
 * The menu hides entries the user cannot open, but a direct URL would still
 * mount the page. This renders the standard "access denied" state instead of
 * the page, so none of its data hooks run. The API routes behind the page keep
 * their own server-side checks; this guard only spares the user a page of
 * failing requests.
 */
export default function PermissionGuard({ permission, children }: PermissionGuardProps) {
  const t = useTranslations('errorPages')
  const { hasPermission, loading } = useRBAC()

  if (loading) return <LinearProgress />

  if (!hasPermission(permission)) {
    return (
      <EmptyState
        icon='ri-lock-line'
        title={t('403.title')}
        description={t('403.description')}
        size='large'
      />
    )
  }

  return <>{children}</>
}
