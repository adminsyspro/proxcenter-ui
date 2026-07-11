'use client'

import { Box, Card, CardContent, Chip, Typography } from '@mui/material'

import type { PatroniMember } from './useHaCluster'

const ROLE_COLORS: Record<string, 'success' | 'info' | 'default' | 'error'> = {
  leader: 'success',
  sync_standby: 'info',
  replica: 'default',
  standby_leader: 'info',
}

function formatLag(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function roleLabel(role: string): string {
  switch (role) {
    case 'leader': return 'Leader'
    case 'sync_standby': return 'Sync Standby'
    case 'replica': return 'Replica'
    case 'standby_leader': return 'Standby Leader'
    default: return role
  }
}

interface HaNodeCardProps {
  member: PatroniMember
  isVipHolder: boolean
  maintenance: boolean
}

export default function HaNodeCard({ member, isVipHolder, maintenance }: HaNodeCardProps) {
  const roleColor = ROLE_COLORS[member.role] || 'error'

  return (
    <Card variant="outlined" sx={{ flex: '1 1 300px', minWidth: 280 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {member.name}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {isVipHolder && <Chip label="VIP" size="small" color="primary" />}
            {maintenance && <Chip label="Maintenance" size="small" color="warning" />}
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {member.host}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip label={roleLabel(member.role)} size="small" color={roleColor} />
          <Chip
            label={member.state}
            size="small"
            variant="outlined"
            color={member.state === 'running' || member.state === 'streaming' ? 'success' : 'error'}
          />
        </Box>
        <Box sx={{ mt: 1, display: 'flex', gap: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Timeline: {member.timeline}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Lag: {formatLag(member.lagBytes)}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}
