'use client'

import Chip from '@mui/material/Chip'
import { useLicense } from '@/contexts/LicenseContext'

export default function NFRBadge() {
  const { isNFR } = useLicense()
  if (!isNFR) return null
  return (
    <Chip
      size="small"
      color="warning"
      label="NFR / Not For Resale"
      sx={{ ml: 1, fontWeight: 600 }}
    />
  )
}
