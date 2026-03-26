'use client'

import React, { useState } from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import { ResponsiveContainer } from 'recharts'

type ExpandableChartProps = {
  title: string
  height?: number
  children: React.ReactNode
  /** Custom header content (replaces default title) */
  header?: React.ReactNode
  /** Render the chart for the expanded overlay (gets more height) */
  renderExpanded?: () => React.ReactNode
}

export default function ExpandableChart({ title, height = 160, children, header, renderExpanded }: ExpandableChartProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          {header || <Typography variant="caption" fontWeight={600}>{title}</Typography>}
          <IconButton size="small" onClick={() => setExpanded(true)} sx={{ opacity: 0.4, p: 0.25, '&:hover': { opacity: 1 }, flexShrink: 0 }}>
            <i className="ri-expand-diagonal-line" style={{ fontSize: 14 }} />
          </IconButton>
        </Box>
        <Box sx={{ height }}>
          {children}
        </Box>
      </Box>

      {expanded && (
        <Box
          onClick={() => setExpanded(false)}
          sx={{
            position: 'fixed', inset: 0, zIndex: 1300,
            bgcolor: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            p: 4,
          }}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              bgcolor: 'background.paper',
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              width: '95%',
              maxWidth: 1200,
              p: 3,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography fontWeight={600}>{title}</Typography>
              <IconButton size="small" onClick={() => setExpanded(false)}>
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </IconButton>
            </Box>
            <Box sx={{ height: 500 }}>
              {renderExpanded ? renderExpanded() : children}
            </Box>
          </Box>
        </Box>
      )}
    </>
  )
}
