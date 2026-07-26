'use client'

import { ReactNode } from 'react'
import { Box, Card, CardContent, Typography, Chip } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useLicense } from '@/contexts/LicenseContext'
import { optionDisplayName } from '@/lib/license/features'

interface FeatureGuardProps {
  children: ReactNode
  feature: string
  featureName?: string
}

/**
 * Guard component that checks if an add-on option capability is granted by
 * the current license. If not, displays an add-on upsell prompt instead of
 * the children. Unlike EnterpriseGuard, this never claims the feature
 * "requires Enterprise" — add-on options are purchased separately on top of
 * an existing Enterprise license.
 */
export default function FeatureGuard({
  children,
  feature,
  featureName
}: FeatureGuardProps) {
  const { hasFeature, loading } = useLicense()
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

  // If the add-on option is granted, render children
  if (hasFeature(feature)) {
    return <>{children}</>
  }

  const name = featureName || optionDisplayName(feature)

  // Add-on option not available - show add-on upsell prompt
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
            bgcolor: 'primary.lighter',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mx: 'auto',
            mb: 3
          }}>
            <i
              className='ri-puzzle-line'
              style={{
                fontSize: 40,
                color: 'var(--mui-palette-primary-main)'
              }}
            />
          </Box>

          <Chip
            label={t('license.addonChip')}
            color='primary'
            size='small'
            sx={{ mb: 2, fontWeight: 700 }}
          />

          <Typography variant='h5' fontWeight={700} sx={{ mb: 1 }}>
            {t('license.optionRestricted')}
          </Typography>

          <Typography variant='body1' sx={{ opacity: 0.7, mb: 3 }}>
            {t('license.featureRequiresOption', { feature: name })}
          </Typography>

          <Box sx={{
            bgcolor: 'action.hover',
            borderRadius: 2,
            p: 2
          }}>
            <Typography variant='body2' sx={{ opacity: 0.8 }}>
              {t('license.optionUpgradeDescription')}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
