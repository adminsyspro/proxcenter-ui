'use client'

// MUI Imports
import MuiBadge from '@mui/material/Badge'
import { styled } from '@mui/material/styles'

const Badge = styled(MuiBadge)(({ tonal, color }) => {
  return {
    ...(tonal === 'true' && {
      '& .MuiBadge-badge.MuiBadge-standard': {
        color: `var(--mui-palette-${color}-main)`,
        backgroundColor: `var(--mui-palette-${color}-lightOpacity)`
      }
    })
  }
})

const CustomBadge = props => <Badge {...props} />

export default CustomBadge
