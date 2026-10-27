'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Collapse, Typography } from '@mui/material'

export default function RatesExplainer() {
  const t = useTranslations('availability')
  const [open, setOpen] = useState(false)

  return (
    <Box>
      <Box
        component='button'
        type='button'
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, border: 0, background: 'none', color: 'text.secondary', cursor: 'pointer', p: 0, font: 'inherit' }}
      >
        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} aria-hidden='true' />
        <Typography variant='body2' component='span'>{t('explainer.title')}</Typography>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 1, pl: 3, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {(['availability', 'coverage', 'excluded', 'notMeasured'] as const).map(k => (
            <Typography key={k} variant='body2' color='text.secondary'>{t(`explainer.${k}`)}</Typography>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}
