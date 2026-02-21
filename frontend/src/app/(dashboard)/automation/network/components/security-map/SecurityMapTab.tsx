'use client'

import { Box, CircularProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useSecurityMapData } from './hooks/useSecurityMapData'
import FlowMatrix from './FlowMatrix'

interface SecurityMapTabProps {
  connectionId: string
  securityGroups: { group: string; rules?: any[] }[]
  aliases: { name: string; cidr: string }[]
  clusterOptions: any
  clusterRules: any[]
}

export default function SecurityMapTab({
  connectionId,
  securityGroups,
  aliases,
  clusterRules,
}: SecurityMapTabProps) {
  const t = useTranslations('networkPage')

  const { loading, flowMatrix } = useSecurityMapData({
    connectionId,
    securityGroups,
    aliases,
    clusterRules,
  })

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (flowMatrix.labels.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6, gap: 1 }}>
        <i className='ri-shield-cross-line' style={{ fontSize: 48, opacity: 0.3 }} />
        <Typography variant='h6' color='text.secondary'>
          {t('securityMap.noData')}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
          {t('securityMap.noDataDesc')}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2 }}>
      <FlowMatrix flowMatrix={flowMatrix} />
    </Box>
  )
}
