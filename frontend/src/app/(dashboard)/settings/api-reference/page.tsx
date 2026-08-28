'use client'

import { useEffect } from 'react'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'

import { Box, Button, LinearProgress, Typography } from '@mui/material'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useRBAC } from '@/contexts/RBACContext'

// Client-only: Scalar mounts a Vue application into a DOM node, there is
// nothing to render on the server. The chunk (Vue + Scalar) only loads when
// an operator actually opens this page.
const ApiReferenceViewer = dynamic(() => import('@/components/settings/api-reference/ApiReferenceViewer'), {
  ssr: false,
  loading: () => <LinearProgress />,
})

const API_TOKENS_TAB_HREF = '/settings?tab=api'

export default function ApiReferencePage() {
  const t = useTranslations('settings.apiTokens.reference')
  const router = useRouter()
  const { isAdmin, loading } = useRBAC()
  const { data: session } = useSession()
  const { setPageInfo } = usePageTitle()

  // Same gate as the API tab this page hangs off (settings/page.jsx
  // `providerOnly`): super admin, inside the provider tenant. The reference is
  // documentation, so unlike token creation it is NOT gated on the API_ACCESS
  // option: the document is public anyway, and reading what the API offers is
  // how an operator decides whether the option is worth enabling.
  const isProviderTenant = ((session?.user as { tenantId?: string } | undefined)?.tenantId || 'default') === 'default'
  const allowed = isAdmin && isProviderTenant

  useEffect(() => {
    setPageInfo(t('title'), t('subtitle'), 'ri-book-2-line')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  useEffect(() => {
    if (!loading && !allowed) router.replace('/settings')
  }, [loading, allowed, router])

  if (loading || !allowed) return <LinearProgress />

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2 }}>
      <Box
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant='body2' color='text.secondary'>{t('hint')}</Typography>
        <Button
          variant='outlined'
          startIcon={<i className='ri-arrow-left-line' />}
          onClick={() => router.push(API_TOKENS_TAB_HREF)}
        >
          {t('backToTokens')}
        </Button>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
        }}
      >
        <ApiReferenceViewer />
      </Box>
    </Box>
  )
}
