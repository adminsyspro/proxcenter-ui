'use client'

import { Box, Button, Paper, Step, StepContent, StepLabel, Stepper, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegSubTab } from './microsegTabTypes'

type Props = {
  goToSubTab: (tab: MicrosegSubTab) => void
  onOpenPlan: () => void
}

/** Three steps from an empty policy to a first plan. Buttons only navigate. */
export default function FirstRunGuide({ goToSubTab, onOpenPlan }: Props) {
  const t = useTranslations('microsegPilot.firstRun')

  const steps: Array<{ id: string; icon: string; action: () => void }> = [
    { id: 'step1', icon: 'ri-heart-pulse-line', action: () => goToSubTab('overview') },
    { id: 'step2', icon: 'ri-shape-line', action: () => goToSubTab('policy') },
    { id: 'step3', icon: 'ri-file-list-3-line', action: onOpenPlan },
  ]

  return (
    <Paper variant='outlined' sx={{ p: 3, mb: 2 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant='h6'>{t('title')}</Typography>
        <Typography variant='body2' color='text.secondary'>{t('intro')}</Typography>
      </Box>
      <Stepper orientation='vertical' activeStep={-1}>
        {steps.map(step => (
          <Step key={step.id} expanded>
            <StepLabel>{t(`${step.id}Title`)}</StepLabel>
            <StepContent>
              <Typography variant='body2' color='text.secondary' sx={{ mb: 1 }}>{t(`${step.id}Body`)}</Typography>
              <Button size='small' variant='outlined' startIcon={<i className={step.icon} />} onClick={step.action}>
                {t(`${step.id}Action`)}
              </Button>
            </StepContent>
          </Step>
        ))}
      </Stepper>
    </Paper>
  )
}
