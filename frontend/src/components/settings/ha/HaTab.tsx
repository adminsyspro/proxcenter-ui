'use client'

import { Box, LinearProgress } from '@mui/material'

import { useHaConfig } from './useHaConfig'

import FeatureGuard from '@/components/guards/FeatureGuard'
import { Features } from '@/lib/license/features'

import dynamic from 'next/dynamic'

const HaDeployWizard = dynamic(() => import('./HaDeployWizard'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>,
})

const HaClusterDashboard = dynamic(() => import('./HaClusterDashboard'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>,
})

export default function HaTab() {
  const { data: config, isLoading, mutate } = useHaConfig()

  return (
    <FeatureGuard feature={Features.HA} featureName='ProxCenter HA'>
      {isLoading
        ? <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
        : config?.enabled || config?.deploymentState === 'deployed'
          ? <HaClusterDashboard />
          : <HaDeployWizard config={config} onDeployed={() => mutate()} />}
    </FeatureGuard>
  )
}
