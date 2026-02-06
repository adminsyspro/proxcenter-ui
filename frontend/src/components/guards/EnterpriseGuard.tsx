'use client'

import { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Button, Card, CardContent, Typography, Chip } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useLicense } from '@/contexts/LicenseContext'

interface EnterpriseGuardProps {
  children: ReactNode
  requiredFeature: string
  featureName?: string
}

/**
 * Guard component that checks if a feature is available in the current license.
 * If not, displays an Enterprise upgrade prompt instead of the children.
 */
export default function EnterpriseGuard({
  children,
  requiredFeature,
  featureName
}: EnterpriseGuardProps) {
  const { hasFeature, loading, isEnterprise } = useLicense()
  const router = useRouter()
  const t = useTranslations()

  // Show loading state while checking license
  if (loading) {
    return (
      <Box sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '50vh'
      }}>
        <Box sx={{ textAlign: 'center' }}>
          <i className='ri-loader-4-line ri-spin' style={{ fontSize: 32, opacity: 0.5 }} />
          <Typography variant='body2' sx={{ mt: 1, opacity: 0.5 }}>
            {t('common.loading')}
          </Typography>
        </Box>
      </Box>
    )
  }

  // If feature is available, render children
  if (hasFeature(requiredFeature)) {
    return <>{children}</>
  }

  // Feature not available - show Enterprise upgrade prompt
  return (
    <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: 'calc(100vh - 200px)',
      p: 3
    }}>
      <Card
        variant='outlined'
        sx={{
          maxWidth: 500,
          textAlign: 'center',
          borderColor: 'warning.main',
          borderWidth: 2
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Box sx={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            bgcolor: 'warning.lighter',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mx: 'auto',
            mb: 3
          }}>
            <i
              className='ri-vip-crown-2-line'
              style={{
                fontSize: 40,
                color: 'var(--mui-palette-warning-main)'
              }}
            />
          </Box>

          <Chip
            label='Enterprise'
            color='warning'
            size='small'
            sx={{ mb: 2, fontWeight: 700 }}
          />

          <Typography variant='h5' fontWeight={700} sx={{ mb: 1 }}>
            {t('license.featureRestricted')}
          </Typography>

          <Typography variant='body1' sx={{ opacity: 0.7, mb: 3 }}>
            {featureName ? (
              t('license.featureRequiresEnterprise', { feature: featureName })
            ) : (
              t('license.thisFeatureRequiresEnterprise')
            )}
          </Typography>

          <Box sx={{
            bgcolor: 'action.hover',
            borderRadius: 2,
            p: 2,
            mb: 3
          }}>
            <Typography variant='body2' sx={{ opacity: 0.8 }}>
              {t('license.upgradeDescription')}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button
              variant='outlined'
              onClick={() => router.back()}
              startIcon={<i className='ri-arrow-left-line' />}
            >
              {t('common.goBack')}
            </Button>
            <Button
              variant='contained'
              color='warning'
              onClick={() => router.push('/settings?tab=license')}
              startIcon={<i className='ri-vip-crown-line' />}
            >
              {t('license.upgradeToPro')}
            </Button>
          </Box>

          <Typography variant='caption' sx={{ display: 'block', mt: 3, opacity: 0.5 }}>
            {t('license.contactSales')}:{' '}
            <a
              href='https://proxcenter.io/pricing'
              target='_blank'
              rel='noopener noreferrer'
              style={{ color: 'inherit' }}
            >
              proxcenter.io/pricing
            </a>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
