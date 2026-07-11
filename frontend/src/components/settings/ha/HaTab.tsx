'use client'

import { Box, LinearProgress } from '@mui/material'

import { useHaConfig } from './useHaConfig'

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

  if (isLoading) {
    return <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
  }

  if (config?.enabled || config?.deploymentState === 'deployed') {
    return <HaClusterDashboard />
  }

  return <HaDeployWizard config={config} onDeployed={() => mutate()} />
}
