'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography } from '@mui/material'

import type { TagGroupNodeData } from '../../types'
import { tagColor } from '../../../inventory/helpers'

function TagGroupNodeComponent({ data }: NodeProps) {
  const d = data as unknown as TagGroupNodeData
  const color = d.tag === '__none__' ? '#9e9e9e' : tagColor(d.tag)

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        bgcolor: 'background.paper',
        border: '2px solid',
        borderColor: color,
        borderRadius: 2,
        px: 1.5,
        py: 0.75,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        cursor: 'pointer',
        '&:hover': {
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
        },
      }}
    >
      <Handle type='target' position={Position.Top} style={{ background: color }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <i className='ri-price-tag-3-line' style={{ fontSize: 15, color }} />
        <Typography variant='caption' fontWeight={700} noWrap sx={{ flex: 1 }}>
          {d.label}
        </Typography>
        <Typography
          variant='caption'
          sx={{
            bgcolor: color,
            color: '#fff',
            borderRadius: 1,
            px: 0.75,
            py: 0.1,
            fontSize: '0.6rem',
            fontWeight: 700,
          }}
        >
          {d.vmCount}
        </Typography>
      </Box>

      <Handle type='source' position={Position.Bottom} style={{ background: color }} />
    </Box>
  )
}

export const TagGroupNode = memo(TagGroupNodeComponent)
