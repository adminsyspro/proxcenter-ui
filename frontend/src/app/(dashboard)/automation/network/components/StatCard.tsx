'use client'

import { Box, Card, CardContent, Skeleton, Typography, useTheme, alpha } from '@mui/material'

interface StatCardProps {
  icon: string
  label: string
  value: string | number
  subvalue?: string
  color: string
  loading?: boolean
  onClick?: () => void
}

export default function StatCard({ icon, label, value, subvalue, color, loading, onClick }: StatCardProps) {
  const theme = useTheme()

  return (
    <Card
      onClick={onClick}
      sx={{
        height: '100%',
        background: theme.palette.mode === 'dark'
          ? `linear-gradient(135deg, ${alpha(color, 0.12)} 0%, ${alpha(color, 0.06)} 100%)`
          : `linear-gradient(135deg, ${alpha(color, 0.14)} 0%, ${alpha(color, 0.06)} 100%)`,
        border: `1px solid ${alpha(color, 0.3)}`,
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s',
        '&:hover': onClick ? { transform: 'translateY(-2px)', boxShadow: `0 8px 24px ${alpha(color, 0.2)}` } : {},
        '&::before': { content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: color }
      }}
    >
      <CardContent sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block' }}>{label}</Typography>
          {loading ? (
            <Skeleton width="60px" height={32} />
          ) : (
            <Typography variant="h4" sx={{ fontWeight: 900, color, lineHeight: 1.2 }}>{value}</Typography>
          )}
          {subvalue && <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>{subvalue}</Typography>}
        </Box>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: alpha(color, 0.2), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className={icon} style={{ fontSize: 22, color }} />
        </Box>
      </CardContent>
    </Card>
  )
}
