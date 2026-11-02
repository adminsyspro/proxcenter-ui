'use client'

import { useEffect } from 'react'

import { Alert, LinearProgress } from '@mui/material'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import CephCockpit, { type CockpitConnection } from '@/components/ceph/cockpit/CephCockpit'
import { fetchCockpitData } from '@/components/ceph/cockpit/hooks/cockpitFetch'
import PermissionGuard from '@/components/guards/PermissionGuard'
import { usePageTitle } from '@/contexts/PageTitleContext'

/*
   Ceph cockpit. The page lists the PVE connections flagged with Ceph and hands
   them to the cockpit, which reads the health of each one and drops those
   that turn out to run no Ceph.
*/

const CONNECTIONS_URL = '/api/v1/connections?type=pve&hasCeph=true'

function toConnections(raw: unknown): CockpitConnection[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((c): c is { id: unknown; name?: unknown } => c !== null && typeof c === 'object' && 'id' in c)
    .map(c => ({ id: String(c.id), name: typeof c.name === 'string' && c.name ? c.name : String(c.id) }))
}

function CephPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('storage.ceph'), t('storage.distributed'), 'simple-icons-ceph')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const { data, error, isLoading } = useSWR(CONNECTIONS_URL, (url: string) => fetchCockpitData<unknown>(url), {
    revalidateOnFocus: false,
  })

  if (isLoading) return <LinearProgress />
  if (error && !data) return <Alert severity='error'>{t('cephCockpit.error.connections')}</Alert>

  return <CephCockpit connections={toConnections(data)} />
}

// The menu entry is hidden without storage.admin; a direct URL lands here (#920).
export default function CephPageGuarded() {
  return (
    <PermissionGuard permission='storage.admin'>
      <CephPage />
    </PermissionGuard>
  )
}
