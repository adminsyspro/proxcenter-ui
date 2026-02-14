'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { VmSummaryNodeData } from '../../types'

function VmSummaryNodeComponent({ data }: NodeProps) {
  const d = data as unknown as VmSummaryNodeData
  const t = useTranslations('topology')

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        bgcolor: 'background.paper',
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 1.5,
        px: 1.5,
        py: 0.75,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        cursor: 'pointer',
        '&:hover': {
          bgcolor: 'action.hover',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        },
      }}
    >
      <Handle type='target' position={Position.Top} style={{ background: '#999' }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <img src='/images/proxcenter-logo.svg' alt='' width={13} height={13} style={{ flexShrink: 0, opacity: 0.5 }} />
        <Typography variant='caption' fontWeight={600} sx={{ fontSize: '0.75rem' }}>
          {t('vmCount', { count: d.total })}
        </Typography>
      </Box>
      <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.6rem' }}>
        {t('runningCount', { running: d.running })}, {t('stoppedCount', { stopped: d.stopped })}
      </Typography>
      <Typography variant='caption' color='primary.main' sx={{ fontSize: '0.55rem', mt: 0.25 }}>
        {t('clickToExpand')}
      </Typography>
    </Box>
  )
}

export const VmSummaryNode = memo(VmSummaryNodeComponent)
