'use client'

import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}j ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`

  return `${mins}m`
}

function getUptimeColor(seconds) {
  if (!seconds) return '#9e9e9e'
  const days = seconds / 86400

  if (days > 30) return '#4caf50'  // Plus de 30 jours
  if (days > 7) return '#8bc34a'   // Plus de 7 jours
  if (days > 1) return '#ff9800'   // Plus de 1 jour
  
return '#f44336'                  // Moins de 1 jour (récemment redémarré)
}

export default function UptimeNodesWidget({ data, loading }) {
  const t = useTranslations()
  const nodes = data?.nodes || []

  if (nodes.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('common.noData')}</Typography>
      </Box>
    )
  }

  // Trier par uptime décroissant
  const sortedNodes = [...nodes].sort((a, b) => (b.uptime || 0) - (a.uptime || 0))

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 0.5 }}>
      {sortedNodes.map((node, idx) => {
        const color = node.status === 'online' ? getUptimeColor(node.uptime) : '#f44336'
        
        return (
          <Box 
            key={idx}
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              py: 0.75,
              borderBottom: idx < sortedNodes.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ 
                width: 8, height: 8, borderRadius: '50%', 
                bgcolor: node.status === 'online' ? '#4caf50' : '#f44336' 
              }} />
              <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 11 }}>
                {node.name}
              </Typography>
              <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 10 }}>
                {node.connection}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-time-line' style={{ fontSize: 12, color, opacity: 0.8 }} />
              <Typography variant='caption' sx={{ fontWeight: 700, color, fontSize: 11 }}>
                {node.status === 'online' ? formatUptime(node.uptime) : t('common.offline')}
              </Typography>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
