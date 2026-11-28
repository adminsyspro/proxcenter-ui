'use client'

import { useEffect } from 'react'

import { Alert, LinearProgress } from '@mui/material'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import CephCockpit from '@/components/ceph/cockpit/CephCockpit'
import { toCandidates, toConnections } from '@/lib/ceph/cockpitConnections'
import { fetchCockpitData } from '@/components/ceph/cockpit/hooks/cockpitFetch'
import PermissionGuard from '@/components/guards/PermissionGuard'
import { usePageTitle } from '@/contexts/PageTitleContext'

/*
   Ceph cockpit. The page lists the PVE connections flagged with Ceph and hands
   them to the cockpit, which reads the health of each one and drops those
   that turn out to run no Ceph. The PVE connections without the flag are the
   clusters the deploy wizard can install Ceph on (ui#1450).
*/

const CONNECTIONS_URL = '/api/v1/connections?type=pve&hasCeph=true'
const PVE_CONNECTIONS_URL = '/api/v1/connections?type=pve'

function CephPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('storage.ceph'), t('storage.distributed'), 'simple-icons-ceph')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const { data, error, isLoading, mutate } = useSWR(CONNECTIONS_URL, (url: string) => fetchCockpitData<unknown>(url), {
    revalidateOnFocus: false,
  })
  const pve = useSWR(PVE_CONNECTIONS_URL, (url: string) => fetchCockpitData<unknown>(url), { revalidateOnFocus: false })
  const reloadConnections = () => {
    void mutate()
    void pve.mutate()
  }

  if (isLoading) return <LinearProgress />
  if (error && !data) return <Alert severity='error'>{t('cephCockpit.error.connections')}</Alert>

  return <CephCockpit connections={toConnections(data)} candidates={toCandidates(pve.data)} onConnectionsChanged={reloadConnections} />
}

// The menu entry is hidden without storage.admin; a direct URL lands here (#920).
export default function CephPageGuarded() {
  return (
    <PermissionGuard permission='storage.admin'>
      <CephPage />
    </PermissionGuard>
  )
}
