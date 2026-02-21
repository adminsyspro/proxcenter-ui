'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography } from '@mui/material'

import type { InternetNodeData } from '../types'

function InternetNodeComponent({ data }: NodeProps) {
  const d = data as unknown as InternetNodeData

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        bgcolor: 'background.paper',
        border: '2px solid #42a5f5',
        borderRadius: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        boxShadow: '0 2px 8px rgba(66,165,245,0.2)',
        cursor: 'pointer',
      }}
    >
      <Handle type='source' position={Position.Right} style={{ background: '#42a5f5' }} />
      <i className='ri-cloud-line' style={{ fontSize: 22, color: '#42a5f5' }} />
      <Typography variant='caption' fontWeight={700} sx={{ fontSize: '0.65rem' }}>
        {d.label}
      </Typography>
    </Box>
  )
}

export const InternetNode = memo(InternetNodeComponent)
